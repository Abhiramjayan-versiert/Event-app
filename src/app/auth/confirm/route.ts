import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/actions";

const ALLOWED: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Email link verification (token_hash flow) used by the branded email templates
 * in supabase/templates. Invitations and recoveries continue to /reset-password
 * so the user sets their own password.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const fallback = type === "invite" || type === "recovery" ? "/reset-password?welcome=" + (type === "invite" ? "1" : "0") : "/dashboard";
      return NextResponse.redirect(new URL(safeRedirectPath(searchParams.get("next"), fallback), origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link_invalid", origin));
}
