import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDepartmentMember,
  addEventMember,
  asOwner,
  asUser,
  createCollege,
  createEvent,
  createUser,
  departmentId,
  expectDenied,
  pool,
} from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let eventAdmin: U, financeHead: U, techHead: U, volunteer: U, otherVolunteer: U;
let college: { id: string }, event: { id: string };
let financeDept: string, techDept: string;

beforeAll(async () => {
  [eventAdmin, financeHead, techHead, volunteer, otherVolunteer] = await Promise.all([
    createUser("Event Admin"),
    createUser("Finance Head"),
    createUser("Tech Head"),
    createUser("Volunteer"),
    createUser("Other Volunteer"),
  ]);
  college = await createCollege("Finance College");
  event = await createEvent(college.id, "Money Fest");
  financeDept = await departmentId(event.id, "Finance");
  techDept = await departmentId(event.id, "Technical");
  await addEventMember(event.id, eventAdmin.id, "event_admin");
  await addDepartmentMember(financeDept, financeHead.id, "finance_head");
  await addDepartmentMember(techDept, techHead.id, "department_head");
  await addDepartmentMember(techDept, volunteer.id, "team_member", "member");
  await addDepartmentMember(techDept, otherVolunteer.id, "team_member", "member");
});

afterAll(() => pool.end());

const summary = async (userId: string) => {
  const [{ s }] = await asUser(userId, (q) => q<{ s: Record<string, number> }>("select public.event_financial_summary($1) s", [event.id]));
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
};

describe("financial ledger", () => {
  it("assigns numbers and stamps verification", async () => {
    const [t] = await asUser(financeHead.id, (q) =>
      q<{ txn_number: string; verified_by: string; direction: string }>(
        "insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, status) values ($1, $2, 'income', 'out', 'stall_booking', 5000, 'verified') returning txn_number, verified_by, direction",
        [event.id, college.id],
      ),
    );
    expect(t.txn_number).toMatch(/^TXN-\d{6}$/);
    expect(t.verified_by).toBe(financeHead.id);
    expect(t.direction).toBe("in"); // direction is derived from kind, client value ignored
  });

  it("non-finance users cannot record or read transactions", async () => {
    await expectDenied(
      asUser(techHead.id, (q) =>
        q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount) values ($1, $2, 'income', 'in', 'other', 10)", [event.id, college.id]),
      ),
      /row-level security/,
    );
    expect(await asUser(techHead.id, (q) => q("select id from public.financial_transactions"))).toHaveLength(0);
  });

  it("financial history cannot be deleted or silently edited", async () => {
    const [t] = await asOwner((q) => q<{ id: string }>("select id from public.financial_transactions where event_id = $1 limit 1", [event.id]));
    await expectDenied(asOwner((q) => q("delete from public.financial_transactions where id = $1", [t.id])), /cannot be deleted/);
    await expectDenied(asUser(financeHead.id, (q) => q("update public.financial_transactions set amount = 1 where id = $1", [t.id])), /immutable/);
    await expectDenied(asUser(financeHead.id, (q) => q("update public.financial_transactions set status = 'reversed' where id = $1", [t.id])), /reversal entry/);
  });

  it("calculates totals per the published formulas", async () => {
    // Fresh event so totals are exact.
    const ev = await createEvent(college.id, "Ledger Fest");
    await addEventMember(ev.id, financeHead.id, "event_admin");
    const fin = await departmentId(ev.id, "Finance");
    await asOwner(async (q) => {
      const ins = (kind: string, cat: string, amount: number, status: string) =>
        q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, status, verified_at) values ($1, $2, $3, 'in', $4, $5, $6::public.txn_status, case when $6::text = 'verified' then now() end)",
          [ev.id, college.id, kind, cat, amount, status]);
      await ins("income", "online_registration", 1000, "verified");
      await ins("income", "offline_registration", 500, "verified");
      await ins("income", "online_registration", 999, "pending"); // not counted
      await ins("income", "online_registration", 777, "rejected"); // not counted
      await ins("income", "sponsorship", 20000, "verified");
      await ins("income", "merchandise", 300, "verified");
      await ins("expense", "stage", 4000, "verified");
      await ins("refund", "online_registration", 200, "verified");
      await q("update public.budgets set total_amount = 100000 where event_id = $1", [ev.id]);
      const [sp] = await q<{ id: string }>("insert into public.sponsors (event_id, college_id, company_name) values ($1, $2, 'Acme') returning id", [ev.id, college.id]);
      await q("insert into public.sponsorship_deals (event_id, college_id, sponsor_id, stage, agreed_amount, received_amount) values ($1, $2, $3, 'partially_paid', 50000, 20000)",
        [ev.id, college.id, sp.id]);
      await q("insert into public.sponsorship_deals (event_id, college_id, sponsor_id, stage, agreed_amount) values ($1, $2, $3, 'negotiation', 90000)",
        [ev.id, college.id, sp.id]); // not a commitment yet
      await q("insert into public.expense_requests (event_id, college_id, department_id, title, category, requested_amount, approved_amount, paid_amount, status) values ($1, $2, $3, 'Lights', 'sound_lighting', 9000, 8000, 3000, 'partially_paid')",
        [ev.id, college.id, fin]);
      await q("insert into public.expense_requests (event_id, college_id, department_id, title, category, requested_amount, status) values ($1, $2, $3, 'Banners', 'printing', 1500, 'submitted')",
        [ev.id, college.id, fin]);
    });

    const [{ s }] = await asUser(financeHead.id, (q) => q<{ s: Record<string, number> }>("select public.event_financial_summary($1) s", [ev.id]));
    const n = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
    expect(n).toMatchObject({
      total_budget: 100000,
      registration_income: 1500,
      sponsorship_income: 20000,
      other_income: 300,
      total_income_received: 21800,
      refunds_paid: 200,
      expenditure_paid: 4000,
      approved_unpaid: 5000,
      pending_expense_count: 1,
      pending_expense_amount: 1500,
      sponsorship_committed: 50000,
      outstanding_sponsorship: 30000,
      net_cash_position: 17600,
    });

    // Reversal removes the original from totals; the reversal row itself is informational.
    // Direct reversal inserts are not allowed for clients (they go through a workflow RPC) …
    await expectDenied(
      asUser(financeHead.id, async (q) => {
        const [orig] = await q<{ id: string }>("select id from public.financial_transactions where event_id = $1 and category = 'merchandise'", [ev.id]);
        await q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, reverses_transaction_id, status) values ($1, $2, 'reversal', 'out', 'x', 1, $3, 'verified')",
          [ev.id, college.id, orig.id]);
      }),
      /row-level security/,
    );
    // … and the trusted path enforces the reversal invariants.
    await asOwner(async (q) => {
      const [orig] = await q<{ id: string }>("select id from public.financial_transactions where event_id = $1 and category = 'merchandise'", [ev.id]);
      const [rev] = await q<{ amount: string; direction: string }>(
        "insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, reverses_transaction_id, status) values ($1, $2, 'reversal', 'in', 'ignored', 1, $3, 'verified') returning amount, direction",
        [ev.id, college.id, orig.id]);
      expect(Number(rev.amount)).toBe(300);
      expect(rev.direction).toBe("out");
      await q("update public.financial_transactions set status = 'reversed' where id = $1", [orig.id]);
    });
    const [{ s: after }] = await asUser(financeHead.id, (q) => q<{ s: Record<string, number> }>("select public.event_financial_summary($1) s", [ev.id]));
    expect(Number(after.other_income)).toBe(0);
    expect(Number(after.net_cash_position)).toBe(17300);
  });

  it("summary is available to finance roles", async () => {
    const s = await summary(financeHead.id);
    expect(s.total_income_received).toBeGreaterThanOrEqual(5000);
  });
});

