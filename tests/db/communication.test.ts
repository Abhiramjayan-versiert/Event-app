import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, head: U, member: U, finance: U;
let event: { id: string }, college: { id: string };
let tech: string;

beforeAll(async () => {
  [admin, head, member, finance] = await Promise.all([createUser("C Admin"), createUser("C Head"), createUser("C Member"), createUser("C Finance")]);
  college = await createCollege("Comm College");
  event = await createEvent(college.id, "Comm Fest");
  tech = await departmentId(event.id, "Technical");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(tech, head.id, "department_head");
  await addDepartmentMember(tech, member.id, "team_member", "member");
  await addDepartmentMember(await departmentId(event.id, "Finance"), finance.id, "finance_head");
});
afterAll(() => pool.end());

describe("announcements", () => {
  it("event announcements notify everyone else in the event", async () => {
    await asUser(admin.id, (q) => q("insert into public.announcements (scope, event_id, title, body, created_by) values ('event', $1, 'Briefing at 9', 'All hands', $2)", [event.id, admin.id]));
    for (const u of [head, member, finance]) {
      const rows = await asOwner((q) => q("select 1 from public.notifications where user_id = $1 and type = 'announcement'", [u.id]));
      expect(rows).toHaveLength(1);
    }
    expect(await asOwner((q) => q("select 1 from public.notifications where user_id = $1 and type = 'announcement'", [admin.id]))).toHaveLength(0);
  });

  it("department heads post to their department only; team members cannot post", async () => {
    await asUser(head.id, (q) => q("insert into public.announcements (scope, event_id, department_id, title, body, created_by) values ('department', $1, $2, 'Cables', 'Bring cables', $3)", [event.id, tech, head.id]));
    await expectDenied(asUser(member.id, (q) => q("insert into public.announcements (scope, event_id, department_id, title, body, created_by) values ('department', $1, $2, 'x', 'y', $3)", [event.id, tech, member.id])), /row-level security/);
    await expectDenied(asUser(head.id, (q) => q("insert into public.announcements (scope, event_id, title, body, created_by) values ('event', $1, 'x', 'y', $2)", [event.id, head.id])), /row-level security/);
    const seen = await asUser(finance.id, (q) => q("select title from public.announcements where scope = 'department'"));
    expect(seen).toHaveLength(0);
  });
});

describe("documents", () => {
  it("visibility controls who can read document records", async () => {
    await asUser(head.id, async (q) => {
      await q("insert into public.documents (event_id, college_id, department_id, title, storage_path, mime_type, size_bytes, visibility, uploaded_by) values ($1, $2, $3, 'Dept plan', $4, 'application/pdf', 100, 'department', $5)", [event.id, college.id, tech, `${event.id}/${tech}/a.pdf`, head.id]);
      await q("insert into public.documents (event_id, college_id, department_id, title, storage_path, mime_type, size_bytes, visibility, uploaded_by) values ($1, $2, $3, 'Invoice', $4, 'application/pdf', 100, 'finance', $5)", [event.id, college.id, tech, `${event.id}/${tech}/b.pdf`, head.id]);
    });
    const memberSees = await asUser(member.id, (q) => q<{ title: string }>("select title from public.documents order by title"));
    expect(memberSees.map((d) => d.title)).toEqual(["Dept plan"]);
    const financeSees = await asUser(finance.id, (q) => q<{ title: string }>("select title from public.documents order by title"));
    expect(financeSees.map((d) => d.title)).toEqual(["Invoice"]);
    const adminSees = await asUser(admin.id, (q) => q("select title from public.documents"));
    expect(adminSees).toHaveLength(2);
  });

  it("uploads require documents.upload in the target department", async () => {
    const other = await departmentId(event.id, "Logistics");
    await expectDenied(
      asUser(member.id, (q) => q("insert into public.documents (event_id, college_id, department_id, title, storage_path, mime_type, size_bytes, visibility, uploaded_by) values ($1, $2, $3, 'x', $4, 'text/plain', 1, 'department', $5)", [event.id, college.id, other, `${event.id}/${other}/x.txt`, member.id])),
      /row-level security/,
    );
  });
});
