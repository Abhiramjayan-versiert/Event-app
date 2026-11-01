"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";

const uuid = z.string().uuid();
const fail = (e: { code?: string; message: string }, fallback: string): ActionResult =>
  ["42501", "P0002", "22023"].includes(e.code ?? "") ? { ok: false, error: e.message } : fromDbError(e, fallback);
const refresh = (eventId: string) => {
  revalidatePath(`/events/${eventId}`, "layout");
};

export async function setAllDepartmentsAction(eventId: string, userId: string, all: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_all_departments_access", { p_event: eventId, p_user: userId, p_all: all });
  if (error) return fail(error, "Could not change access.");
  refresh(eventId);
  return { ok: true, message: all ? "Access to all departments given." : "Limited to their own department." };
}

export async function grantDepartmentAccessAction(eventId: string, departmentId: string, userId: string, access: "view" | "manage"): Promise<ActionResult> {
  if (![eventId, departmentId, userId].every((v) => uuid.safeParse(v).success) || !["view", "manage"].includes(access)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_department_access", { p_department: departmentId, p_user: userId, p_access: access });
  if (error) return fail(error, "Could not give access.");
  refresh(eventId);
  return { ok: true, message: "Access given. They are notified." };
}

export async function revokeDepartmentAccessAction(eventId: string, grantId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(grantId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_department_access", { p_grant: grantId });
  if (error) return fail(error, "Could not remove access.");
  refresh(eventId);
  return { ok: true, message: "Access removed." };
}
