import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool,
} from "./helpers";
import type { PoolClient } from "pg";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, regHead: U, financeHead: U, mediaHead: U;
let college: { id: string }, event: { id: string };
let liveKey: string, testKey: string;

/** Runs as the service role (what the /api/v1 route handlers use). */
async function asService<T>(fn: (q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

const payload = (email: string, code = "HACK", extra: Record<string, unknown> = {}) => ({
  participant: { name: "Asha Rao", email, phone: "+91 98450 00000", college: "RV College" },
  items: [{ competition_code: code, quantity: 1 }],
  amount: 1, // must be ignored
  ...extra,
});

beforeAll(async () => {
  [admin, regHead, financeHead, mediaHead] = await Promise.all([
    createUser("Reg Admin"), createUser("Reg Head"), createUser("Reg Finance"), createUser("Reg Media"),
  ]);
  college = await createCollege("Reg College");
  event = await createEvent(college.id, "Reg Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(await departmentId(event.id, "Registration"), regHead.id, "registration_head");
  await addDepartmentMember(await departmentId(event.id, "Finance"), financeHead.id, "finance_head");
  await addDepartmentMember(await departmentId(event.id, "Media and PR"), mediaHead.id, "media_head");
  await asOwner(async (q) => {
    await q("insert into public.event_competitions (event_id, college_id, name, code, category, fee) values ($1, $2, 'Hackathon', 'HACK', 'technical', 500)", [event.id, college.id]);
    await q("insert into public.event_competitions (event_id, college_id, name, code, category, fee, capacity) values ($1, $2, 'Quiz', 'QUIZ', 'literary', 0, 1)", [event.id, college.id]);
  });
  liveKey = "a".repeat(64);
  testKey = "b".repeat(64);
  await asUser(admin.id, (q) => q("select public.create_api_credential($1, 'Website', 'production', 'eak_live_abcdefghij', $2)", [event.id, liveKey]));
  await asUser(admin.id, (q) => q("select public.create_api_credential($1, 'Staging', 'sandbox', 'eak_test_abcdefghij', $2)", [event.id, testKey]));
});

afterAll(() => pool.end());

describe("API credentials", () => {
  it("only integration managers create credentials and hashes stay hidden", async () => {
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.create_api_credential($1, 'x', 'sandbox', 'eak_test_zzzzzzzzzz', $2)", [event.id, "c".repeat(64)])), /cannot manage/);
    await expectDenied(asUser(admin.id, (q) => q("select key_hash from public.api_credentials")), /permission denied/);
  });

  it("authenticates by hash; API helpers are service-role only", async () => {
    const [{ a }] = await asService((q) => q<{ a: { event_id: string; environment: string } }>("select public.api_authenticate($1) a", [liveKey]));
    expect(a).toMatchObject({ event_id: event.id, environment: "production" });
    const [{ a: none }] = await asService((q) => q<{ a: unknown }>("select public.api_authenticate($1) a", ["d".repeat(64)]));
    expect(none).toBeNull();
    await expectDenied(asUser(admin.id, (q) => q("select public.api_authenticate($1)", [liveKey])), /permission denied/);
  });

  it("rate limits per bucket", async () => {
    const results = await asService(async (q) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) out.push((await q<{ ok: boolean }>("select public.api_rate_limit('test-bucket', 3, 60) ok"))[0].ok);
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("API registrations & payments", () => {
  let credLive: string;
  let regId: string;

  it("prices registrations from competition fees, ignoring client amounts", async () => {
    const [{ a }] = await asService((q) => q<{ a: { credential_id: string } }>("select public.api_authenticate($1) a", [liveKey]));
    credLive = a.credential_id;
    const [{ r }] = await asService((q) => q<{ r: { id: string; amount: number; payment_status: string; registration_number: string } }>(
      "select public.api_create_registration($1, $2) r", [credLive, JSON.stringify(payload("asha@example.com"))]));
    expect(Number(r.amount)).toBe(500);
    expect(r.payment_status).toBe("pending");
    expect(r.registration_number).toMatch(/^REG-/);
    regId = r.id;
  });

  it("rejects duplicates, unknown competitions and full competitions", async () => {
    await expectDenied(asService((q) => q("select public.api_create_registration($1, $2)", [credLive, JSON.stringify(payload("ASHA@example.com"))])), /registrations_dedupe_key/);
    await expectDenied(asService((q) => q("select public.api_create_registration($1, $2)", [credLive, JSON.stringify(payload("x@example.com", "NOPE"))])), /Unknown competition/);
    await asService((q) => q("select public.api_create_registration($1, $2)", [credLive, JSON.stringify(payload("q1@example.com", "QUIZ"))]));
    await expectDenied(asService((q) => q("select public.api_create_registration($1, $2)", [credLive, JSON.stringify(payload("q2@example.com", "QUIZ"))])), /full/);
  });

  it("confirms payment only through a verified, matching webhook — exactly once", async () => {
    await asService((q) => q("select public.api_attach_payment_order($1, 'razorpay', 'order_1', 500)", [regId]));
    const apply = (eventId: string, valid: boolean, amount: number, outcome = "paid") =>
      asService((q) => q<{ r: { result: string } }>(
        "select public.apply_payment_event('razorpay', $1, 'payment.captured', '{}'::jsonb, $2, 'order_1', 'pay_1', $3, 'INR', 'upi', $4) r",
        [eventId, valid, amount, outcome]));

    expect((await apply("evt_bad", false, 500))[0].r.result).toBe("rejected");
    expect((await apply("evt_mismatch", true, 1))[0].r.result).toBe("rejected");
    expect((await apply("evt_ok", true, 500))[0].r.result).toBe("paid");
    expect((await apply("evt_ok", true, 500))[0].r.result).toBe("duplicate");
    expect((await apply("evt_retry", true, 500))[0].r.result).toBe("already_paid");

    const [reg] = await asOwner((q) => q<{ status: string; payment_status: string; amount_paid: string }>("select status, payment_status, amount_paid from public.registrations where id = $1", [regId]));
    expect(reg).toEqual({ status: "confirmed", payment_status: "paid", amount_paid: "500.00" });
    const [{ c }] = await asOwner((q) => q<{ c: string }>("select count(*) c from public.financial_transactions where registration_id = $1 and kind = 'income' and status = 'verified'", [regId]));
    expect(c).toBe("1");
  });

  it("sandbox registrations never touch the ledger and can be cleared", async () => {
    const [{ a }] = await asService((q) => q<{ a: { credential_id: string } }>("select public.api_authenticate($1) a", [testKey]));
    const [{ r }] = await asService((q) => q<{ r: { id: string; test: boolean } }>("select public.api_create_registration($1, $2) r", [a.credential_id, JSON.stringify(payload("sandbox@example.com"))]));
    expect(r.test).toBe(true);
    await asService((q) => q("select public.api_attach_payment_order($1, 'sandbox', 'order_sb', 500)", [r.id]));
    await asService((q) => q("select public.apply_payment_event('sandbox', 'sb1', 'payment.captured', '{}'::jsonb, true, 'order_sb', 'pay_sb', 500, 'INR', 'test', 'paid')"));
    const [{ c }] = await asOwner((q) => q<{ c: string }>("select count(*) c from public.financial_transactions where registration_id = $1", [r.id]));
    expect(c).toBe("0");
    await expectDenied(asOwner((q) => q("delete from public.registrations where id = $1", [regId])), /append-only/);
    const [{ n }] = await asUser(admin.id, (q) => q<{ n: number }>("select public.clear_sandbox_data($1) n", [event.id]));
    expect(n).toBe(1);
  });
});

describe("registration management", () => {
  let offlineId: string;

  it("registration staff add offline registrations; others cannot see participant data", async () => {
    const [r] = await asUser(regHead.id, (q) => q<{ id: string }>(
      "insert into public.registrations (event_id, college_id, participant_name, email, category, amount, source) values ($1, $2, 'Ravi', 'ravi@example.com', 'technical', 300, 'offline') returning id",
      [event.id, college.id]));
    offlineId = r.id;
    expect(await asUser(mediaHead.id, (q) => q("select id from public.registrations"))).toHaveLength(0);
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.registration_dashboard($1)", [event.id])), /Not authorized/);
  });

  it("offline payment by registration staff is pending until finance verifies", async () => {
    await asUser(regHead.id, (q) => q("select public.registration_record_offline_payment($1, 300, 'Cash')", [offlineId]));
    const [t] = await asOwner((q) => q<{ status: string; category: string }>("select status, category from public.financial_transactions where registration_id = $1", [offlineId]));
    expect(t).toEqual({ status: "pending", category: "offline_registration" });
    const [reg] = await asOwner((q) => q<{ status: string; payment_status: string }>("select status, payment_status from public.registrations where id = $1", [offlineId]));
    expect(reg).toEqual({ status: "confirmed", payment_status: "paid" });
    await expectDenied(asUser(regHead.id, (q) => q("select public.registration_record_offline_payment($1, 1, 'Cash')", [offlineId])), /balance due/);
  });

  it("only finance records refunds, within the refundable amount", async () => {
    await expectDenied(asUser(regHead.id, (q) => q("select public.registration_record_refund($1, 100, 'UPI', 'Duplicate')", [offlineId])), /Only finance/);
    await expectDenied(asUser(financeHead.id, (q) => q("select public.registration_record_refund($1, 500, 'UPI', 'Too much')", [offlineId])), /refundable/);
    await asUser(financeHead.id, (q) => q("select public.registration_record_refund($1, 100, 'UPI', 'Partial cancel')", [offlineId]));
    const [reg] = await asOwner((q) => q<{ payment_status: string; amount_refunded: string }>("select payment_status, amount_refunded from public.registrations where id = $1", [offlineId]));
    expect(reg).toEqual({ payment_status: "partially_refunded", amount_refunded: "100.00" });
  });

  it("cancellation needs a reason; dashboard aggregates", async () => {
    await expectDenied(asUser(regHead.id, (q) => q("select public.registration_set_status($1, 'cancelled')", [offlineId])), /reason/);
    await asUser(regHead.id, (q) => q("select public.registration_set_status($1, 'cancelled', 'Participant withdrew')", [offlineId]));
    const [{ d }] = await asUser(regHead.id, (q) => q<{ d: { cancelled: number; total: number } }>("select public.registration_dashboard($1) d", [event.id]));
    expect(d.cancelled).toBeGreaterThanOrEqual(1);
    expect(d.total).toBeGreaterThanOrEqual(3);
  });
});
