"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { inviteSchema } from "@/lib/validations/user";
import { publicEnv } from "@/lib/env";
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

/**
 * Re-sends the invitation email to someone who has not accepted yet
 * (Super Admin only). People who already set a password use "Forgot password".
 */
export async function resendInvitationAction(userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  // pending_invitations() raises for anyone who is not an active Super Admin.
  const { data: pending, error } = await supabase.rpc("pending_invitations");
  if (error) return fromDbError(error, "Could not check the invitation.");
  if (!pending?.some((p) => p.user_id === userId)) {
    return { ok: false, error: "This person has already accepted their invitation. They can use “Forgot password” on the sign-in page." };
  }
  const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (!profile) return { ok: false, error: "User not found." };

  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(profile.email, {
    data: { full_name: profile.full_name },
    redirectTo: `${publicEnv.appUrl}/auth/confirm`,
  });
  if (inviteError) {
    return { ok: false, error: inviteError.status === 429 ? "Email rate limit reached. Try again in a few minutes." : "Could not send the invitation email." };
  }
  revalidatePath("/users");
  return { ok: true, message: `Invitation re-sent to ${profile.email}.` };
}


/** Super Admin: email a password-reset link to a user's exact account address. */
export async function sendPasswordResetAction(userId: string): Promise<ActionResult> {
  if (!uuid.safeParse(userId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: { user: me } } = await supabase.auth.getUser();
  const { data: myProfile } = await supabase.from("profiles").select("is_super_admin, status").eq("id", me?.id ?? "").maybeSingle();
  if (!myProfile?.is_super_admin || myProfile.status !== "active") return { ok: false, error: "Only the Super Admin can send reset links." };
  const admin = createAdminClient();
  const { data, error: lookupError } = await admin.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (lookupError || !email) return { ok: false, error: "User not found." };
  if (!data.user.email_confirmed_at) return { ok: false, error: "This person hasn't accepted their invitation yet. Use “Resend invitation” instead." };
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password` });
  if (error) {
    return { ok: false, error: error.status === 429 ? "A reset email was sent very recently. Wait a minute and try again." : "Could not send the reset email." };
  }
  return { ok: true, message: `Password reset link sent to ${email}.` };
}
