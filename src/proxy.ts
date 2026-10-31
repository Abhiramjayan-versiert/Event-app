import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { publicEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, publicEnv.supabaseUrl);
  const response = await updateSession(request, { "x-nonce": nonce, "content-security-policy": csp });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation files.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
