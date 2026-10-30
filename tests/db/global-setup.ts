/**
 * Builds a fresh, disposable database for the RLS / business-logic test suite:
 *   1. connects to TEST_DATABASE_ADMIN_URL (a plain local PostgreSQL ≥ 15),
 *   2. recreates the `eventapp_rls_test` database,
 *   3. applies the Supabase shim, then every migration in order.
 *
 * Never point TEST_DATABASE_ADMIN_URL at a hosted Supabase project.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const DB_NAME = "eventapp_rls_test";

export default async function setup() {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres@localhost:54322/postgres";
  if (/supabase\.co/.test(adminUrl)) {
    throw new Error("Refusing to run destructive DB tests against a hosted Supabase project.");
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${DB_NAME} with (force)`);
  await admin.query(`create database ${DB_NAME}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${DB_NAME}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  // Silence notices such as "extension already exists".
  db.on("notice", () => {});

  const root = path.resolve(__dirname, "../..");
  await db.query(readFileSync(path.join(root, "supabase/tests/shim/supabase_shim.sql"), "utf8"));
  const migrationsDir = path.join(root, "supabase/migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(path.join(migrationsDir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  await db.end();

  process.env.TEST_DATABASE_URL = url.toString();
}
