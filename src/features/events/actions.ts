"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { eventAdminSchema, eventSchema, eventToRow, registrationSettingsSchema, EVENT_STATUSES } from "@/lib/validations/event";
import { slugify } from "@/lib/utils";
import { findOrInviteUser } from "@/features/users/invite.server";
import type { Json } from "@/lib/database.types";

const uuid = z.string().uuid();

export async function createEventAction(input: unknown, tzOffsetMinutes: number, admin?: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const adminParsed = admin ? eventAdminSchema.safeParse(admin) : null;
  if (adminParsed && !adminParsed.success) return fromZodError(adminParsed.error);

  const supabase = await createClient();
  const slug = parsed.data.slug || slugify(parsed.data.name) || `event-${Date.now()}`;
  const { data, error } = await supabase
    .from("events")
    .insert({ ...eventToRow(parsed.data, tzOffsetMinutes), college_id: parsed.data.college_id, slug })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another event in this college already uses that URL slug.", fieldErrors: { slug: ["Slug already in use"] } };
    if (error.code === "42501") return { ok: false, error: "You are not allowed to create events in this college." };
    return fromDbError(error, "Could not create the event.");
  }

  let message = "Event created. Its workspace, departments and sponsorship packages are ready.";
  if (adminParsed?.success) {
    const result = await addEventAdminAction(data.id, adminParsed.data);
    message += result.ok ? ` ${result.message}` : ` The event admin could not be added: ${result.error}`;
  }

  revalidatePath("/events");
  revalidatePath("/dashboard");
  revalidatePath(`/colleges/${parsed.data.college_id}`);
  return { ok: true, data: { id: data.id }, message };
}

export async function updateEventAction(eventId: string, input: unknown, tzOffsetMinutes: number): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const update = { ...eventToRow(parsed.data, tzOffsetMinutes), ...(parsed.data.slug ? { slug: parsed.data.slug } : {}) };
  const { data, error } = await supabase.from("events").update(update).eq("id", eventId).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another event in this college already uses that URL slug.", fieldErrors: { slug: ["Slug already in use"] } };
    return fromDbError(error, "Could not update the event.");
  }
  if (!data?.length) return { ok: false, error: "You do not have permission to edit this event." };
  revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/events");
  return { ok: true, message: "Event updated." };
}

export async function setEventStatusAction(eventId: string, status: string): Promise<ActionResult> {
  const parsedStatus = z.enum(EVENT_STATUSES).safeParse(status);
  if (!uuid.safeParse(eventId).success || !parsedStatus.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update({ status: parsedStatus.data }).eq("id", eventId).select("id");
  if (error) return fromDbError(error, "Could not change the event status.");
  if (!data?.length) return { ok: false, error: "You do not have permission to change this event." };
  revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/events");
  return { ok: true, message: parsedStatus.data === "archived" ? "Event archived. All records remain available for reporting." : "Event status updated." };
}

export async function setEventImageAction(eventId: string, field: "logo_path" | "banner_path", path: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !["logo_path", "banner_path"].includes(field)) return { ok: false, error: "Invalid request." };
  if (path !== null && !path.startsWith(`events/${eventId}/`)) return { ok: false, error: "Invalid image path." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("events").update(field === "logo_path" ? { logo_path: path } : { banner_path: path }).eq("id", eventId).select("id");
  if (error || !data?.length) return fromDbError(error, "Could not update the image.");
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true };
}

export async function updateRegistrationSettingsAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = registrationSettingsSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: current } = await supabase.from("event_settings").select("registration_settings").eq("event_id", eventId).single();
  const merged = { ...((current?.registration_settings as Record<string, Json>) ?? {}), ...parsed.data };
  const { data, error } = await supabase.from("event_settings").update({ registration_settings: merged }).eq("event_id", eventId).select("event_id");
  if (error || !data?.length) return fromDbError(error, "Could not save registration settings.");
  revalidatePath(`/events/${eventId}/settings`);
  return { ok: true, message: "Registration settings saved." };
}

export async function addEventAdminAction(eventId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = eventAdminSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("check_permission", { p_scope: "event", p_id: eventId, p_permission: "event.members.manage" });
  if (!allowed) return { ok: false, error: "You do not have permission to appoint event administrators." };

  let user: { userId: string; invited: boolean };
  try {
    user = await findOrInviteUser(parsed.data);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const [{ data: role }, { data: event }, { data: me }] = await Promise.all([
    supabase.from("roles").select("id").eq("key", "event_admin").single(),
    supabase.from("events").select("college_id, name").eq("id", eventId).single(),
    supabase.auth.getUser(),
  ]);
  if (!role || !event) return { ok: false, error: "Event or role not found." };

  const { error } = await supabase.from("event_members").insert({
    event_id: eventId,
    college_id: event.college_id,
    user_id: user.userId,
    role_id: role.id,
    invited_by: me.user?.id ?? null,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "This person is already an Event Admin for this event." };
    return fromDbError(error, "Could not appoint the event administrator.");
  }
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: user.invited ? `Invitation sent to ${parsed.data.email}.` : `${parsed.data.full_name} is now an Event Admin.` };
}

