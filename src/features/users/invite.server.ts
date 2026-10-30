import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import type { InviteInput } from "@/lib/validations/user";

const escapeLike = (v: string) => v.replace(/[%_\\]/g, (c) => `\\${c}`);

/**
 * Returns the profile id for an email, inviting the person if they have no
 * account yet. Callers MUST verify the current user's authorization first.
 *
 * Existing users visible to the caller (same college/event) are found without
 * the service role. Finding other existing users or inviting new ones needs
 * SUPABASE_SERVICE_ROLE_KEY.
 */
export async function findOrInviteUser(input: InviteInput): Promise<{ userId: string; invited: boolean }> {
  const supabase = await createClient();
  const { data: visible } = await supabase.from("profiles").select("id").ilike("email", escapeLike(input.email)).maybeSingle();
  if (visible) return { userId: visible.id, invited: false };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "This person has no account in your workspace yet. Inviting new users requires SUPABASE_SERVICE_ROLE_KEY to be configured on the server.",
    );
  }

  const admin = createAdminClient();
  const { data: existing, error: lookupError } = await admin.from("profiles").select("id").ilike("email", escapeLike(input.email)).maybeSingle();
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
