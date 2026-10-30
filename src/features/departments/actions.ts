"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { announcementSchema, assignmentSchema, departmentSchema, eventRoleSchema } from "@/lib/validations/department";
import { findOrInviteUser } from "@/features/users/invite.server";

const uuid = z.string().uuid();

/** Maps errors raised by the department RPCs to readable messages. */
function rpcError(error: { code?: string; message: string }, fallback: string): ActionResult<never> {
  if (["42501", "P0002", "22023", "23505"].includes(error.code ?? "")) return { ok: false, error: error.message };
  return fromDbError(error, fallback);
}

async function resolveUser(input: { user_id?: string; email?: string; full_name?: string }) {
  if (input.user_id) return { userId: input.user_id, invited: false };
  return findOrInviteUser({ email: input.email!, full_name: input.full_name! });
}

function refresh(eventId: string, departmentId?: string) {
  revalidatePath(`/events/${eventId}/departments`);
  revalidatePath(`/events/${eventId}/team`);
  if (departmentId) revalidatePath(`/events/${eventId}/departments/${departmentId}`);
}

export async function createDepartmentAction(eventId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
  if (!event) return { ok: false, error: "Event not found." };
  const { data, error } = await supabase
    .from("departments")
    .insert({ ...parsed.data, description: parsed.data.description || null, event_id: eventId, college_id: event.college_id })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A department with this name already exists.", fieldErrors: { name: ["Name already used"] } };
    return fromDbError(error, "Could not create the department.");
  }
  refresh(eventId);
  return { ok: true, data: { id: data.id }, message: "Department created." };
}

export async function updateDepartmentAction(eventId: string, departmentId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(departmentId).success) return { ok: false, error: "Invalid request." };
  const parsed = departmentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update({ ...parsed.data, description: parsed.data.description || null })
    .eq("id", departmentId)
    .eq("event_id", eventId)
    .select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A department with this name already exists." };
    return fromDbError(error, "Could not update the department.");
  }
  if (!data?.length) return { ok: false, error: "You do not have permission to edit this department." };
  refresh(eventId, departmentId);
  return { ok: true, message: "Department updated." };
}

export async function assignDepartmentMemberAction(eventId: string, departmentId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(departmentId).success) return { ok: false, error: "Invalid request." };
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();

  const needed = parsed.data.position === "member" ? "department.members.manage" : "departments.manage";
  const { data: allowed } = await supabase.rpc("check_permission", {
    p_scope: parsed.data.position === "member" ? "department" : "event",
    p_id: parsed.data.position === "member" ? departmentId : eventId,
    p_permission: needed,
  });
  if (!allowed) return { ok: false, error: "You do not have permission to make this appointment." };

  let user: { userId: string; invited: boolean };
  try {
    user = await resolveUser(parsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { error } = await supabase.rpc("assign_department_member", {
    p_department: departmentId,
    p_user: user.userId,
    p_position: parsed.data.position,
    p_role_key: parsed.data.role_key || undefined,
  });
  if (error) return rpcError(error, "Could not assign the member.");
  refresh(eventId, departmentId);
  return { ok: true, message: user.invited ? `Invitation sent to ${parsed.data.email} and assigned.` : "Assignment saved." };
}

export async function endDepartmentAssignmentAction(eventId: string, departmentId: string, assignmentId: string): Promise<ActionResult> {
  if (![eventId, departmentId, assignmentId].every((v) => uuid.safeParse(v).success)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_department_assignment", { p_assignment: assignmentId, p_reason: "Removed from department" });
  if (error) return rpcError(error, "Could not remove the member.");
  refresh(eventId, departmentId);
  return { ok: true, message: "Removed. The assignment stays in the department history." };
}

export async function removeUserFromEventAction(eventId: string, userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(userId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_user_from_event", { p_event: eventId, p_user: userId, p_reason: "Removed from event" });
  if (error) return rpcError(error, "Could not remove the person.");
  refresh(eventId);
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: "Removed from the event. Their open tasks were unassigned." };
}

export async function assignEventRoleAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = eventRoleSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "event.members.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to manage the event team." };
  let user: { userId: string; invited: boolean };
  try {
    user = await resolveUser(parsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const { error } = await supabase.rpc("assign_event_role", { p_event: eventId, p_user: user.userId, p_role_key: parsed.data.role_key });
  if (error) return rpcError(error, "Could not add the person.");
  refresh(eventId);
  revalidatePath(`/events/${eventId}/settings`);
  return { ok: true, message: user.invited ? `Invitation sent to ${parsed.data.email}.` : "Added to the event." };
}

export async function postDepartmentAnnouncementAction(eventId: string, departmentId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(departmentId).success) return { ok: false, error: "Invalid request." };
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase.from("announcements").insert({
    scope: "department",
    event_id: eventId,
    department_id: departmentId,
    title: parsed.data.title,
    body: parsed.data.body,
    priority: parsed.data.priority,
    pinned: parsed.data.pinned,
    created_by: me.user?.id ?? null,
  });
  if (error) return fromDbError(error, "Could not post the announcement.");
  refresh(eventId, departmentId);
  return { ok: true, message: "Announcement posted." };
}

export async function deleteAnnouncementAction(eventId: string, departmentId: string, announcementId: string): Promise<ActionResult> {
  if (![eventId, departmentId, announcementId].every((v) => uuid.safeParse(v).success)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("announcements").delete().eq("id", announcementId).select("id");
  if (error || !data?.length) return fromDbError(error, "Only the author can delete this announcement.");
  refresh(eventId, departmentId);
  return { ok: true, message: "Announcement deleted." };
}
