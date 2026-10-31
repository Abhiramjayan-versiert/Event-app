"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import {
  SPONSOR_STAGES, dealSchema, deliverableSchema, packageSchema, sponsorSchema, sponsorshipPaymentSchema,
} from "@/lib/validations/sponsorship";

const uuid = z.string().uuid();
const ids = (...v: string[]) => v.every((x) => uuid.safeParse(x).success);
const nil = (v: string | undefined) => (v ? v : null);
const refresh = (eventId: string, dealId?: string) => {
  revalidatePath(`/events/${eventId}/sponsorship`);
  if (dealId) revalidatePath(`/events/${eventId}/sponsorship/deals/${dealId}`);
};
async function collegeOf(eventId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("events").select("college_id").eq("id", eventId).single();
  return { supabase, collegeId: data?.college_id ?? "" };
}

export async function saveSponsorAction(eventId: string, sponsorId: string | null, input: unknown, createDeal = false): Promise<ActionResult<{ id: string; dealId?: string }>> {
  if (!ids(eventId) || (sponsorId && !ids(sponsorId))) return { ok: false, error: "Invalid request." };
  const parsed = sponsorSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const row = {
    company_name: v.company_name, brand_name: nil(v.brand_name), contact_person: nil(v.contact_person), designation: nil(v.designation),
    email: nil(v.email), phone: nil(v.phone), address: nil(v.address), website: nil(v.website), category: nil(v.category),
    assigned_to: nil(v.assigned_to), notes: nil(v.notes),
  };
  const { supabase, collegeId } = await collegeOf(eventId);
  if (sponsorId) {
    const { data, error } = await supabase.from("sponsors").update(row).eq("id", sponsorId).eq("event_id", eventId).select("id");
    if (error || !data?.length) return fromDbError(error, "You cannot edit sponsors.");
    refresh(eventId);
    return { ok: true, data: { id: sponsorId }, message: "Sponsor saved." };
  }
  const { data, error } = await supabase.from("sponsors").insert({ ...row, event_id: eventId, college_id: collegeId }).select("id").single();
  if (error) return fromDbError(error, "You cannot add sponsors.");
  let dealId: string | undefined;
  if (createDeal) {
    const { data: deal } = await supabase
      .from("sponsorship_deals")
      .insert({ event_id: eventId, college_id: collegeId, sponsor_id: data.id, stage: "lead_identified", owner_id: nil(v.assigned_to) })
      .select("id")
      .single();
    dealId = deal?.id;
  }
  refresh(eventId);
  return { ok: true, data: { id: data.id, dealId }, message: "Sponsor added to the pipeline." };
}

export async function saveDealAction(eventId: string, dealId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!ids(eventId) || (dealId && !ids(dealId))) return { ok: false, error: "Invalid request." };
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const row = {
    package_id: nil(v.package_id), stage: v.stage, proposed_amount: v.proposed_amount, agreed_amount: v.agreed_amount,
    expected_payment_date: nil(v.expected_payment_date), owner_id: nil(v.owner_id), notes: nil(v.notes),
  };
  const { supabase, collegeId } = await collegeOf(eventId);
  if (dealId) {
    const { data, error } = await supabase.from("sponsorship_deals").update(row).eq("id", dealId).eq("event_id", eventId).select("id");
    if (error || !data?.length) return fromDbError(error, "You cannot edit deals.");
    refresh(eventId, dealId);
    return { ok: true, data: { id: dealId }, message: "Deal saved." };
  }
  const { data, error } = await supabase.from("sponsorship_deals").insert({ ...row, sponsor_id: v.sponsor_id, event_id: eventId, college_id: collegeId }).select("id").single();
  if (error) return fromDbError(error, "You cannot create deals.");
  refresh(eventId, data.id);
  return { ok: true, data: { id: data.id }, message: "Deal created." };
}

