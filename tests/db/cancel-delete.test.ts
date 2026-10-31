import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCollegeMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let sa: U, collegeAdmin: U, eventAdmin: U, outsider: U;
let college: { id: string };

beforeAll(async () => {
  [sa, collegeAdmin, eventAdmin, outsider] = await Promise.all([
    createUser("Cx Super", { superAdmin: true }),
    createUser("Cx College Admin"),
    createUser("Cx Event Admin"),
    createUser("Cx Outsider"),
  ]);
  college = await createCollege("Cancel College");
  await addCollegeMember(college.id, collegeAdmin.id, "college_admin");
});
afterAll(() => pool.end());

const logFor = (eventId: string) =>
  asOwner((q) => q<{ item_type: string; action: string; by_super_admin: boolean; reason: string | null; cleared_at: string | null }>(
    "select item_type, action, by_super_admin, reason, cleared_at from public.removal_log where event_id = $1 order by created_at", [eventId]));

describe("cancelling events", () => {
  it("lets College Admins (with a reason) and the Super Admin cancel, and blocks registrations", async () => {
    const event = await createEvent(college.id, "Cancel Fest");
    await addEventMember(event.id, eventAdmin.id, "event_admin");
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.cancel_event($1, 'rain')", [event.id])), /Only a Super Admin or a College Admin/);
    await expectDenied(asUser(outsider.id, (q) => q("select public.cancel_event($1, 'rain')", [event.id])), /Only a Super Admin or a College Admin/);
    await expectDenied(asUser(collegeAdmin.id, (q) => q("select public.cancel_event($1, '  ')", [event.id])), /reason/);
    await expectDenied(asUser(eventAdmin.id, (q) => q("update public.events set status = 'cancelled' where id = $1", [event.id])), /Cancel event/);

    await asUser(collegeAdmin.id, (q) => q("select public.cancel_event($1, 'Heavy rain')", [event.id]));
    const [e] = await asOwner((q) => q<{ status: string; cancel_reason: string }>("select status, cancel_reason from public.events where id = $1", [event.id]));
    expect(e).toEqual({ status: "cancelled", cancel_reason: "Heavy rain" });
    await expectDenied(
      asUser(eventAdmin.id, (q) => q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Late', 'late@test.local', 'general', 0)", [event.id, college.id])),
      /cancelled/,
    );
    await expectDenied(asUser(eventAdmin.id, (q) => q("update public.events set status = 'planning' where id = $1", [event.id])), /Restore event/);

    await asUser(collegeAdmin.id, (q) => q("select public.restore_event($1)", [event.id]));
    const [r] = await asOwner((q) => q<{ status: string; cancelled_at: string | null }>("select status, cancelled_at from public.events where id = $1", [event.id]));
    expect(r).toEqual({ status: "planning", cancelled_at: null });

    await asUser(sa.id, (q) => q("select public.cancel_event($1, null)", [event.id]));
    const log = await logFor(event.id);
    expect(log.map((l) => [l.action, l.by_super_admin, l.reason])).toEqual([["cancelled", false, "Heavy rain"], ["cancelled", true, null]]);
  });
});

describe("competitions", () => {
  it("cancels, restores and deletes competitions; keeps ones with registrations", async () => {
    const event = await createEvent(college.id, "Comp Fest");
    await addEventMember(event.id, eventAdmin.id, "event_admin");
    const [a, b] = await asOwner((q) => q<{ id: string }>(
      "insert into public.event_competitions (event_id, college_id, name, code, fee) values ($1, $2, 'Quiz', 'QZ', 0), ($1, $2, 'Debate', 'DB', 0) returning id", [event.id, college.id]));
    const [reg] = await asOwner((q) => q<{ id: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'P', 'p@test.local', 'general', 0) returning id", [event.id, college.id]));
    await asOwner((q) => q("insert into public.registration_items (registration_id, event_id, college_id, competition_id, item_name, unit_price) values ($1, $2, $3, $4, 'Quiz', 0)", [reg.id, event.id, college.id, a.id]));

    await expectDenied(asUser(outsider.id, (q) => q("select public.cancel_competition($1, 'x')", [a.id])), /not allowed/);
    await asUser(eventAdmin.id, (q) => q("select public.cancel_competition($1, 'No judge')", [a.id]));
    const [k] = await asOwner((q) => q<{ is_active: boolean; cancel_reason: string }>("select is_active, cancel_reason from public.event_competitions where id = $1", [a.id]));
    expect(k).toEqual({ is_active: false, cancel_reason: "No judge" });
    await asUser(eventAdmin.id, (q) => q("select public.restore_competition($1)", [a.id]));

    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.delete_competition($1, 'x')", [a.id])), /Cancel it instead/);
    await asUser(eventAdmin.id, (q) => q("select public.delete_competition($1, 'Duplicate')", [b.id]));
    expect(await asOwner((q) => q("select 1 from public.event_competitions where id = $1", [b.id]))).toHaveLength(0);
    const log = await logFor(event.id);
    expect(log.map((l) => [l.item_type, l.action, l.by_super_admin])).toEqual([["competition", "cancelled", false], ["competition", "deleted", false]]);
  });
});

describe("removal log", () => {
  it("records deleted events, is visible only to the Super Admin and can be cleared by them", async () => {
    const event = await createEvent(college.id, "Gone Fest");
    await asUser(collegeAdmin.id, (q) => q("select public.delete_event($1, 'Gone Fest')", [event.id]));
    const [row] = await logFor(event.id);
    expect(row).toMatchObject({ item_type: "event", action: "deleted", by_super_admin: false, cleared_at: null });

    expect(await asUser(collegeAdmin.id, (q) => q("select 1 from public.removal_log"))).toHaveLength(0);
    expect((await asUser(sa.id, (q) => q("select 1 from public.removal_log where event_id = $1", [event.id])))).toHaveLength(1);

    await expectDenied(asUser(collegeAdmin.id, (q) => q("select public.clear_removal_log()")), /Only the Super Admin/);
    const [{ n }] = await asUser(sa.id, (q) => q<{ n: number }>("select public.clear_removal_log() as n"));
    expect(n).toBeGreaterThanOrEqual(1);
    const [after] = await logFor(event.id);
    expect(after.cleared_at).not.toBeNull();
  });
});
