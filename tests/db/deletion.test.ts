import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCollegeMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let collegeAdmin: U, eventAdmin: U, outsider: U;
let college: { id: string };

beforeAll(async () => {
  [collegeAdmin, eventAdmin, outsider] = await Promise.all([createUser("Del College Admin"), createUser("Del Event Admin"), createUser("Del Outsider")]);
  college = await createCollege("Delete College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
});
afterAll(() => pool.end());

describe("deleting events", () => {
  it("deletes an event with only operational data, after typing its name", async () => {
    const event = await createEvent(college.id, "Scratch Fest");
    await addEventMember(event.id, eventAdmin.id, "event_admin");
    const dept = await departmentId(event.id, "Finance");
    await asUser(eventAdmin.id, (q) => q("insert into public.tasks (event_id, college_id, department_id, title) values ($1, $2, $3, 'Book hall')", [event.id, college.id, dept]));
    await asUser(eventAdmin.id, (q) => q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, is_test) values ($1, $2, 'Sandbox', 'sb@test.local', 'general', 0, true)", [event.id, college.id]));

    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.delete_event($1, 'Scratch Fest')", [event.id])), /Only a Super Admin or a College Admin/);
    await expectDenied(asUser(outsider.id, (q) => q("select public.delete_event($1, 'Scratch Fest')", [event.id])), /Only a Super Admin or a College Admin/);
    await expectDenied(asUser(collegeAdmin.id, (q) => q("select public.delete_event($1, 'wrong name')", [event.id])), /Type the event name/);
    await asUser(collegeAdmin.id, (q) => q("select public.delete_event($1, ' scratch fest ')", [event.id]));
    const left = await asOwner((q) => q("select 1 from public.events where id = $1 union all select 1 from public.departments where event_id = $1 union all select 1 from public.tasks where event_id = $1", [event.id]));
    expect(left).toHaveLength(0);
  });

  it("refuses to delete an event with real registrations or ledger entries", async () => {
    const event = await createEvent(college.id, "Real Fest");
    await addEventMember(event.id, eventAdmin.id, "event_admin");
    await asUser(eventAdmin.id, (q) => q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Real Person', 'real@test.local', 'general', 0)", [event.id, college.id]));
    await expectDenied(asUser(collegeAdmin.id, (q) => q("select public.delete_event($1, 'Real Fest')", [event.id])), /Archive it instead/);
  });
});

describe("deleting departments", () => {
  it("moves tasks to event level and refuses departments with money records", async () => {
    const event = await createEvent(college.id, "Dept Fest");
    await addEventMember(event.id, eventAdmin.id, "event_admin");
    const media = await departmentId(event.id, "Marketing");
    const [task] = await asUser(eventAdmin.id, (q) => q<{ id: string }>("insert into public.tasks (event_id, college_id, department_id, title) values ($1, $2, $3, 'Shoot promo') returning id", [event.id, college.id, media]));
    await expectDenied(asUser(outsider.id, (q) => q("select public.delete_department($1, 'Marketing')", [media])), /not allowed/);
    await asUser(eventAdmin.id, (q) => q("select public.delete_department($1, 'marketing')", [media]));
    const [t] = await asOwner((q) => q<{ department_id: string | null }>("select department_id from public.tasks where id = $1", [task.id]));
    expect(t.department_id).toBeNull();

    const finance = await departmentId(event.id, "Finance");
    await asUser(eventAdmin.id, (q) => q("select public.set_department_allocation($1, 5000, 'Seed')", [finance]));
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.delete_department($1, 'Finance')", [finance])), /Archive it instead/);
  });
});
