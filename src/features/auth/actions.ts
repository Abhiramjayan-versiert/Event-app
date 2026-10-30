"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { type ActionResult, fromZodError, safeRedirectPath } from "@/lib/actions";
import { forgotPasswordSchema, loginSchema, profileSchema, setPasswordSchema } from "@/lib/validations/auth";

export async function signInAction(input: unknown, next?: string): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { ok: false, error: "Please verify your email address first. Check your inbox for the verification link." };
    }
    if (error.status === 429) return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
    return { ok: false, error: "Invalid email or password." };
  }

  const { data: profile } = await supabase.from("profiles").select("status").maybeSingle();
  if (profile?.status === "suspended") {
    await supabase.auth.signOut();
    return { ok: false, error: "Your account is suspended. Contact your administrator." };
  }

  return { ok: true, data: { redirectTo: safeRedirectPath(next) } };
}

export async function requestPasswordResetAction(input: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.appUrl}/auth/callback?next=/reset-password`,
  });
  // Same response whether or not the account exists (prevents account enumeration).
  return { ok: true, message: "If an account exists for that address, a reset link is on its way." };
}

export async function setPasswordAction(input: unknown): Promise<ActionResult> {
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { ok: false, error: error.code === "same_password" ? "Choose a password you have not used before." : "Could not update the password. Please try again." };
  }
  return { ok: true, message: "Password updated." };
}

export async function updateProfileAction(input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "You are signed out." };
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null, job_title: parsed.data.job_title || null })
    .eq("id", auth.user.id);
  if (error) return { ok: false, error: "Could not save your profile." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function setAvatarPathAction(path: string | null): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: "You are signed out." };
  if (path !== null && !path.startsWith(`${auth.user.id}/`)) return { ok: false, error: "Invalid avatar path." };
  const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", auth.user.id);
  if (error) return { ok: false, error: "Could not update your avatar." };
  revalidatePath("/", "layout");
  return { ok: true };
}
