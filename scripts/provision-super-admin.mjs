#!/usr/bin/env node
/**
 * Creates (or promotes) the first Super Admin. Run once per environment:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/provision-super-admin.mjs owner@college.edu "Full Name"
 *
 * New accounts receive an invitation email (configure the invite template and
 * Site URL first). Existing accounts are promoted in place. The service role
 * key is read from the environment and never written anywhere.
 */
import { createClient } from "@supabase/supabase-js";

const [email, fullName = ""] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/provision-super-admin.mjs <email> "<full name>"');
  process.exit(1);
}
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const normalized = email.trim().toLowerCase();

let { data: profile } = await admin.from("profiles").select("id, is_super_admin").ilike("email", normalized).maybeSingle();

if (!profile) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(normalized, {
    data: { full_name: fullName },
    redirectTo: `${appUrl}/auth/confirm`,
  });
  if (error) {
    console.error(`Invitation failed: ${error.message}`);
    process.exit(1);
  }
  profile = { id: data.user.id, is_super_admin: false };
  console.log(`Invitation sent to ${normalized}.`);
}

if (profile.is_super_admin) {
  console.log(`${normalized} is already a Super Admin.`);
  process.exit(0);
}

const { error } = await admin.from("profiles").update({ is_super_admin: true, status: "active" }).eq("id", profile.id);
if (error) {
  console.error(`Could not grant Super Admin: ${error.message}`);
  process.exit(1);
}
console.log(`${normalized} is now a Super Admin.`);
