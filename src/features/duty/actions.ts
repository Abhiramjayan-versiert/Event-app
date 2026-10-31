"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";

const uuid = z.string().uuid();
const shiftSchema = z.object({
  title: z.string().trim().min(2, "Enter a duty name").max(120),
  location: z.string().trim().max(160),
  department_id: z.string().uuid().or(z.literal("")),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  needed: z.number().int().min(1).max(500),
  notes: z.string().trim().max(1000),
}).refine((v) => v.ends_at > v.starts_at, { message: "The shift must end after it starts" });

const done = (eventId: string, message: string): ActionResult => {
  revalidatePath(`/events/${eventId}/duty-roster`);
  return { ok: true, message };
};

export async function saveShiftAction(eventId: string, shiftId: string | null, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || (shiftId && !uuid.safeParse(shiftId).success)) return { ok: false, error: "Invalid request." };
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the shift details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_duty_shift", { p_event: eventId, p_shift: (shiftId ?? null) as unknown as string, p_data: parsed.data as never });
  if (error) return fromDbError(error, "Could not save the shift.");
  return done(eventId, shiftId ? "Shift updated." : "Shift added.");
}

export async function removeShiftAction(eventId: string, shiftId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(shiftId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_duty_shift", { p_shift: shiftId });
  if (error) return fromDbError(error, "Could not remove the shift.");
  return done(eventId, "Shift removed.");
}

export async function assignDutyAction(eventId: string, shiftId: string, userId: string): Promise<ActionResult> {
  if (![eventId, shiftId, userId].every((v) => uuid.safeParse(v).success)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_duty", { p_shift: shiftId, p_user: userId });
  if (error) return fromDbError(error, "Could not assign the duty.");
  return done(eventId, "Assigned. They were notified.");
}

export async function unassignDutyAction(eventId: string, assignmentId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(assignmentId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unassign_duty", { p_assignment: assignmentId });
  if (error) return fromDbError(error, "Could not remove the assignment.");
  return done(eventId, "Removed from the shift.");
}

export async function markDutyAction(eventId: string, assignmentId: string, status: "assigned" | "present" | "absent"): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(assignmentId).success || !["assigned", "present", "absent"].includes(status)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_duty", { p_assignment: assignmentId, p_status: status });
  if (error) return fromDbError(error, "Could not update attendance.");
  return done(eventId, status === "present" ? "Marked present." : status === "absent" ? "Marked absent." : "Reset.");
}
