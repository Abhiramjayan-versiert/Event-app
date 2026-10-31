import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/forgot-password", "/auth", "/api/v1", "/api/health", "/api/calendar", "/setup-required", "/e", "/t", "/c"];

export function isPublicPath(pathname: string) {
  return pathname === "/" ? false : PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie and guards private routes.
 * `extraHeaders` (the CSP nonce) are forwarded to the page on every pass.
 */
export async function updateSession(request: NextRequest, extraHeaders: Record<string, string> = {}) {
  const forward = () => {
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };

  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
    if (request.nextUrl.pathname.startsWith("/setup-required") || request.nextUrl.pathname.startsWith("/api/")) {
      return forward();
    }
    return NextResponse.redirect(new URL("/setup-required", request.url));
  }

  let response = forward();

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getUser(): it refreshes the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Two-step sign-in: people who turned it on must enter their code before
  // anything else (only /auth/* stays reachable, for the code page and sign-out).
  if (user && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/mfa";
      url.search = pathname === "/" || pathname === "/login" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