describe("registrations", () => {
  it("numbers registrations and blocks duplicates per configured rule", async () => {
    const [r] = await asOwner((q) =>
      q<{ registration_number: string; payment_status: string }>(
        "insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Ravi', 'Ravi@Example.com', 'coding', 200) returning registration_number, payment_status",
        [event.id, college.id],
      ),
    );
    expect(r.registration_number).toMatch(/^REG-\d{6}$/);
    expect(r.payment_status).toBe("pending");
    await expectDenied(
      asOwner((q) =>
        q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Ravi K', 'ravi@example.com', 'Coding', 200)", [event.id, college.id]),
      ),
      /registrations_dedupe_key/,
    );
    // Different category is allowed under the default email_per_category rule.
    await asOwner((q) =>
      q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Ravi', 'ravi@example.com', 'quiz', 0)", [event.id, college.id]),
    );
  });

  it("free registrations do not wait for payment", async () => {
    const [r] = await asOwner((q) =>
      q<{ payment_status: string }>("select payment_status from public.registrations where event_id = $1 and category = 'quiz'", [event.id]),
    );
    expect(r.payment_status).toBe("not_required");
  });

  it("registrations cannot be hard-deleted", async () => {
    await expectDenied(asOwner((q) => q("delete from public.registrations where event_id = $1", [event.id])), /append-only/);
  });
});

describe("tasks", () => {
  let taskId: string;

  it("department heads create tasks only in their department", async () => {
    const [t] = await asUser(techHead.id, (q) =>
      q<{ id: string }>("insert into public.tasks (event_id, department_id, title) values ($1, $2, 'Set up Wi-Fi') returning id", [event.id, techDept]),
    );
    taskId = t.id;
    await expectDenied(
      asUser(techHead.id, (q) => q("insert into public.tasks (event_id, department_id, title) values ($1, $2, 'Not mine')", [event.id, financeDept])),
      /row-level security/,
    );
  });

  it("team members see only tasks assigned to them", async () => {
    expect(await asUser(volunteer.id, (q) => q("select id from public.tasks"))).toHaveLength(0);
    await asUser(techHead.id, (q) => q("insert into public.task_assignments (task_id, event_id, college_id, user_id) values ($1, $2, $3, $4)", [taskId, event.id, college.id, volunteer.id]));
    expect(await asUser(volunteer.id, (q) => q("select id from public.tasks"))).toHaveLength(1);
    expect(await asUser(otherVolunteer.id, (q) => q("select id from public.tasks"))).toHaveLength(0);
  });

  it("assignees update status but not task definition", async () => {
    const [t] = await asUser(volunteer.id, (q) =>
      q<{ status: string; progress_pct: number; completed_at: string | null }>(
        "update public.tasks set status = 'completed' where id = $1 returning status, progress_pct, completed_at", [taskId]),
    );
    expect(t.status).toBe("completed");
    expect(t.progress_pct).toBe(100);
    expect(t.completed_at).not.toBeNull();
    await expectDenied(asUser(volunteer.id, (q) => q("update public.tasks set title = 'Renamed' where id = $1", [taskId])), /Assignees can only/);
  });

  it("comments are limited to people who can see the task", async () => {
    await asUser(volunteer.id, (q) => q("insert into public.task_comments (task_id, event_id, college_id, author_id, body) values ($1, $2, $3, $4, 'Done')", [taskId, event.id, college.id, volunteer.id]));
    await expectDenied(
      asUser(otherVolunteer.id, (q) => q("insert into public.task_comments (task_id, event_id, college_id, author_id, body) values ($1, $2, $3, $4, 'Hi')", [taskId, event.id, college.id, otherVolunteer.id])),
      /row-level security/,
    );
  });
});
