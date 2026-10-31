"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";
import { publicEnv } from "@/lib/env";
import { emailConfigured, emailLayout, sendEmail } from "@/lib/email/send";
import type { Json } from "@/lib/database.types";

const uuid = z.string().uuid();
const settingsSchema = z.object({
  signatory_1_name: z.string().trim().max(80), signatory_1_title: z.string().trim().max(80),
  signatory_2_name: z.string().trim().max(80), signatory_2_title: z.string().trim().max(80),
  footer: z.string().trim().max(160),
});

export async function issueCertificatesAction(eventId: string, kind: "participation" | "winner", onlyCheckedIn: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !["participation", "winner"].includes(kind)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_certificates", { p_event: eventId, p_kind: kind, p_only_checked_in: onlyCheckedIn });
  if (error) return fromDbError(error, "Could not issue certificates.");
  revalidatePath(`/events/${eventId}/certificates`);
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `${n} certificate${n === 1 ? "" : "s"} issued.` : "Everyone eligible already has a certificate." };
}

export async function setCertificateRevokedAction(eventId: string, certificateId: string, revoked: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(certificateId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_certificate_revoked", { p_certificate: certificateId, p_revoked: revoked, p_reason: revoked ? "Revoked by organiser" : undefined });
  if (error) return fromDbError(error, "Could not update the certificate.");
  revalidatePath(`/events/${eventId}/certificates`);
  return { ok: true, message: revoked ? "Certificate revoked. Its verification page now says so." : "Certificate restored." };
}

export async function saveCertificateSettingsAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid request." };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the certificate details." };
  const supabase = await createClient();
  const { data: current } = await supabase.from("event_settings").select("branding").eq("event_id", eventId).single();
  const branding = { ...((current?.branding as Record<string, Json>) ?? {}), certificate: parsed.data };
  const { data, error } = await supabase.from("event_settings").update({ branding }).eq("event_id", eventId).select("event_id");
  if (error || !data?.length) return fromDbError(error, "Only event managers can change the certificate design.");
  revalidatePath(`/events/${eventId}/certificates`);
  return { ok: true, message: "Certificate details saved." };
}

/** Emails certificate links that haven't been sent yet (up to 80 per click, Gmail-friendly). */
export async function emailCertificatesAction(eventId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid request." };
  if (!emailConfigured()) return { ok: false, error: "Email sending isn't set up yet (SMTP settings on the server)." };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "registrations.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to email certificates." };
  const [{ data: certs }, { data: ev }] = await Promise.all([
    supabase.from("certificates").select("id, code, title, recipient_name, recipient_email").eq("event_id", eventId)
      .is("emailed_at", null).is("revoked_at", null).not("recipient_email", "is", null).order("issued_at").limit(80),
    supabase.from("events").select("name").eq("id", eventId).single(),
  ]);
  if (!certs?.length) return { ok: true, message: "All certificates with an email address have been sent." };
  const sent: string[] = [];
  for (const c of certs) {
    const url = `${publicEnv.appUrl}/c/${c.code.toLowerCase()}`;
    const { html, text } = emailLayout(`Your certificate from ${ev?.name ?? "the event"}`, [
      `Hi ${c.recipient_name},`,
      `Your ${c.title.toLowerCase()} is ready. Open it to download the PDF. Anyone can verify it with the QR code on the certificate.`,
    ], { label: "Download certificate", url });
    if (await sendEmail(c.recipient_email!, `Your certificate · ${ev?.name ?? ""}`, html, text)) sent.push(c.id);
  }
  if (sent.length) await supabase.rpc("mark_certificates_emailed", { p_ids: sent });
  revalidatePath(`/events/${eventId}/certificates`);
  const failed = certs.length - sent.length;
  return failed
    ? { ok: false, error: `${sent.length} sent, ${failed} failed. Check the SMTP settings and try again.` }
    : { ok: true, message: `${sent.length} certificate email${sent.length === 1 ? "" : "s"} sent.${certs.length === 80 ? " Click again for the next batch." : ""}` };
}
