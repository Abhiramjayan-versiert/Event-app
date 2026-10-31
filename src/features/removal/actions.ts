"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";

const uuid = z.string().uuid();
const reasonOf = (r: string | null | undefined) => (r ?? "").trim().slice(0, 500);
const err = (e: { code?: string; message: string }, fallback: string): ActionResult =>
  e.code === "42501" || e.code === "22023" ? { ok: false, error: e.message } : fromDbError(e, fallback);

function refreshEvent(eventId: string) {
  revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/events");
  revalidatePath("/dashboard");
}

export async function cancelEventAction(eventId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_event", { p_event: eventId, p_reason: reasonOf(reason) });
  if (error) return err(error, "Could not cancel the event.");
  refreshEvent(eventId);
  return { ok: true, message: "Event cancelled. Registrations are closed and all records are kept." };
}

export async function restoreEventAction(eventId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_event", { p_event: eventId });
  if (error) return err(error, "Could not restore the event.");
  refreshEvent(eventId);
  return { ok: true, message: "Event restored to Planning. Set its status when you are ready." };
}

export async function cancelCompetitionAction(eventId: string, competitionId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_competition", { p_competition: competitionId, p_reason: reasonOf(reason) });
  if (error) return err(error, "Could not cancel the competition.");
  refreshEvent(eventId);
  return { ok: true, message: "Competition cancelled and closed for registration." };
}

export async function restoreCompetitionAction(eventId: string, competitionId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_competition", { p_competition: competitionId });
  if (error) return err(error, "Could not restore the competition.");
  refreshEvent(eventId);
  return { ok: true, message: "Competition restored and open again." };
}

export async function deleteCompetitionAction(eventId: string, competitionId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_competition", { p_competition: competitionId, p_reason: reasonOf(reason) });
  if (error) return err(error, "Could not delete the competition.");
  refreshEvent(eventId);
  return { ok: true, message: "Competition deleted." };
}

/** Super Admin: empty the dashboard list of items cancelled or deleted by other admins. */
export async function clearRemovalLogAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clear_removal_log");
  if (error) return err(error, "Could not clear the list.");
  revalidatePath("/dashboard");
  return { ok: true, message: `Cleared ${data ?? 0} item${data === 1 ? "" : "s"}.` };
}
