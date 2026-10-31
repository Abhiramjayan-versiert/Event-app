#!/usr/bin/env node
/**
 * Sends the sign-up invitation to the Super Admin account.
 *
 * Super Admin access is fixed in the database (migration 19,
 * app.super_admin_email()): the account with that email becomes Super Admin
 * automatically and nobody can grant the role to anyone else. This script only
 * creates that account when it does not exist yet:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/provision-super-admin.mjs "Full Name"
 *
 * The service role key is read from the environment and never written anywhere.
 */
import { createClient } from "@supabase/supabase-js";

const SUPER_ADMIN_EMAIL = "abhiramjayan72@gmail.com"; // keep in sync with app.super_admin_email()
const [fullName = ""] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error(`Could not list users: ${error.message}`);
    process.exit(1);
  }
  if (data.users.some((u) => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL)) {
    console.log(`${SUPER_ADMIN_EMAIL} already has an account and is the Super Admin.`);
    process.exit(0);
  }
  if (data.users.length < 1000) break;
}

const { error } = await admin.auth.admin.inviteUserByEmail(SUPER_ADMIN_EMAIL, {
  data: { full_name: fullName },
  redirectTo: `${appUrl}/auth/confirm`,
});
if (error) {
  console.error(`Invitation failed: ${error.message}`);
  process.exit(1);
}
console.log(`Invitation sent to ${SUPER_ADMIN_EMAIL}. The account becomes Super Admin automatically.`);
