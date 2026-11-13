import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCollegeMember, addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let sa: U, collegeAdmin: U, eventAdmin: U, mediaHead: U, mediaMember: U, financeHead: U, opsHead: U;
let event: { id: string };
let media: string, marketing: string, finance: string, ops: string;

const canDept = (u: string, dept: string, perm: string) =>
  asUser(u, (q) => q<{ ok: boolean }>("select app.has_department_permission($1, $2) as ok", [dept, perm])).then((r) => r[0].ok);

beforeAll(async () => {
  [sa, collegeAdmin, eventAdmin, mediaHead, mediaMember, financeHead, opsHead] = await Promise.all([
    createUser("Lk Super", { superAdmin: true }), createUser("Lk College Admin"), createUser("Lk Event Admin"), createUser("Lk Media Head"),
    createUser("Lk Media Member"), createUser("Lk Finance Head"), createUser("Lk Ops Head"),
  ]);
  const college = await createCollege("Link College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
  event = await createEvent(college.id, "Link Fest");
  media = await departmentId(event.id, "Media and PR");
  marketing = await departmentId(event.id, "Marketing");
  finance = await departmentId(event.id, "Finance");
  ops = await departmentId(event.id, "Logistics");
  await addEventMember(event.id, eventAdmin.id, "event_admin");
  await addDepartmentMember(media, mediaHead.id, "media_head", "head");
  await addDepartmentMember(media, mediaMember.id, "team_member", "member");
  await addDepartmentMember(finance, financeHead.id, "finance_head", "head");
  await addDepartmentMember(ops, opsHead.id, "department_head", "head");
});
afterAll(() => pool.end());

describe("automatic department links", () => {
  it("links Marketing and Media, and Finance to every department, for leadership only", async () => {
    expect(await canDept(mediaHead.id, marketing, "department.view")).toBe(true);
    expect(await canDept(mediaHead.id, marketing, "tasks.manage")).toBe(false); // default is View
    expect(await canDept(mediaHead.id, finance, "department.view")).toBe(false);
    expect(await canDept(mediaMember.id, marketing, "department.view")).toBe(false);
    expect(await canDept(financeHead.id, ops, "department.view")).toBe(true);
    expect(await canDept(financeHead.id, media, "tasks.view")).toBe(true);
    expect(await canDept(opsHead.id, media, "department.view")).toBe(false);
    const [o] = await asUser(mediaHead.id, (q) => q<{ o: { id: string }[] }>("select public.event_departments_overview($1) as o", [event.id]));
    expect(o.o.map((d) => d.id).sort()).toEqual([media, marketing].sort());
  });

  it("lets College Admins change links; Event Admins cannot", async () => {
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.set_department_link($1, $2, 'view')", [ops, media])), /College Admin or the Super Admin/);
    await asUser(collegeAdmin.id, (q) => q("select public.set_department_link($1, $2, 'manage')", [media, marketing]));
    expect(await canDept(mediaHead.id, marketing, "tasks.manage")).toBe(true);
    const [{ id }] = await asUser(collegeAdmin.id, (q) => q<{ id: string }>("select public.set_department_link($1, $2, 'view') as id", [ops, media]));
    expect(await canDept(opsHead.id, media, "department.view")).toBe(true);
    await asUser(collegeAdmin.id, (q) => q("select public.remove_department_link($1)", [id]));
    expect(await canDept(opsHead.id, media, "department.view")).toBe(false);
    const [fin] = await asOwner((q) => q<{ id: string }>("select id from public.department_links where from_department_id = $1 and to_department_id is null", [finance]));
    await asUser(collegeAdmin.id, (q) => q("select public.remove_department_link($1)", [fin.id]));
    expect(await canDept(financeHead.id, ops, "department.view")).toBe(false);
  });
});

describe("Super Admin broadcasts", () => {
  it("reach everyone as a pop-up and a notification until acknowledged", async () => {
    const [a] = await asUser(sa.id, (q) => q<{ id: string; is_broadcast: boolean }>(
      "insert into public.announcements (scope, title, body, created_by) values ('global', 'Venue changed', 'Main hall moved to Block B', $1) returning id, is_broadcast", [sa.id]));
    expect(a.is_broadcast).toBe(true);
    const unread = await asUser(opsHead.id, (q) => q<{ id: string }>("select id from public.my_unread_broadcasts()"));
    expect(unread.map((r) => r.id)).toContain(a.id);
    expect(await asUser(sa.id, (q) => q("select id from public.my_unread_broadcasts() where id = $1", [a.id]))).toHaveLength(0);
    const n = await asOwner((q) => q("select 1 from public.notifications where user_id = $1 and title = 'Announcement: Venue changed'", [opsHead.id]));
    expect(n).toHaveLength(1);
    await asUser(opsHead.id, (q) => q("select public.ack_broadcast($1)", [a.id]));
    expect(await asUser(opsHead.id, (q) => q("select id from public.my_unread_broadcasts() where id = $1", [a.id]))).toHaveLength(0);
    const [{ c }] = await asUser(sa.id, (q) => q<{ c: number }>("select public.broadcast_read_count($1) as c", [a.id]));
    expect(c).toBe(1);
  });

  it("does not turn other people's announcements into broadcasts", async () => {
    const [a] = await asUser(eventAdmin.id, (q) => q<{ is_broadcast: boolean }>(
      "insert into public.announcements (scope, event_id, title, body, created_by) values ('event', $1, 'Hi', 'Team meet', $2) returning is_broadcast", [event.id, eventAdmin.id]));
    expect(a.is_broadcast).toBe(false);
  });
});
