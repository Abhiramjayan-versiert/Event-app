import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let member: U, stranger: U;
let event: { id: string };

beforeAll(async () => {
  [member, stranger] = await Promise.all([createUser("Cal Member"), createUser("Cal Stranger")]);
  const college = await createCollege("Cal College");
  event = await createEvent(college.id, "Cal Fest");
  await addEventMember(event.id, member.id, "event_admin");
  await asUser(member.id, async (q) => {
    await q("insert into public.event_schedules (event_id, college_id, title, starts_at) values ($1, $2, 'Inauguration', now() + interval '2 days')", [event.id, college.id]);
    const [t] = await q<{ id: string }>("insert into public.tasks (event_id, college_id, title, due_at) values ($1, $2, 'Print banners', now() + interval '1 day') returning id", [event.id, college.id]);
    await q("insert into public.task_assignments (task_id, event_id, college_id, user_id) values ($1, $2, $3, $4)", [t.id, event.id, college.id, member.id]);
  });
});
afterAll(() => pool.end());

describe("calendar feeds", () => {
  it("gives each user a stable secret token that can be reset", async () => {
    const [a] = await asUser(member.id, (q) => q<{ t: string }>("select public.my_calendar_token() t"));
    const [b] = await asUser(member.id, (q) => q<{ t: string }>("select public.my_calendar_token() t"));
    expect(a.t).toMatch(/^[0-9a-f]{48}$/);
    expect(b.t).toBe(a.t);
    const [c] = await asUser(member.id, (q) => q<{ t: string }>("select public.my_calendar_token(true) t"));
    expect(c.t).not.toBe(a.t);
  });

  it("returns the member's events, schedule and assigned tasks — only via the service role", async () => {
    const [{ t }] = await asUser(member.id, (q) => q<{ t: string }>("select public.my_calendar_token() t"));
    await expectDenied(asUser(member.id, (q) => q("select * from public.calendar_feed_items($1)", [t])));
    const rows = await asOwner((q) => q<{ uid: string; title: string }>("select uid, title from public.calendar_feed_items($1)", [t]));
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Cal Fest");
    expect(titles.some((x) => x.startsWith("Inauguration"))).toBe(true);
    expect(titles).toContain("Task: Print banners");
    const [{ t: other }] = await asUser(stranger.id, (q) => q<{ t: string }>("select public.my_calendar_token() t"));
    expect(await asOwner((q) => q("select * from public.calendar_feed_items($1)", [other]))).toHaveLength(0);
    expect(await asOwner((q) => q("select * from public.calendar_feed_items('nope')"))).toHaveLength(0);
  });
});