export async function setDealStageAction(eventId: string, dealId: string, stage: string): Promise<ActionResult> {
  const s = z.enum(SPONSOR_STAGES).safeParse(stage);
  if (!ids(eventId, dealId) || !s.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("sponsorship_deals").update({ stage: s.data }).eq("id", dealId).eq("event_id", eventId).select("id");
  if (error || !data?.length) return fromDbError(error, "You cannot move deals.");
  refresh(eventId, dealId);
  return { ok: true, message: "Stage updated." };
}

export async function savePackageAction(eventId: string, packageId: string | null, input: unknown): Promise<ActionResult> {
  if (!ids(eventId) || (packageId && !ids(packageId))) return { ok: false, error: "Invalid request." };
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const row = {
    name: v.name, tier_order: v.tier_order, amount: v.amount, description: nil(v.description), max_slots: v.max_slots, is_active: v.is_active,
    benefits: (v.benefits ?? "").split("\n").map((b) => b.trim()).filter(Boolean),
  };
  const { supabase, collegeId } = await collegeOf(eventId);
  const res = packageId
    ? await supabase.from("sponsorship_packages").update(row).eq("id", packageId).eq("event_id", eventId).select("id")
    : await supabase.from("sponsorship_packages").insert({ ...row, is_custom: true, event_id: eventId, college_id: collegeId }).select("id");
  if (res.error) return res.error.code === "23505" ? { ok: false, error: "A package with this name exists." } : fromDbError(res.error, "You cannot manage packages.");
  if (!res.data?.length) return { ok: false, error: "You cannot manage packages." };
  refresh(eventId);
  return { ok: true, message: "Package saved." };
}

export async function recordSponsorshipPaymentAction(eventId: string, dealId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId, dealId)) return { ok: false, error: "Invalid request." };
  const parsed = sponsorshipPaymentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: deal } = await supabase.from("sponsorship_deals").select("sponsor_id, college_id").eq("id", dealId).eq("event_id", eventId).single();
  if (!deal) return { ok: false, error: "Deal not found." };
  const { error } = await supabase.from("sponsorship_payments").insert({
    event_id: eventId, college_id: deal.college_id, deal_id: dealId, sponsor_id: deal.sponsor_id, amount: v.amount, paid_on: v.paid_on,
    payment_method: v.payment_method, reference: nil(v.reference), notes: nil(v.notes), status: "pending",
  });
  if (error) return fromDbError(error, "You cannot record sponsorship payments.");
  refresh(eventId, dealId);
  revalidatePath(`/events/${eventId}/finance`);
  return { ok: true, message: "Payment recorded. Finance has been asked to verify it." };
}

export async function verifySponsorshipPaymentAction(eventId: string, paymentId: string, approve: boolean, note?: string): Promise<ActionResult> {
  if (!ids(eventId, paymentId)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_sponsorship_payment", { p_payment: paymentId, p_approve: approve, p_note: note || undefined });
  if (error) return ["42501", "22023", "P0002"].includes(error.code ?? "") ? { ok: false, error: error.message } : fromDbError(error, "Could not process the payment.");
  refresh(eventId);
  revalidatePath(`/events/${eventId}/sponsorship`, "layout");
  revalidatePath(`/events/${eventId}/finance`);
  return { ok: true, message: approve ? "Payment verified and booked in the ledger." : "Payment rejected." };
}

export async function addDeliverableAction(eventId: string, dealId: string, input: unknown): Promise<ActionResult> {
  if (!ids(eventId, dealId)) return { ok: false, error: "Invalid request." };
  const parsed = deliverableSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  const { supabase, collegeId } = await collegeOf(eventId);
  const { error } = await supabase.from("sponsorship_deliverables").insert({
    event_id: eventId, college_id: collegeId, deal_id: dealId, deliverable_type: v.deliverable_type, description: nil(v.description),
    due_date: nil(v.due_date), owner_id: nil(v.owner_id),
  });
  if (error) return fromDbError(error, "You cannot add deliverables.");
  refresh(eventId, dealId);
  return { ok: true, message: "Deliverable added." };
}

export async function setDeliverableStatusAction(eventId: string, deliverableId: string, status: string): Promise<ActionResult> {
  const s = z.enum(["pending", "in_progress", "completed", "cancelled"]).safeParse(status);
  if (!ids(eventId, deliverableId) || !s.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("sponsorship_deliverables").update({ status: s.data }).eq("id", deliverableId).eq("event_id", eventId).select("deal_id");
  if (error || !data?.length) return fromDbError(error, "You cannot update deliverables.");
  refresh(eventId, data[0].deal_id);
  return { ok: true, message: "Deliverable updated." };
}

