import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool,
} from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, financeHead: U, techHead: U, volunteer: U;
let college: { id: string }, event: { id: string };
let tech: string, finance: string;

beforeAll(async () => {
  [admin, financeHead, techHead, volunteer] = await Promise.all([
    createUser("FW Admin"), createUser("FW Finance"), createUser("FW Tech"), createUser("FW Volunteer"),
  ]);
  college = await createCollege("FW College");
  event = await createEvent(college.id, "FW Fest");
  tech = await departmentId(event.id, "Technical");
  finance = await departmentId(event.id, "Finance");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(finance, financeHead.id, "finance_head");
  await addDepartmentMember(tech, techHead.id, "department_head");
  await addDepartmentMember(tech, volunteer.id, "team_member", "member");
});

afterAll(() => pool.end());

async function newExpense(amount: number, title = "Projector") {
  const [row] = await asUser(techHead.id, (q) =>
    q<{ id: string; request_number: string }>(
      "insert into public.expense_requests (event_id, college_id, department_id, title, category, requested_amount) values ($1, $2, $3, $4, 'technical_equipment', $5) returning id, request_number",
      [event.id, college.id, tech, title, amount],
    ),
  );
  return row;
}
const status = async (id: string) =>
  (await asOwner((q) => q<{ status: string; approved_amount: string | null; paid_amount: string }>("select status, approved_amount, paid_amount from public.expense_requests where id = $1", [id])))[0];
const transition = (user: string, id: string, action: string, amount?: number, comment?: string) =>
  asUser(user, (q) => q("select public.expense_transition($1, $2::public.approval_action, $3, $4)", [id, action, amount ?? null, comment ?? null]));

describe("expense workflow", () => {
  it("department heads submit; team members cannot create requests", async () => {
    const e = await newExpense(4000);
    expect(e.request_number).toMatch(/^EXP-\d{6}$/);
    await transition(techHead.id, e.id, "submit");
    expect((await status(e.id)).status).toBe("submitted");
    await expectDenied(
      asUser(volunteer.id, (q) => q("insert into public.expense_requests (event_id, college_id, department_id, title, category, requested_amount) values ($1, $2, $3, 'x', 'printing', 10)", [event.id, college.id, tech])),
      /row-level security/,
    );
  });

  it("submitters cannot approve their own request", async () => {
    const e = await newExpense(500, "Cables");
    await transition(techHead.id, e.id, "submit");
    await expectDenied(transition(techHead.id, e.id, "approve"), /cannot approve/);
  });

  it("finance head approves within the limit and the history is recorded", async () => {
    const e = await newExpense(3000, "Mics");
    await transition(techHead.id, e.id, "submit");
    await transition(financeHead.id, e.id, "start_review");
    await transition(financeHead.id, e.id, "approve", 2500);
    expect(await status(e.id)).toMatchObject({ status: "approved", approved_amount: "2500.00" });
    const history = await asOwner((q) => q<{ action: string }>("select action from public.expense_approvals where expense_request_id = $1 order by created_at", [e.id]));
    expect(history.map((h) => h.action)).toEqual(["submit", "start_review", "approve"]);
    await expectDenied(asOwner((q) => q("delete from public.expense_approvals where expense_request_id = $1", [e.id])), /append-only/);
  });

  it("amounts above the limit need final approval; finance head forwards, event admin approves", async () => {
    const e = await newExpense(50000, "Stage lighting");
    await transition(techHead.id, e.id, "submit");
    await expectDenied(transition(financeHead.id, e.id, "approve"), /final approval/);
    await transition(financeHead.id, e.id, "forward");
    await transition(admin.id, e.id, "approve");
    expect((await status(e.id)).status).toBe("approved");
  });

  it("rejection and change requests require a comment", async () => {
    const e = await newExpense(800, "Banner");
    await transition(techHead.id, e.id, "submit");
    await expectDenied(transition(financeHead.id, e.id, "request_changes"), /Explain/);
    await transition(financeHead.id, e.id, "request_changes", undefined, "Attach a quote");
    expect((await status(e.id)).status).toBe("changes_requested");
    await transition(techHead.id, e.id, "resubmit");
    await expectDenied(transition(financeHead.id, e.id, "reject"), /reason/);
    await transition(financeHead.id, e.id, "reject", undefined, "Over budget");
    expect((await status(e.id)).status).toBe("rejected");
  });
});

