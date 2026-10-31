import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let head: U, member: U;
let event: { id: string }, college: { id: string };
let dept: string;

beforeAll(async () => {
  [head, member] = await Promise.all([createUser("Task Head"), createUser("Task Member")]);
  college = await createCollege("Task College");
  event = await createEvent(college.id, "Task Fest");
  dept = await departmentId(event.id, "Logistics");
  await addDepartmentMember(dept, head.id, "department_head");
  await addDepartmentMember(dept, member.id, "team_member", "member");
});
afterAll(() => pool.end());

const notes = (user: string, type: string) =>
  asOwner((q) => q<{ title: string }>("select title from public.notifications where user_id = $1 and type = $2", [user, type]));

describe("task automation", () => {
  let taskId: string;

  it("notifies assignees and records assigned_by", async () => {
    const [t] = await asUser(head.id, (q) => q<{ id: string }>("insert into public.tasks (event_id, department_id, title, due_at) values ($1, $2, 'Book buses', now() + interval '2 hours') returning id", [event.id, dept]));
    taskId = t.id;
    await asUser(head.id, (q) => q("insert into public.task_assignments (task_id, event_id, college_id, user_id) values ($1, $2, $3, $4)", [taskId, event.id, college.id, member.id]));
    expect((await notes(member.id, "task.assigned")).map((n) => n.title)).toEqual(["New task: Book buses"]);
    const [a] = await asOwner((q) => q<{ assigned_by: string }>("select assigned_by from public.task_assignments where task_id = $1", [taskId]));
    expect(a.assigned_by).toBe(head.id);
  });

  it("sends due-soon reminders once", async () => {
    await asOwner((q) => q("select app.send_task_reminders()"));
    await asOwner((q) => q("select app.send_task_reminders()"));
    expect(await notes(member.id, "task.due_soon")).toHaveLength(1);
  });

  it("notifies the creator on completion by an assignee", async () => {
    await asUser(member.id, (q) => q("update public.tasks set status = 'completed' where id = $1", [taskId]));
    expect(await notes(head.id, "task.completed")).toHaveLength(1);
  });

  it("flags overdue tasks once", async () => {
    await asUser(head.id, async (q) => {
      const [t] = await q<{ id: string }>("insert into public.tasks (event_id, department_id, title, due_at) values ($1, $2, 'Late task', now() - interval '1 day') returning id", [event.id, dept]);
      await q("insert into public.task_assignments (task_id, event_id, college_id, user_id) values ($1, $2, $3, $4)", [t.id, event.id, college.id, member.id]);
    });
    await asOwner((q) => q("select app.send_task_reminders()"));
    await asOwner((q) => q("select app.send_task_reminders()"));
    expect(await notes(member.id, "task.overdue")).toHaveLength(1);
    expect(await notes(head.id, "task.overdue")).toHaveLength(1);
  });
});
