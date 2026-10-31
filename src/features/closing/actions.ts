"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";

const input = z.object({ eventId: z.string().uuid(), text: z.string().trim().min(3, "Please write at least a few words.").max(2000) });

function refresh(eventId: string) {
  revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/events");
}

export async function closeEventFinancesAction(eventId: string, note: string): Promise<ActionResult> {
  const parsed = input.safeParse({ eventId, text: note });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_event_finances", { p_event: parsed.data.eventId, p_note: parsed.data.text });
  if (error) return fromDbError(error, "Could not close the event finances.");
  refresh(eventId);
  return { ok: true, message: "Event finances closed. The final figures are frozen in the closing report." };
}

export async function reopenEventFinancesAction(eventId: string, reason: string): Promise<ActionResult> {
  const parsed = input.safeParse({ eventId, text: reason });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_event_finances", { p_event: parsed.data.eventId, p_reason: parsed.data.text });
  if (error) return fromDbError(error, "Could not reopen the event finances.");
  refresh(eventId);
  return { ok: true, message: "Finances reopened. Close them again once the correction is recorded." };
}