describe("payments and reversals", () => {
  it("partial then full payment books verified expenses in the ledger", async () => {
    const e = await newExpense(6000, "Laptops rental");
    await transition(techHead.id, e.id, "submit");
    await transition(financeHead.id, e.id, "approve", 6000);
    await expectDenied(asUser(techHead.id, (q) => q("select public.record_expense_payment($1, 1000, current_date, 'UPI')", [e.id])), /cannot record/);
    await expectDenied(asUser(financeHead.id, (q) => q("select public.record_expense_payment($1, 7000, current_date, 'UPI')", [e.id])), /unpaid approved amount/);
    await asUser(financeHead.id, (q) => q("select public.record_expense_payment($1, 2000, current_date, 'UPI', 'UTR1')", [e.id]));
    expect(await status(e.id)).toMatchObject({ status: "partially_paid", paid_amount: "2000.00" });
    const [txn] = await asUser(financeHead.id, (q) => q<{ id: string }>("select public.record_expense_payment($1, 4000, current_date, 'Bank transfer') as id", [e.id]));
    expect(await status(e.id)).toMatchObject({ status: "paid", paid_amount: "6000.00" });

    const [{ s }] = await asUser(financeHead.id, (q) => q<{ s: Record<string, string> }>("select public.event_financial_summary($1) s", [event.id]));
    expect(Number(s.expenditure_paid)).toBe(6000);

    await expectDenied(asUser(financeHead.id, (q) => q("select public.reverse_transaction($1, '')", [txn.id])), /reason/);
    await asUser(financeHead.id, (q) => q("select public.reverse_transaction($1, 'Duplicate transfer')", [txn.id]));
    expect(await status(e.id)).toMatchObject({ status: "partially_paid", paid_amount: "2000.00" });
    const [{ s: after }] = await asUser(financeHead.id, (q) => q<{ s: Record<string, string> }>("select public.event_financial_summary($1) s", [event.id]));
    expect(Number(after.expenditure_paid)).toBe(2000);
    await expectDenied(asUser(financeHead.id, (q) => q("select public.reverse_transaction($1, 'again')", [txn.id])), /Only verified/);
  });

  it("finance can record and verify income; others cannot", async () => {
    const [t] = await asUser(financeHead.id, (q) =>
      q<{ id: string }>("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, status, payment_method) values ($1, $2, 'income', 'in', 'stall_booking', 1500, 'pending', 'Cash') returning id", [event.id, college.id]),
    );
    await asUser(financeHead.id, (q) => q("update public.financial_transactions set status = 'verified' where id = $1", [t.id]));
    const [row] = await asOwner((q) => q<{ status: string; verified_by: string }>("select status, verified_by from public.financial_transactions where id = $1", [t.id]));
    expect(row).toEqual({ status: "verified", verified_by: financeHead.id });
    const updated = await asUser(techHead.id, (q) => q("update public.financial_transactions set status = 'rejected' where id = $1 returning id", [t.id]));
    expect(updated).toHaveLength(0);
  });
});

describe("budgets", () => {
  it("allocations are managed by budget managers and warn at thresholds", async () => {
    await expectDenied(asUser(techHead.id, (q) => q("select public.set_department_allocation($1, 10000)", [tech])), /cannot manage budgets/);
    await asUser(admin.id, (q) => q("select public.set_department_allocation($1, 10000)", [tech]));
    // Approved so far in Technical: 4000? no — 2500 (Mics) + 50000 (Stage) + 6000 = 58500 → exceeded.
    const notes = await asOwner((q) => q<{ title: string }>("select title from public.notifications where user_id = $1 and type = 'budget.threshold'", [techHead.id]));
    expect(notes.some((n) => /exceeded/.test(n.title))).toBe(true);
  });

  it("department heads request revisions; budget managers decide", async () => {
    const [rv] = await asUser(techHead.id, (q) =>
      q<{ id: string }>("insert into public.budget_revisions (event_id, college_id, department_id, previous_amount, requested_amount, reason, requested_by) values ($1, $2, $3, 10000, 60000, 'Stage lighting approved', $4) returning id", [event.id, college.id, tech, techHead.id]),
    );
    await expectDenied(asUser(techHead.id, (q) => q("select public.decide_budget_revision($1, true)", [rv.id])), /cannot decide/);
    await asUser(admin.id, (q) => q("select public.decide_budget_revision($1, true, 'OK')", [rv.id]));
    const [a] = await asOwner((q) => q<{ allocated_amount: string }>("select allocated_amount from public.budget_allocations where department_id = $1", [tech]));
    expect(Number(a.allocated_amount)).toBe(60000);
    await expectDenied(asUser(admin.id, (q) => q("select public.decide_budget_revision($1, false)", [rv.id])), /already decided/);
  });
});
