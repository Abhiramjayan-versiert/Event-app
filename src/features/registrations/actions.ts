"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { PAYMENT_METHODS } from "@/lib/validations/finance";
import { competitionSchema, offlineRegistrationSchema } from "@/lib/validations/registration";
import { razorpayConfigured, webhookConfigured } from "@/lib/api/razorpay";

const uuid = z.string().uuid();
const ids = (...v: string[]) => v.every((x) => uuid.safeParse(x).success);
function rpcError(error: { code?: string; message: string }, fallback: string): ActionResult<never> {
  if (["42501", "P0002", "22023"].includes(error.code ?? "")) return { ok: false, error: error.message };
  if (error.code === "23505") return { ok: false, error: "A registration already exists for this participant (duplicate rule)." };
  return fromDbError(error, fallback);
}
const refresh = (eventId: string, regId?: string) => {
  revalidatePath(`/events/${eventId}/registrations`);
  if (regId) revalidatePath(`/events/${eventId}/registrations/${regId}`);
  revalidatePath(`/events/${eventId}/finance`);
};

export async function createOfflineRegistrationAction(eventId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const parsed = offlineRegistrationSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  if (v.registration_type === "team" && !v.team_name) return { ok: false, error: "Enter the team name.", fieldErrors: { team_name: ["Required for teams"] } };
  const supabase = await createClient();
  const { data: comp } = await supabase.from("event_competitions").select("id, name, category, fee, college_id").eq("id", v.competition_id).eq("event_id", eventId).single();
  if (!comp) return { ok: false, error: "Competition not found." };
  if (v.discount > Number(comp.fee)) return { ok: false, error: "Discount cannot exceed the fee." };
  const team = (v.team_members ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 49).map((name) => ({ name }));

  const { data: reg, error } = await supabase
    .from("registrations")
    .insert({
      event_id: eventId, college_id: comp.college_id, participant_name: v.participant_name, email: v.email, phone: v.phone || null,
      participant_college: v.participant_college || null, course: v.course || null, academic_year: v.academic_year || null,
      category: comp.category, registration_type: v.registration_type, team_name: v.team_name || null, team_members: team,
      source: "offline", status: "pending", amount: Number(comp.fee), discount: v.discount,
    })
    .select("id, payable_amount")
    .single();
  if (error) return rpcError(error, "Could not create the registration.");
  await supabase.from("registration_items").insert({ registration_id: reg.id, event_id: eventId, college_id: comp.college_id, competition_id: comp.id, item_name: comp.name, category: comp.category, quantity: 1, unit_price: Number(comp.fee) });

  if (v.paid_now && Number(reg.payable_amount) > 0) {
    const { error: payError } = await supabase.rpc("registration_record_offline_payment", {
      p_registration: reg.id, p_amount: Number(reg.payable_amount), p_method: v.payment_method, p_reference: v.payment_reference || undefined,
    });
    if (payError) return rpcError(payError, "Registered, but the payment could not be recorded.");
  } else if (Number(reg.payable_amount) === 0) {
    await supabase.rpc("registration_set_status", { p_registration: reg.id, p_status: "confirmed" });
  }
  refresh(eventId, reg.id);
  return { ok: true, data: { id: reg.id }, message: "Registration added." };
}

