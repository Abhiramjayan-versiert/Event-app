import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let sa: U, eventAdmin: U;
let college: { id: string };
let event: { id: string };

beforeAll(async () => {
  [sa, eventAdmin] = await Promise.all([createUser("Dp Super", { superAdmin: true }), createUser("Dp Event Admin")]);
  college = await createCollege("Participant College");
  event = await createEvent(college.id, "Participant Fest");
  await addEventMember(event.id, eventAdmin.id, "event_admin");
});
afterAll(() => pool.end());

const register = (name: string) =>
  asOwner((q) => q<{ id: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, $3, $4, 'general', 0) returning id",
    [event.id, college.id, name, `${name.toLowerCase()}@test.local`])).then((r) => r[0].id);

describe("deleting participants", () => {
  it("is Super Admin only, removes the registration with its items, and is logged", async () => {
    const reg = await register("Removable");
    const [comp] = await asOwner((q) => q<{ id: string }>("insert into public.event_competitions (event_id, college_id, name, code, fee) values ($1, $2, 'Quiz', 'QZ', 0) returning id", [event.id, college.id]));
    await asOwner((q) => q("insert into public.registration_items (registration_id, event_id, college_id, competition_id, item_name, unit_price) values ($1, $2, $3, $4, 'Quiz', 0)", [reg, event.id, college.id, comp.id]));

    // No delete policy: a direct delete silently affects nothing.
    await asUser(eventAdmin.id, (q) => q("delete from public.registrations where id = $1", [reg]));
    expect(await asOwner((q) => q("select 1 from public.registrations where id = $1", [reg]))).toHaveLength(1);
    await expectDenied(asUser(eventAdmin.id, (q) => q("select public.delete_registration($1, 'dup')", [reg])), /Only the Super Admin/);

    await asUser(sa.id, (q) => q("select public.delete_registration($1, 'Duplicate entry')", [reg]));
    expect(await asOwner((q) => q("select 1 from public.registrations where id = $1 union all select 1 from public.registration_items where registration_id = $1", [reg]))).toHaveLength(0);
    const [log] = await asOwner((q) => q<{ summary: string }>("select summary from public.activity_log where activity_type = 'registration.deleted' and entity_id = $1", [reg]));
    expect(log.summary).toMatch(/Removable.*Duplicate entry/);
  });

  it("refuses participants whose money is in the ledger, and keeps append-only for others", async () => {
    const reg = await register("Payer");
    await asOwner((q) => q("insert into public.financial_transactions (event_id, college_id, kind, direction, category, amount, registration_id) values ($1, $2, 'income', 'in', 'offline_registration', 100, $3)", [event.id, college.id, reg]));
    await expectDenied(asUser(sa.id, (q) => q("select public.delete_registration($1, null)", [reg])), /finance ledger/);
    expect(await asOwner((q) => q("select 1 from public.registrations where id = $1", [reg]))).toHaveLength(1);
  });
});
