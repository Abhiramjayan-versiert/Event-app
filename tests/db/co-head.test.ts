import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let sa: U, eventAdmin: U, head: U, co1: U, co2: U;
let event: { id: string };
let finance: string;

beforeAll(async () => {
  [sa, eventAdmin, head, co1, co2] = await Promise.all([
    createUser("Ch Super", { superAdmin: true }), createUser("Ch Event Admin"), createUser("Ch Head"), createUser("Ch Co One"), createUser("Ch Co Two"),
  ]);
  const college = await createCollege("CoHead College");
  event = await createEvent(college.id, "CoHead Fest");
  await addEventMember(event.id, eventAdmin.id, "event_admin");
  finance = await departmentId(event.id, "Finance");
  await addDepartmentMember(finance, head.id, "finance_head", "head");
});
afterAll(() => pool.end());

const active = () =>
  asOwner((q) => q<{ user_id: string; position: string; role: string }>(
    "select m.user_id, m.position::text, r.key as role from public.department_members m join public.roles r on r.id = m.role_id where m.department_id = $1 and m.ended_at is null", [finance]));

describe("co-heads", () => {
  it("admins add several co-heads with the head's powers, keeping the head; heads cannot", async () => {
    await expectDenied(asUser(head.id, (q) => q("select public.assign_department_member($1, $2, 'co_head')", [finance, co1.id])), /leadership/);
    await asUser(eventAdmin.id, (q) => q("select public.assign_department_member($1, $2, 'co_head')", [finance, co1.id]));
    await asUser(eventAdmin.id, (q) => q("select public.assign_department_member($1, $2, 'co_head')", [finance, co2.id]));
    const rows = await active();
    expect(rows.find((r) => r.user_id === head.id)?.position).toBe("head");
    expect(rows.filter((r) => r.position === "co_head").map((r) => r.role)).toEqual(["finance_head", "finance_head"]);
    const [{ ok }] = await asOwner((q) => q<{ ok: boolean }>("select app.has_department_permission($1, 'finance.manage') as ok", [finance]));
    expect(typeof ok).toBe("boolean");
    await expectDenied(asUser(head.id, (q) => q("select public.end_department_assignment(m.id) from public.department_members m where m.user_id = $1 and m.department_id = $2 and m.ended_at is null", [co1.id, finance])), /leadership/);
  });

  it("only the Super Admin deletes assignment records", async () => {
    const [m] = await asOwner((q) => q<{ id: string }>("select id from public.department_members where user_id = $1 and department_id = $2 and ended_at is null", [co2.id, finance]));
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.delete_department_assignment($1)", [m.id])), /Only the Super Admin/);
    await asUser(sa.id, (q) => q("select public.delete_department_assignment($1)", [m.id]));
    expect(await asOwner((q) => q("select 1 from public.department_members where id = $1", [m.id]))).toHaveLength(0);
    // Revoking (ending) still works for admins and keeps history.
    await asUser(eventAdmin.id, (q) => q("select public.end_department_assignment(m.id, 'Done') from public.department_members m where m.user_id = $1 and m.department_id = $2 and m.ended_at is null", [co1.id, finance]));
    const [ended] = await asOwner((q) => q<{ end_reason: string }>("select end_reason from public.department_members where user_id = $1 and department_id = $2", [co1.id, finance]));
    expect(ended.end_reason).toBe("Done");
  });
});