export async function setRegistrationStatusAction(eventId: string, regId: string, status: "confirmed" | "cancelled" | "waitlisted", reason?: string): Promise<ActionResult> {
  if (!ids(eventId, regId) || !["confirmed", "cancelled", "waitlisted"].includes(status)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("registration_set_status", { p_registration: regId, p_status: status, p_reason: reason || undefined });
  if (error) return rpcError(error, "Could not update the registration.");
  refresh(eventId, regId);
  return { ok: true, message: `Registration ${status}.` };
}

export async function recordOfflinePaymentAction(eventId: string, regId: string, amount: number, method: string, reference?: string): Promise<ActionResult> {
  if (!ids(eventId, regId) || !(amount > 0) || !(PAYMENT_METHODS as readonly string[]).includes(method)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("registration_record_offline_payment", { p_registration: regId, p_amount: amount, p_method: method, p_reference: reference || undefined });
  if (error) return rpcError(error, "Could not record the payment.");
  refresh(eventId, regId);
  return { ok: true, message: "Payment recorded." };
}

export async function recordRefundAction(eventId: string, regId: string, amount: number, method: string, reason: string): Promise<ActionResult> {
  if (!ids(eventId, regId) || !(amount > 0) || !(PAYMENT_METHODS as readonly string[]).includes(method)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("registration_record_refund", { p_registration: regId, p_amount: amount, p_method: method, p_reason: reason });
  if (error) return rpcError(error, "Could not record the refund.");
  refresh(eventId, regId);
  return { ok: true, message: "Refund recorded in the ledger." };
}

export async function saveCompetitionAction(eventId: string, competitionId: string | null, input: unknown): Promise<ActionResult> {
  if (!ids(eventId) || (competitionId && !ids(competitionId))) return { ok: false, error: "Invalid request." };
  const parsed = competitionSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const row = {
    ...v, description: v.description || null, venue: v.venue || null, rules_url: v.rules_url || null,
    team_min: v.registration_type === "team" ? v.team_min : 1, team_max: v.registration_type === "team" ? v.team_max : 1,
  };
  const supabase = await createClient();
  if (competitionId) {
    const { data, error } = await supabase.from("event_competitions").update(row).eq("id", competitionId).eq("event_id", eventId).select("id");
    if (error) return error.code === "23505" ? { ok: false, error: "That code is already used." } : fromDbError(error, "Could not save.");
    if (!data?.length) return { ok: false, error: "You cannot edit competitions." };
  } else {
    const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
    const { error } = await supabase.from("event_competitions").insert({ ...row, event_id: eventId, college_id: event?.college_id ?? "" });
    if (error) return error.code === "23505" ? { ok: false, error: "That code is already used." } : fromDbError(error, "You cannot add competitions.");
  }
  refresh(eventId);
  return { ok: true, message: "Competition saved." };
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export async function createApiCredentialAction(eventId: string, name: string, environment: "sandbox" | "production"): Promise<ActionResult<{ key: string }>> {
  if (!ids(eventId) || !["sandbox", "production"].includes(environment)) return { ok: false, error: "Invalid request." };
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const prefixId = Array.from(randomBytes(10), (b) => alphabet[b % alphabet.length]).join("");
  const env = environment === "production" ? "live" : "test";
  const keyPrefix = `eak_${env}_${prefixId}`;
  const key = `${keyPrefix}_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(key).digest("hex");
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_api_credential", { p_event: eventId, p_name: name.slice(0, 80), p_environment: environment, p_key_prefix: keyPrefix, p_key_hash: hash });
  if (error) return rpcError(error, "Could not create the key.");
  revalidatePath(`/events/${eventId}/integrations`);
  return { ok: true, data: { key }, message: "Key created. Copy it now — it will not be shown again." };
}

export async function revokeApiCredentialAction(eventId: string, credentialId: string): Promise<ActionResult> {
  if (!ids(eventId, credentialId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_api_credential", { p_credential: credentialId });
  if (error) return rpcError(error, "Could not revoke the key.");
  revalidatePath(`/events/${eventId}/integrations`);
  return { ok: true, message: "Key revoked. Requests using it are rejected immediately." };
}

export async function updateIntegrationSettingsAction(eventId: string, websiteUrl: string, mode: "sandbox" | "production"): Promise<ActionResult> {
  if (!ids(eventId) || !["sandbox", "production"].includes(mode)) return { ok: false, error: "Invalid request." };
  if (websiteUrl && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(websiteUrl)) return { ok: false, error: "Enter a full website URL starting with https://" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("event_settings").update({ integration_mode: mode }).eq("event_id", eventId).select("event_id");
  if (error || !data?.length) return fromDbError(error, "You cannot manage this integration.");
  const { error: urlError } = await supabase.from("events").update({ website_url: websiteUrl || null }).eq("id", eventId);
  if (urlError) return fromDbError(urlError, "Mode saved, but only event managers can change the website URL.");
  revalidatePath(`/events/${eventId}/integrations`);
  return { ok: true, message: "Integration settings saved." };
}

export async function clearSandboxDataAction(eventId: string): Promise<ActionResult> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clear_sandbox_data", { p_event: eventId });
  if (error) return rpcError(error, "Could not clear test data.");
  refresh(eventId);
  revalidatePath(`/events/${eventId}/integrations`);
  return { ok: true, message: `Removed ${data ?? 0} test registration(s).` };
}

/** Configuration self-check shown in Integration Settings. */
export async function testConnectionAction(eventId: string): Promise<ActionResult<{ checks: { label: string; ok: boolean; detail: string }[] }>> {
  if (!ids(eventId)) return { ok: false, error: "Invalid event." };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "integrations.manage" });
  if (!allowed) return { ok: false, error: "You cannot manage integrations." };
  const [{ data: creds }, { data: comps }, { data: settings }] = await Promise.all([
    supabase.from("api_credentials").select("environment, revoked_at, last_used_at").eq("event_id", eventId),
    supabase.from("event_competitions").select("id").eq("event_id", eventId).eq("is_active", true),
    supabase.from("event_settings").select("integration_mode").eq("event_id", eventId).single(),
  ]);
  const active = (creds ?? []).filter((c) => !c.revoked_at);
  const mode = settings?.integration_mode ?? "sandbox";
  const checks = [
    { label: "Server API enabled", ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), detail: process.env.SUPABASE_SERVICE_ROLE_KEY ? "Service credentials are configured." : "Add SUPABASE_SERVICE_ROLE_KEY in Vercel." },
    { label: "Active API key", ok: active.some((c) => (mode === "production" ? c.environment === "production" : true)), detail: `${active.length} active key(s); mode is ${mode}.` },
    { label: "Competitions published", ok: (comps ?? []).length > 0, detail: `${(comps ?? []).length} active competition(s).` },
    { label: "Online payments (Razorpay)", ok: mode === "sandbox" || razorpayConfigured(), detail: razorpayConfigured() ? "API keys configured." : mode === "sandbox" ? "Not needed in sandbox mode." : "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
    { label: "Payment webhook secret", ok: mode === "sandbox" || webhookConfigured(), detail: webhookConfigured() ? "RAZORPAY_WEBHOOK_SECRET configured." : mode === "sandbox" ? "Not needed in sandbox mode." : "Add RAZORPAY_WEBHOOK_SECRET." },
    { label: "Website has called the API", ok: active.some((c) => c.last_used_at), detail: active.some((c) => c.last_used_at) ? "Requests received." : "No requests yet." },
  ];
  return { ok: true, data: { checks } };
}
