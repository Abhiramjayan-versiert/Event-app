"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";
import { emailConfigured } from "@/lib/email/send";
import { sendTicketEmail } from "@/features/public/ticket-email";

const uuid = z.string().uuid();

export type CheckInResult = {
  result: "ok" | "already" | "not_confirmed" | "cancelled" | "not_found";
  id?: string; registration_number?: string; participant_name?: string; participant_college?: string | null; team_name?: string | null;
  status?: string; payment_status?: string; checked_in_at?: string | null; is_test?: boolean; items?: string[];
};

export async function checkInAction(eventId: string, code: string): Promise<ActionResult<CheckInResult>> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const cleaned = code.trim().slice(0, 300);
  if (!cleaned) return { ok: false, error: "Scan or type a ticket code." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_in_ticket", { p_event: eventId, p_code: cleaned });
  if (error) return fromDbError(error, "Check-in failed.");
  return { ok: true, data: data as CheckInResult };
}

export async function undoCheckInAction(eventId: string, registrationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(registrationId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_check_in", { p_registration: registrationId });
  if (error) return fromDbError(error, "Could not undo the check-in.");
  revalidatePath(`/events/${eventId}/registrations/${registrationId}`);
  return { ok: true, message: "Check-in undone." };
}

export async function emailTicketAction(eventId: string, registrationId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(registrationId).success) return { ok: false, error: "Invalid request." };
  if (!emailConfigured()) return { ok: false, error: "Email sending isn't set up yet (SMTP settings on the server)." };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "registrations.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to email tickets." };
  const { data: r } = await supabase
    .from("registrations")
    .select("email, participant_name, ticket_code, registration_number, status, event:events(name)")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!r) return { ok: false, error: "Registration not found." };
  const sent = await sendTicketEmail({ email: r.email, participant_name: r.participant_name, event_name: r.event?.name ?? "the event", ticket_code: r.ticket_code, registration_number: r.registration_number, status: r.status });
  return sent ? { ok: true, message: `Ticket emailed to ${r.email}.` } : { ok: false, error: "The email could not be sent. Check the SMTP settings." };
}
