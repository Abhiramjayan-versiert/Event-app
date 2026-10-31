import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, finance: U, superAdmin: U;
let event: { id: string }, college: { id: string };

beforeAll(async () => {
  [admin, finance, superAdmin] = await Promise.all([createUser("Close Admin"), createUser("Close Finance"), createUser("Close Super", { superAdmin: true })]);
  college = await createCollege("Close College");
  event = await createEvent(college.id, "Close Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(await departmentId(event.id, "Finance"), finance.id, "finance_head");
});
afterAll(() => pool.end());

describe("event closing", () => {
  it("requires event.close, a completed event, a note and no pending items", async () => {
    await expectDenied(asUser(finance.id, (q) => q("select public.close_event_finances($1, 'ok')", [event.id])), /not allowed/);
    await expectDenied(asUser(admin.id, (q) => q("select public.close_event_finances($1, 'ok')", [event.id])), /completed/);
    await asOwner((q) => q("update public.events set status = 'completed' where id = $1", [event.id]));
    await asUser(finance.id, (q) => q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, status) values ($1, $2, 'income', 'in', 'donation', 100, 'pending')", [event.id, college.id]));
    await expectDenied(asUser(admin.id, (q) => q("select public.close_event_finances($1, 'Reviewed by treasurer')", [event.id])), /Resolve pending/);
    await asOwner((q) => q("update public.financial_transactions set status = 'verified', verified_at = now() where event_id = $1", [event.id]));
    await expectDenied(asUser(admin.id, (q) => q("select public.close_event_finances($1, '')", [event.id])), /closing note/);
    await asUser(admin.id, (q) => q("select public.close_event_finances($1, 'Reviewed by treasurer')", [event.id]));
    const [e] = await asOwner((q) => q<{ financially_closed_at: string | null; closing_summary: { finance: { total_income_received: number } } }>("select financially_closed_at, closing_summary from public.events where id = $1", [event.id]));
    expect(e.financially_closed_at).not.toBeNull();
    expect(Number(e.closing_summary.finance.total_income_received)).toBe(100);
  });

  it("blocks new money movements after closure until a Super Admin reopens", async () => {
    await expectDenied(asUser(finance.id, (q) => q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount) values ($1, $2, 'income', 'in', 'donation', 5)", [event.id, college.id])), /finances are closed/);
    await expectDenied(asUser(admin.id, (q) => q("select public.reopen_event_finances($1, 'late invoice')", [event.id])), /Only a Super Admin/);
    await asUser(superAdmin.id, (q) => q("select public.reopen_event_finances($1, 'Late invoice from vendor')", [event.id]));
    await asUser(finance.id, (q) => q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount) values ($1, $2, 'income', 'in', 'donation', 5)", [event.id, college.id]));
  });

  it("does not let event managers edit closure columns directly", async () => {
    await asOwner((q) => q("update public.financial_transactions set status = 'verified', verified_at = now() where event_id = $1 and status = 'pending'", [event.id]));
    await asUser(admin.id, (q) => q("select public.close_event_finances($1, 'Second review')", [event.id]));
    await expectDenied(asUser(admin.id, (q) => q("update public.events set financially_closed_at = null where id = $1", [event.id])), /closing screen/);
    await expectDenied(asUser(admin.id, (q) => q("update public.events set closing_note = 'edited' where id = $1", [event.id])), /closing screen/);
    await expectDenied(asUser(admin.id, (q) => q("update public.events set status = 'live' where id = $1", [event.id])), /only be completed or archived/);
    await asUser(admin.id, (q) => q("update public.events set status = 'archived' where id = $1", [event.id]));
    await asUser(admin.id, (q) => q("update public.events set description = 'Thanks for coming' where id = $1", [event.id]));
    await asUser(superAdmin.id, (q) => q("select public.reopen_event_finances($1, 'Audit correction')", [event.id]));
    const [e] = await asOwner((q) => q<{ financially_closed_at: string | null; status: string }>("select financially_closed_at, status from public.events where id = $1", [event.id]));
    expect(e.financially_closed_at).toBeNull();
    expect(e.status).toBe("archived");
  });
});
