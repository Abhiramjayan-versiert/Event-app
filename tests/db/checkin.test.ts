import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDepartmentMember, addEventMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, gate: U, outsider: U;
let college: { id: string; code: string }, event: { id: string; slug: string };

beforeAll(async () => {
  [admin, gate, outsider] = await Promise.all([createUser("Gate Admin"), createUser("Gate Volunteer"), createUser("Gate Outsider")]);
  college = await createCollege("Gate College");
  event = await createEvent(college.id, "Gate Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addDepartmentMember(await departmentId(event.id, "Registration"), gate.id, "team_member", "member");
  await asUser(admin.id, async (q) => {
    await q("insert into public.event_competitions (event_id, college_id, name, code, fee) values ($1, $2, 'Quiz', 'QUIZ', 0), ($1, $2, 'Hackathon', 'HACK', 300)", [event.id, college.id]);
  });
});
afterAll(() => pool.end());

const payload = (email: string, code = "QUIZ") => JSON.stringify({ participant: { name: "Asha", email, college: "CET" }, items: [{ competition_code: code }] });
const register = (email: string, code?: string) => asOwner((q) => q<{ r: Record<string, string> }>("select public.public_register($1, $2::jsonb) r", [event.id, payload(email, code)]));

describe("public registration page", () => {
  it("is closed until the event enables it", async () => {
    await expectDenied(register("a@x.in"), /not open/);
    const [info] = await asOwner((q) => q<{ i: { public_page: boolean; competitions: unknown[] } }>("select public.public_event_info($1, $2) i", [college.code, event.slug]));
    expect(info.i.public_page).toBe(false);
    expect(info.i.competitions).toHaveLength(2);
  });

  it("confirms free registrations instantly and leaves paid ones pending, each with a ticket", async () => {
    await asOwner((q) => q("update public.event_settings set registration_settings = registration_settings || '{\"public_page_enabled\": true}' where event_id = $1", [event.id]));
    const [free] = await register("free@x.in");
    expect(free.r.status).toBe("confirmed");
    expect(free.r.ticket_code).toMatch(/^[0-9A-F]{16}$/);
    const [paid] = await register("paid@x.in", "HACK");
    expect(paid.r.status).toBe("pending");
    const [t] = await asOwner((q) => q<{ t: { participant_name: string; items: string[]; event: { name: string } } }>("select public.public_ticket($1) t", [free.r.ticket_code.toLowerCase()]));
    expect(t.t).toMatchObject({ participant_name: "Asha", items: ["Quiz"], event: { name: "Gate Fest" } });
    await expectDenied(asUser(outsider.id, (q) => q("select public.public_ticket($1)", [free.r.ticket_code])));
  });
});

describe("gate check-in", () => {
  it("checks in confirmed tickets once, flags unpaid ones and is limited to gate staff", async () => {
    const [free] = await register("gate1@x.in");
    const [paid] = await register("gate2@x.in", "HACK");
    await expectDenied(asUser(outsider.id, (q) => q("select public.check_in_ticket($1, $2)", [event.id, free.r.ticket_code])), /not allowed/);
    const scan = (code: string) => asUser(gate.id, (q) => q<{ r: { result: string; participant_name: string } }>("select public.check_in_ticket($1, $2) r", [event.id, code]));
    expect((await scan(`https://app.example/t/${free.r.ticket_code.toLowerCase()}`))[0].r).toMatchObject({ result: "ok", participant_name: "Asha" });
    expect((await scan(free.r.ticket_code))[0].r.result).toBe("already");
    expect((await scan(paid.r.ticket_code))[0].r.result).toBe("not_confirmed");
    expect((await scan("0000000000000000"))[0].r.result).toBe("not_found");
    const [o] = await asUser(gate.id, (q) => q<{ o: { checked_in: number } }>("select public.checkin_overview($1) o", [event.id]));
    expect(o.o.checked_in).toBeGreaterThanOrEqual(1);
  });

  it("protects ticket codes and attendance from direct edits", async () => {
    const [r] = await register("gate3@x.in");
    await expectDenied(asUser(admin.id, (q) => q("update public.registrations set ticket_code = 'AAAA' where id = $1", [r.r.id])), /cannot be changed/);
    await expectDenied(asUser(admin.id, (q) => q("update public.registrations set checked_in_at = now() where id = $1", [r.r.id])), /check-in screen/);
    await asUser(gate.id, (q) => q("select public.check_in_ticket($1, $2)", [event.id, r.r.ticket_code]));
    await asUser(admin.id, (q) => q("select public.undo_check_in($1)", [r.r.id]));
    const [row] = await asOwner((q) => q<{ checked_in_at: string | null }>("select checked_in_at from public.registrations where id = $1", [r.r.id]));
    expect(row.checked_in_at).toBeNull();
  });
});
