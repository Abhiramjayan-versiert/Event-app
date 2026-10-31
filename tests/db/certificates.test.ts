import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, viewer: U;
let event: { id: string }, college: { id: string }, comp: string, solo: string, team: string;

beforeAll(async () => {
  [admin, viewer] = await Promise.all([createUser("Cert Admin"), createUser("Cert Viewer")]);
  college = await createCollege("Cert College");
  event = await createEvent(college.id, "Cert Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addEventMember(event.id, viewer.id, "event_viewer");
  await asUser(admin.id, async (q) => {
    const [k] = await q<{ id: string }>("insert into public.event_competitions (event_id, college_id, name, code, fee) values ($1, $2, 'Quiz', 'QZ', 0) returning id", [event.id, college.id]);
    comp = k.id;
    const [a] = await q<{ id: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, status) values ($1, $2, 'Asha', 'asha@x.in', 'general', 0, 'confirmed') returning id", [event.id, college.id]);
    const [b] = await q<{ id: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, status, registration_type, team_name, team_members) values ($1, $2, 'Bilal', 'bilal@x.in', 'general', 0, 'confirmed', 'team', 'Owls', '[{\"name\":\"Chen\",\"email\":\"chen@x.in\"},{\"name\":\"Dev\"}]') returning id", [event.id, college.id]);
    await q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, status) values ($1, $2, 'Pending', 'p@x.in', 'general', 0, 'pending')", [event.id, college.id]);
    solo = a.id; team = b.id;
  });
  await asOwner(async (q) => {
    await q("insert into public.registration_items (registration_id, event_id, college_id, competition_id, item_name, unit_price) values ($1, $2, $3, $4, 'Quiz', 0), ($5, $2, $3, $4, 'Quiz', 0)", [solo, event.id, college.id, comp, team]);
    await q("set local app.checkin_rpc = 'on'");
    await q("update public.registrations set checked_in_at = now() where id = $1", [solo]);
  });
});
afterAll(() => pool.end());

describe("certificates", () => {
  it("issues participation certificates per person, once, to checked-in or all confirmed", async () => {
    await expectDenied(asUser(viewer.id, (q) => q("select public.issue_certificates($1, 'participation')", [event.id])), /not allowed/);
    const [a] = await asUser(admin.id, (q) => q<{ n: number }>("select public.issue_certificates($1, 'participation', true) n", [event.id]));
    expect(a.n).toBe(1);
    const [b] = await asUser(admin.id, (q) => q<{ n: number }>("select public.issue_certificates($1, 'participation', false) n", [event.id]));
    expect(b.n).toBe(3); // Bilal + Chen + Dev; Asha already issued, pending excluded
    const [again] = await asUser(admin.id, (q) => q<{ n: number }>("select public.issue_certificates($1, 'participation', false) n", [event.id]));
    expect(again.n).toBe(0);
  });

  it("issues winner certificates from published results and verifies publicly", async () => {
    await asOwner(async (q) => {
      await q("insert into public.competition_results (competition_id, event_id, college_id, registration_id, position, title) values ($1, $2, $3, $4, 1, 'Winner')", [comp, event.id, college.id, team]);
      await q("update public.event_competitions set results_published_at = now() where id = $1", [comp]);
    });
    const [w] = await asUser(admin.id, (q) => q<{ n: number }>("select public.issue_certificates($1, 'winner') n", [event.id]));
    expect(w.n).toBe(3);
    const [c] = await asOwner((q) => q<{ code: string; id: string }>("select code, id from public.certificates where kind = 'winner' and recipient_name = 'Chen'"));
    const [v] = await asOwner((q) => q<{ v: { title: string; revoked: boolean; event: { name: string } } }>("select public.public_certificate($1) v", [c.code.toLowerCase()]));
    expect(v.v).toMatchObject({ title: "Winner · Quiz", revoked: false, event: { name: "Cert Fest" } });
    await asUser(admin.id, (q) => q("select public.set_certificate_revoked($1, true, 'Issued in error')", [c.id]));
    const [v2] = await asOwner((q) => q<{ v: { revoked: boolean } }>("select public.public_certificate($1) v", [c.code]));
    expect(v2.v.revoked).toBe(true);
    await expectDenied(asUser(admin.id, (q) => q("update public.certificates set recipient_name = 'X' where id = $1", [c.id])));
  });
});
