import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool,
} from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, mediaHead: U, newHead: U, member: U, outsider: U, other: U;
let event: { id: string };
let media: string, finance: string;

beforeAll(async () => {
  [admin, mediaHead, newHead, member, outsider, other] = await Promise.all([
    createUser("Dept Admin"), createUser("Media Head"), createUser("New Head"),
    createUser("Member"), createUser("Outsider"), createUser("Other"),
  ]);
  const college = await createCollege("Dept College");
  event = await createEvent(college.id, "Dept Fest");
  media = await departmentId(event.id, "Media and PR");
  finance = await departmentId(event.id, "Finance");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(media, mediaHead.id, "media_head");
});

afterAll(() => pool.end());

const activeIn = (dept: string) =>
  asOwner((q) =>
    q<{ user_id: string; position: string; role: string }>(
      `select m.user_id, m.position, r.key as role from public.department_members m join public.roles r on r.id = m.role_id
       where m.department_id = $1 and m.ended_at is null order by m.position`, [dept]),
  );

describe("assign_department_member", () => {
  it("event admin appoints a head with the role matching the department kind", async () => {
    await asUser(admin.id, (q) => q("select public.assign_department_member($1, $2, 'head')", [finance, newHead.id]));
    const rows = await activeIn(finance);
    expect(rows).toEqual([{ user_id: newHead.id, position: "head", role: "finance_head" }]);
    const [n] = await asOwner((q) => q<{ c: string }>("select count(*) c from public.notifications where user_id = $1", [newHead.id]));
    expect(Number(n.c)).toBe(1);
  });

  it("replacing a head keeps the previous appointment as history", async () => {
    await asUser(admin.id, (q) => q("select public.assign_department_member($1, $2, 'head')", [finance, other.id]));
    expect((await activeIn(finance)).map((r) => r.user_id)).toEqual([other.id]);
    const [old] = await asOwner((q) =>
      q<{ end_reason: string; ended_by: string }>("select end_reason, ended_by from public.department_members where department_id = $1 and user_id = $2", [finance, newHead.id]),
    );
    expect(old).toEqual({ end_reason: "Replaced as head", ended_by: admin.id });
  });

  it("department heads add team members but cannot appoint leaders or grant powerful roles", async () => {
    await asUser(mediaHead.id, (q) => q("select public.assign_department_member($1, $2, 'member')", [media, member.id]));
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.assign_department_member($1, $2, 'assistant_head')", [media, outsider.id])), /leadership/);
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.assign_department_member($1, $2, 'member', 'finance_head')", [media, outsider.id])), /Only event administrators/);
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.assign_department_member($1, $2, 'member')", [finance, outsider.id])), /not allowed/);
  });

  it("outsiders and team members cannot assign anyone", async () => {
    await expectDenied(asUser(outsider.id, (q) => q("select public.assign_department_member($1, $2, 'member')", [media, outsider.id])), /not allowed/);
    await expectDenied(asUser(member.id, (q) => q("select public.assign_department_member($1, $2, 'member')", [media, outsider.id])), /not allowed/);
  });

  it("changing someone's position ends the old one instead of duplicating", async () => {
    await asUser(admin.id, (q) => q("select public.assign_department_member($1, $2, 'assistant_head')", [media, member.id]));
    const rows = (await activeIn(media)).filter((r) => r.user_id === member.id);
    expect(rows).toEqual([{ user_id: member.id, position: "assistant_head", role: "assistant_head" }]);
  });
});

describe("end_department_assignment & remove_user_from_event", () => {
  it("only event admins can remove leadership", async () => {
    const [{ id }] = await asOwner((q) => q<{ id: string }>("select id from public.department_members where user_id = $1 and ended_at is null", [member.id]));
    await expectDenied(asUser(mediaHead.id, (q) => q("select public.end_department_assignment($1)", [id])), /leadership/);
    await asUser(admin.id, (q) => q("select public.end_department_assignment($1, 'Stepped down')", [id]));
    expect((await activeIn(media)).some((r) => r.user_id === member.id)).toBe(false);
  });

  it("removing a user from the event ends every membership and unassigns tasks", async () => {
    await asUser(admin.id, (q) => q("select public.assign_department_member($1, $2, 'member')", [media, outsider.id]));
    await asUser(admin.id, (q) => q("select public.assign_event_role($1, $2, 'event_viewer')", [event.id, outsider.id]));
    const [task] = await asUser(admin.id, (q) => q<{ id: string }>("insert into public.tasks (event_id, department_id, title) values ($1, $2, 'Shoot') returning id", [event.id, media]));
    await asUser(admin.id, (q) => q("insert into public.task_assignments (task_id, event_id, college_id, user_id) select $1, event_id, college_id, $2 from public.tasks where id = $1", [task.id, outsider.id]));

    await expectDenied(asUser(mediaHead.id, (q) => q("select public.remove_user_from_event($1, $2)", [event.id, outsider.id])), /not allowed/);
    await asUser(admin.id, (q) => q("select public.remove_user_from_event($1, $2, 'Left the team')", [event.id, outsider.id]));

    const [left] = await asOwner((q) =>
      q<{ em: string; dm: string; ta: string }>(
        `select (select count(*) from public.event_members where user_id = $1 and ended_at is null) em,
                (select count(*) from public.department_members where user_id = $1 and ended_at is null) dm,
                (select count(*) from public.task_assignments where user_id = $1 and unassigned_at is null) ta`, [outsider.id]),
    );
    expect(left).toEqual({ em: "0", dm: "0", ta: "0" });
    expect(await asUser(outsider.id, (q) => q("select id from public.events"))).toHaveLength(0);
  });
});

describe("event_departments_overview", () => {
  it("returns all departments with heads, and hides budgets from non-finance users", async () => {
    const [{ d }] = await asUser(mediaHead.id, (q) => q<{ d: { name: string; head: { user_id: string } | null; budget: unknown }[] }>(
      "select public.event_departments_overview($1) d", [event.id]));
    expect(d.length).toBeGreaterThanOrEqual(18);
    expect(d.find((x) => x.name === "Media and PR")?.head?.user_id).toBe(mediaHead.id);
    expect(d.find((x) => x.name === "Finance")?.budget).toBeNull();
    const [{ d: adminView }] = await asUser(admin.id, (q) => q<{ d: { name: string; budget: unknown }[] }>("select public.event_departments_overview($1) d", [event.id]));
    expect(adminView.find((x) => x.name === "Finance")?.budget).not.toBeNull();
  });

  it("is denied to people outside the event", async () => {
    await expectDenied(asUser(outsider.id, (q) => q("select public.event_departments_overview($1)", [event.id])), /Not authorized/);
  });
});
