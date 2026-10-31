import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCollegeMember, addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let collegeAdmin: U, eventAdmin: U, head: U;
let college: { id: string }, source: { id: string };

beforeAll(async () => {
  [collegeAdmin, eventAdmin, head] = await Promise.all([createUser("Clone CA"), createUser("Clone EA"), createUser("Clone Head")]);
  college = await createCollege("Clone College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
  source = await createEvent(college.id, "Fest 2026");
  await asOwner((q) => q("update public.events set starts_on = '2026-02-10', ends_on = '2026-02-12' where id = $1", [source.id]));
  await addEventMember(source.id, eventAdmin.id, "event_admin");
  const finance = await departmentId(source.id, "Finance");
  await addDepartmentMember(finance, head.id, "finance_head", "head");
  await asUser(eventAdmin.id, async (q) => {
    await q("update public.departments set status = 'archived' where event_id = $1 and name = 'Public Relations'", [source.id]);
    await q("insert into public.departments (event_id, college_id, name, kind, icon) values ($1, $2, 'Robotics', 'technical', 'cpu')", [source.id, college.id]);
    const [p] = await q<{ id: string }>("insert into public.tasks (event_id, college_id, department_id, title, due_at, status) values ($1, $2, $3, 'Book auditorium', '2026-02-01T10:00:00Z', 'completed') returning id", [source.id, college.id, finance]);
    await q("insert into public.tasks (event_id, college_id, department_id, parent_task_id, title) values ($1, $2, $3, $4, 'Pay advance')", [source.id, college.id, finance, p.id]);
    await q("insert into public.event_competitions (event_id, college_id, name, code, fee, starts_at) values ($1, $2, 'Hackathon', 'HACK', 200, '2026-02-11T04:30:00Z')", [source.id, college.id]);
    await q("update public.budgets set total_amount = 100000 where event_id = $1", [source.id]);
    await q("select public.set_department_allocation($1, 25000, 'seed')", [finance]);
  });
});
afterAll(() => pool.end());

describe("clone_event", () => {
  it("is limited to people who may create events in the college", async () => {
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.clone_event($1, 'Fest 2027', 'fest-2027', '2027-02-09', '2027-02-11')", [source.id])), /not allowed/);
  });

  it("copies structure with shifted dates and an optional team", async () => {
    const [{ id }] = await asUser(collegeAdmin.id, (q) => q<{ id: string }>("select public.clone_event($1, 'Fest 2027', 'fest-2027', '2027-02-09', '2027-02-11', true) id", [source.id]));
    const one = async <T extends Record<string, unknown>>(sql: string) => (await asOwner((q) => q<T>(sql, [id])))[0];
    const ev = await one<{ status: string; name: string }>("select status, name from public.events where id = $1");
    expect(ev).toEqual({ status: "planning", name: "Fest 2027" });
    const depts = await asOwner((q) => q<{ name: string }>("select name from public.departments where event_id = $1", [id]));
    expect(depts.map((d) => d.name)).toContain("Robotics");
    expect(depts.map((d) => d.name)).not.toContain("Public Relations");
    const tasks = await asOwner((q) => q<{ title: string; status: string; due_at: string | null; parent: string | null }>("select t.title, t.status, t.due_at, p.title parent from public.tasks t left join public.tasks p on p.id = t.parent_task_id where t.event_id = $1 order by t.title", [id]));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "not_started")).toBe(true);
    expect(tasks.find((t) => t.title === "Pay advance")?.parent).toBe("Book auditorium");
    expect(new Date(tasks.find((t) => t.title === "Book auditorium")!.due_at!).toISOString()).toBe("2027-01-31T10:00:00.000Z");
    const comp = await one<{ fee: string; starts_at: string }>("select fee, starts_at from public.event_competitions where event_id = $1");
    expect(Number(comp.fee)).toBe(200);
    const budget = await one<{ total: string; alloc: string }>("select b.total_amount total, (select sum(allocated_amount) from public.budget_allocations where event_id = $1) alloc from public.budgets b where b.event_id = $1");
    expect([Number(budget.total), Number(budget.alloc)]).toEqual([100000, 25000]);
    const team = await asOwner((q) => q("select 1 from public.event_members where event_id = $1 and ended_at is null union all select 1 from public.department_members where event_id = $1 and ended_at is null", [id]));
    expect(team).toHaveLength(2);
    const money = await asOwner((q) => q("select 1 from public.financial_transactions where event_id = $1 union all select 1 from public.registrations where event_id = $1", [id]));
    expect(money).toHaveLength(0);
  });
});
