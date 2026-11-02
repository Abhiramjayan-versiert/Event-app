import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCollegeMember, addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let collegeAdmin: U, eventAdmin: U, mediaHead: U, financeHead: U;
let event: { id: string };
let media: string, marketing: string, finance: string;

const canDept = (u: string, dept: string, perm: string) =>
  asUser(u, (q) => q<{ ok: boolean }>("select app.has_department_permission($1, $2) as ok", [dept, perm])).then((r) => r[0].ok);
const canEvent = (u: string, perm: string) =>
  asUser(u, (q) => q<{ ok: boolean }>("select app.has_event_permission($1, $2) as ok", [event.id, perm])).then((r) => r[0].ok);

beforeAll(async () => {
  [collegeAdmin, eventAdmin, mediaHead, financeHead] = await Promise.all([
    createUser("Da College Admin"), createUser("Da Event Admin"), createUser("Da Media Head"), createUser("Da Finance Head"),
  ]);
  const college = await createCollege("Access College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
  event = await createEvent(college.id, "Access Fest");
  media = await departmentId(event.id, "Media and PR");
  marketing = await departmentId(event.id, "Marketing");
  finance = await departmentId(event.id, "Finance");
  // Both heads were also made Event Admins (as on the live event).
  for (const u of [eventAdmin, mediaHead, financeHead]) await addEventMember(event.id, u.id, "event_admin");
  await addDepartmentMember(media, mediaHead.id, "media_head", "head");
  await addDepartmentMember(finance, financeHead.id, "finance_head", "head");
});
afterAll(() => pool.end());

describe("department confinement", () => {
  it("an Event Admin placed in a department only reaches that department", async () => {
    expect(await canDept(eventAdmin.id, marketing, "department.view")).toBe(true); // no department: full Event Admin
    expect(await canDept(mediaHead.id, media, "department.manage")).toBe(true);
    expect(await canDept(mediaHead.id, marketing, "department.view")).toBe(false);
    expect(await canDept(mediaHead.id, finance, "department.view")).toBe(false);
    expect(await canEvent(mediaHead.id, "event.manage")).toBe(false);
    expect(await canEvent(mediaHead.id, "media.manage")).toBe(true); // head role's event-wide powers stay
    expect(await canEvent(financeHead.id, "finance.view")).toBe(true); // finance across all departments
    expect(await canDept(financeHead.id, media, "tasks.view")).toBe(false);
    const [p] = await asUser(mediaHead.id, (q) => q<{ p: { all_departments: boolean; departments: Record<string, string[]> } }>("select public.my_event_permissions($1) as p", [event.id]));
    expect(p.p.all_departments).toBe(false);
    expect(Object.keys(p.p.departments)).toEqual([media]);
    const [o] = await asUser(mediaHead.id, (q) => q<{ o: { id: string }[] }>("select public.event_departments_overview($1) as o", [event.id]));
    expect(o.o.map((d) => d.id)).toEqual([media]);
    const [f] = await asUser(financeHead.id, (q) => q<{ o: { id: string }[] }>("select public.event_departments_overview($1) as o", [event.id]));
    expect(f.o.length).toBeGreaterThan(1); // finance oversees every department's budget
  });

  it("College Admins can give access to other departments or to all; Event Admins cannot", async () => {
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.grant_department_access($1, $2, 'view')", [marketing, mediaHead.id])), /College Admin or the Super Admin/);
    await expectDenied(asUser(eventAdmin.id, (q) => q("update public.event_members set all_departments = true where user_id = $1 and event_id = $2", [mediaHead.id, event.id])), /College Admin or the Super Admin/);

    const [{ id }] = await asUser(collegeAdmin.id, (q) => q<{ id: string }>("select public.grant_department_access($1, $2, 'view') as id", [marketing, mediaHead.id]));
    expect(await canDept(mediaHead.id, marketing, "department.view")).toBe(true);
    expect(await canDept(mediaHead.id, marketing, "tasks.manage")).toBe(false);
    await asUser(collegeAdmin.id, (q) => q("select public.grant_department_access($1, $2, 'manage')", [marketing, mediaHead.id]));
    expect(await canDept(mediaHead.id, marketing, "tasks.manage")).toBe(true);
    expect(await canEvent(mediaHead.id, "marketing.manage")).toBe(false); // grants never add event-wide powers

    const [g] = await asOwner((q) => q<{ id: string }>("select id from public.department_access_grants where user_id = $1 and department_id = $2 and ended_at is null", [mediaHead.id, marketing]));
    expect(g.id).not.toBe(id);
    await asUser(collegeAdmin.id, (q) => q("select public.revoke_department_access($1)", [g.id]));
    expect(await canDept(mediaHead.id, marketing, "department.view")).toBe(false);

    await asUser(collegeAdmin.id, (q) => q("select public.set_all_departments_access($1, $2, true)", [event.id, mediaHead.id]));
    expect(await canDept(mediaHead.id, finance, "department.view")).toBe(true);
    expect(await canEvent(mediaHead.id, "event.manage")).toBe(true);
    await asUser(collegeAdmin.id, (q) => q("select public.set_all_departments_access($1, $2, false)", [event.id, mediaHead.id]));
    expect(await canEvent(mediaHead.id, "event.manage")).toBe(false);
  });
});
