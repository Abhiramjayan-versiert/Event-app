import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import type { InviteInput } from "@/lib/validations/user";

/**
 * Returns the profile id for an email, inviting the person if they have no
 * account yet. Uses the service role, so callers MUST have verified the
 * current user's authorization (public.check_permission) beforehand.
 */
export async function findOrInviteUser(input: InviteInput): Promise<{ userId: string; invited: boolean }> {
  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", input.email.replace(/[%_\\]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (lookupError) throw new Error("Could not look up the user.");
  if (existing) return { userId: existing.id, invited: false };

  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.full_name },
    redirectTo: `${publicEnv.appUrl}/auth/confirm`,
  });
  if (error || !data.user) {
    throw new Error(error?.status === 429 ? "Email rate limit reached. Try again later." : "Could not send the invitation email.");
  }
  return { userId: data.user.id, invited: true };
}
