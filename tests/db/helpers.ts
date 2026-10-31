import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres@localhost:54322/postgres";
const url = new URL(adminUrl);
url.pathname = "/eventapp_rls_test";

export const pool = new Pool({ connectionString: url.toString(), max: 4 });

type Query = <R extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;

async function inTransaction<T>(setup: (c: PoolClient) => Promise<void>, fn: (q: Query) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setup(client);
    const q: Query = async (sql, params) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs as the database owner (bypasses RLS) — used for fixtures only. */
export function asOwner<T>(fn: (q: Query) => Promise<T>) {
  return inTransaction(async () => {}, fn);
}

/** Runs exactly like a PostgREST request from a signed-in user. */
export function asUser<T>(userId: string, fn: (q: Query) => Promise<T>) {
  return inTransaction(async (c) => {
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
  }, fn);
}

/** Runs as an anonymous (signed-out) Data API request. */
export function asAnon<T>(fn: (q: Query) => Promise<T>) {
  return inTransaction(async (c) => {
    await c.query("set local role anon");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
  }, fn);
}

/** Expects the callback to fail with a Postgres error whose message matches. */
export async function expectDenied(promise: Promise<unknown>, message?: RegExp) {
  try {
    await promise;
  } catch (error) {
    const msg = (error as Error).message;
    if (message && !message.test(msg)) {
      throw new Error(`Expected error matching ${message} but got: ${msg}`);
    }
    return msg;
  }
  throw new Error("Expected the operation to be rejected, but it succeeded");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const tag = () => randomUUID().slice(0, 8);

export async function createUser(name: string, opts: { superAdmin?: boolean } = {}) {
  const id = randomUUID();
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${tag()}@test.local`;
  await asOwner(async (q) => {
    await q("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id,
      email,
      JSON.stringify({ full_name: name }),
    ]);
    if (opts.superAdmin) {
      // Production allows exactly one Super Admin (migration 19). Fixtures need
      // several, so set the flag with triggers bypassed (owner-only setting).
      await q("set local session_replication_role = replica");
      await q("update public.profiles set is_super_admin = true where id = $1", [id]);
      await q("set local session_replication_role = origin");
    }
  });
  return { id, email, name };
}

export async function createCollege(name = "Test College") {
  const code = `C${tag().toUpperCase().slice(0, 6)}`;
  const [row] = await asOwner((q) =>
    q<{ id: string }>("insert into public.colleges (name, code) values ($1, $2) returning id", [name, code]),
  );
  return { id: row.id, code, name };
}

export async function createEvent(collegeId: string, name = "Test Fest") {
  const slug = `fest-${tag()}`;
  const [row] = await asOwner((q) =>
    q<{ id: string }>(
      "insert into public.events (college_id, name, slug, starts_on, ends_on) values ($1, $2, $3, current_date + 30, current_date + 32) returning id",
      [collegeId, name, slug],
    ),
  );
  return { id: row.id, slug, name, collegeId };
}

export async function roleId(key: string) {
  const [row] = await asOwner((q) => q<{ id: string }>("select id from public.roles where key = $1", [key]));
  return row.id;
}

export async function departmentId(eventId: string, name: string) {
  const [row] = await asOwner((q) =>
    q<{ id: string }>("select id from public.departments where event_id = $1 and name = $2", [eventId, name]),
  );
  return row.id;
}

export async function addCollegeMember(collegeId: string, userId: string, role = "college_admin") {
  const rid = await roleId(role);
  await asOwner((q) =>
    q("insert into public.college_members (college_id, user_id, role_id) values ($1, $2, $3)", [collegeId, userId, rid]),
  );
}

export async function addEventMember(eventId: string, userId: string, role = "event_admin") {
  const rid = await roleId(role);
  await asOwner((q) =>
    q("insert into public.event_members (event_id, college_id, user_id, role_id) select $1, college_id, $2, $3 from public.events where id = $1", [
      eventId,
      userId,
      rid,
    ]),
  );
}

export async function addDepartmentMember(
  departmentId: string,
  userId: string,
  role: string,
  position: "head" | "assistant_head" | "member" = "head",
) {
  const rid = await roleId(role);
  await asOwner((q) =>
    q(
      `insert into public.department_members (department_id, event_id, college_id, user_id, role_id, position)
       select d.id, d.event_id, d.college_id, $2, $3, $4 from public.departments d where d.id = $1`,
      [departmentId, userId, rid, position],
    ),
  );
}
