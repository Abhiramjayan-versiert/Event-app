import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, lead: U, vol: U, other: U;
let event: { id: string }, security: string;
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  [admin, lead, vol, other] = await Promise.all([createUser("Duty Admin"), createUser("Duty Lead"), createUser("Duty Volunteer"), createUser("Duty Other")]);
  const college = await createCollege("Duty College");
  event = await createEvent(college.id, "Duty Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  security = await departmentId(event.id, "Security");
  await addDepartmentMember(security, lead.id, "department_head", "head");
  await addDepartmentMember(security, vol.id, "team_member", "member");
  await addEventMember(event.id, other.id, "event_viewer");
});
afterAll(() => pool.end());

describe("duty roster", () => {
  it("lets department leads run their roster, prevents clashes and notifies volunteers", async () => {
    const shift = (u: U, title: string, from: number, to: number, dept: string | null = security) =>
      asUser(u.id, (q) => q<{ id: string }>("select public.save_duty_shift($1, null, $2::jsonb) id", [event.id, JSON.stringify({ title, department_id: dept, starts_at: at(from), ends_at: at(to), needed: 2, location: "Gate 1" })]));
    await expectDenied(shift(other, "Gate", 1, 3), /not allowed/);
    await expectDenied(shift(lead, "Stage", 1, 3, null), /not allowed/); // event-wide shifts need operations.manage
    const [{ id: gate }] = await shift(lead, "Gate", -0.25, 3);
    const [{ id: night }] = await shift(admin, "Night watch", 2, 5);
    await asUser(lead.id, (q) => q("select public.assign_duty($1, $2)", [gate, vol.id]));
    await expectDenied(asUser(admin.id, (q) => q("select public.assign_duty($1, $2)", [night, vol.id])), /already on duty/);
    const [n] = await asOwner((q) => q<{ c: string }>("select count(*) c from public.notifications where user_id = $1 and type = 'duty.assigned'", [vol.id]));
    expect(Number(n.c)).toBe(1);
  });

  it("volunteers check themselves in only during their shift; leads mark attendance", async () => {
    const [a] = await asOwner((q) => q<{ id: string }>("select a.id from public.duty_assignments a where a.user_id = $1", [vol.id]));
    await expectDenied(asUser(vol.id, (q) => q("select public.mark_duty($1, 'absent')", [a.id])), /not allowed/);
    await asUser(vol.id, (q) => q("select public.mark_duty($1, 'present')", [a.id]));
    await asUser(lead.id, (q) => q("select public.mark_duty($1, 'absent')", [a.id]));
    const [r] = await asOwner((q) => q<{ status: string }>("select status from public.duty_assignments where id = $1", [a.id]));
    expect(r.status).toBe("absent");
    const mine = await asUser(vol.id, (q) => q("select * from public.duty_assignments"));
    expect(mine).toHaveLength(1);
  });

  it("puts duties in the volunteer's calendar feed", async () => {
    const [{ t }] = await asUser(vol.id, (q) => q<{ t: string }>("select public.my_calendar_token() t"));
    const rows = await asOwner((q) => q<{ title: string }>("select title from public.calendar_feed_items($1)", [t]));
    expect(rows.map((r) => r.title)).toContain("Duty: Gate");
  });
});
