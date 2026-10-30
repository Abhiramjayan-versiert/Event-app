"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { inviteSchema } from "@/lib/validations/user";
import { findOrInviteUser } from "@/features/users/invite.server";
import { addCollegeAdminAction } from "@/features/colleges/actions";
import { addEventAdminAction } from "@/features/events/actions";

const inviteWithAssignment = inviteSchema.extend({
  assignment: z.enum(["none", "college_admin", "event_admin"]),
  target_id: z.string().uuid().optional().or(z.literal("")),
});

export async function inviteUserAction(input: unknown): Promise<ActionResult<unknown>> {
  const parsed = inviteWithAssignment.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { assignment, target_id, ...person } = parsed.data;

  if (assignment === "college_admin") {
    if (!target_id) return { ok: false, error: "Choose a college.", fieldErrors: { target_id: ["Choose a college"] } };
    return addCollegeAdminAction(target_id, person);
  }
  if (assignment === "event_admin") {
    if (!target_id) return { ok: false, error: "Choose an event.", fieldErrors: { target_id: ["Choose an event"] } };
    return addEventAdminAction(target_id, person);
  }

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("is_super_admin, status").eq("id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();
  if (!profile?.is_super_admin || profile.status !== "active") return { ok: false, error: "Only a Super Admin can invite users without an assignment." };
  try {
    const result = await findOrInviteUser(person);
    revalidatePath("/users");
    return { ok: true, message: result.invited ? `Invitation sent to ${person.email}.` : "This person already has an account." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const uuid = z.string().uuid();

export async function setUserStatusAction(userId: string, status: "active" | "suspended"): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success || !["active", "suspended"].includes(status)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  if (me.user?.id === userId) return { ok: false, error: "You cannot change your own account status." };

  // RLS + trigger allow this only for Super Admins.
  const { data, error } = await supabase.from("profiles").update({ status }).eq("id", userId).select("id");
  if (error) return fromDbError(error, "Could not change the account status.");
  if (!data?.length) return { ok: false, error: "Only a Super Admin can suspend or reactivate accounts." };

  // Also block / restore sign-in at the authentication layer.
  const admin = createAdminClient();
  const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: status === "suspended" ? "876000h" : "none" });
  if (banError) return { ok: false, error: "Status saved, but the sign-in block could not be updated. Retry to sync." };

  revalidatePath("/users");
  return { ok: true, message: status === "suspended" ? "Account suspended. Active sessions lose access immediately." : "Account reactivated." };
}

export async function setSuperAdminAction(userId: string, value: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").update({ is_super_admin: value }).eq("id", userId).select("id");
  if (error) return fromDbError(error, "Could not change Super Admin access.");
  if (!data?.length) return { ok: false, error: "Only a Super Admin can change Super Admin access." };
  revalidatePath("/users");
  return { ok: true, message: value ? "Super Admin access granted." : "Super Admin access revoked." };
}
