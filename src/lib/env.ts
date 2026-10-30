/**
 * Public (browser-safe) configuration. Only NEXT_PUBLIC_ values may live here.
 * Server-only secrets are read in src/lib/env.server.ts.
 */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  googleOAuthEnabled: process.env.NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH === "true",
};

export function isSupabaseConfigured() {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}