export async function endEventMembershipAction(eventId: string, membershipId: string, reason?: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(membershipId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_members")
    .update({ ended_at: new Date().toISOString(), end_reason: reason?.slice(0, 300) || null })
    .eq("id", membershipId)
    .eq("event_id", eventId)
    .is("ended_at", null)
    .select("id");
  if (error) return fromDbError(error, "Could not remove the member.");
  if (!data?.length) return { ok: false, error: "Membership not found or you do not have permission." };
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: "Removed from the event. The assignment stays in the history." };
}

/**
 * Permanently deletes an event that has no registrations, payments or
 * financial records (Super Admin / College Admin; enforced in the database).
 */
export async function deleteEventAction(eventId: string, confirmName: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_event", { p_event: eventId, p_confirm_name: confirmName.slice(0, 200) });
  if (error) return error.code === "42501" ? { ok: false, error: error.message } : fromDbError(error, "Could not delete the event.");
  // Remove the uploaded files of the deleted document records (best effort).
  const paths = ((data as { document_paths?: string[] } | null)?.document_paths ?? []).filter(Boolean);
  if (paths.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    await createAdminClient().storage.from("documents").remove(paths).catch(() => undefined);
  }
  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { ok: true, message: "Event deleted." };
}

/** Changes an event-wide role: grants the new role first, then ends the old one. */
export async function changeEventRoleAction(eventId: string, membershipId: string, roleKey: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(membershipId).success || !/^[a-z_]{2,64}$/.test(roleKey)) {
    return { ok: false, error: "Invalid request." };
  }
  const supabase = await createClient();
  const { data: m } = await supabase
    .from("event_members")
    .select("user_id, role:roles(key)")
    .eq("id", membershipId)
    .eq("event_id", eventId)
    .is("ended_at", null)
    .maybeSingle();
  if (!m) return { ok: false, error: "Membership not found or you do not have permission." };
  if (m.role?.key === roleKey) return { ok: true, message: "No change." };
  const { error } = await supabase.rpc("assign_event_role", { p_event: eventId, p_user: m.user_id, p_role_key: roleKey });
  if (error) return fromDbError(error, "Could not change the role.");
  const ended = await endEventMembershipAction(eventId, membershipId, `Role changed to ${roleKey}`);
  if (!ended.ok) return ended;
  return { ok: true, message: "Role changed." };
}

const cloneSchema = z
  .object({
    name: z.string().trim().min(3, "Enter a name").max(150),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes").max(80),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
    ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date"),
    include_team: z.boolean(),
  })
  .refine((v) => v.ends_on >= v.starts_on, { message: "The end date must be on or after the start date", path: ["ends_on"] });

/** Creates a new event from an existing one (structure, schedule, checklist, budget split; optionally the team). */
export async function cloneEventAction(sourceId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(sourceId).success) return { ok: false, error: "Invalid request." };
  const parsed = cloneSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clone_event", {
    p_source: sourceId, p_name: parsed.data.name, p_slug: parsed.data.slug,
    p_starts_on: parsed.data.starts_on, p_ends_on: parsed.data.ends_on, p_include_team: parsed.data.include_team,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Another event in this college already uses that URL slug.", fieldErrors: { slug: ["Slug already in use"] } };
    return error.code === "42501" ? { ok: false, error: error.message } : fromDbError(error, "Could not copy the event.");
  }
  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: data as string }, message: "New event created from the copy. Review its dates and settings." };
}

/** Replace an Event Admin: appoint the new person first, then end the old admin's role (history kept). */
export async function replaceEventAdminAction(eventId: string, membershipId: string, input: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(membershipId).success) return { ok: false, error: "Invalid request." };
  const parsed = eventAdminSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: old } = await supabase
    .from("event_members")
    .select("id, user:profiles!event_members_user_id_fkey(full_name, email)")
    .eq("id", membershipId)
    .eq("event_id", eventId)
    .is("ended_at", null)
    .maybeSingle();
  if (!old) return { ok: false, error: "That administrator was not found or was already removed." };
  if (old.user?.email?.toLowerCase() === parsed.data.email.toLowerCase()) return { ok: false, error: "Choose a different person to replace them." };

  const added = await addEventAdminAction(eventId, parsed.data);
  if (!added.ok && !added.error.includes("already an Event Admin")) return added;
  const ended = await endEventMembershipAction(eventId, membershipId, `Replaced by ${parsed.data.full_name}`);
  if (!ended.ok) return { ok: false, error: `${parsed.data.full_name} was appointed, but the previous admin could not be removed: ${ended.error}` };
  return { ok: true, message: `${parsed.data.full_name} replaced ${old.user?.full_name || old.user?.email || "the previous admin"} as Event Admin.` };
}
