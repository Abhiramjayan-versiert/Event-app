import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addCollegeMember,
  addDepartmentMember,
  addEventMember,
  asAnon,
  asOwner,
  asUser,
  createCollege,
  createEvent,
  createUser,
  departmentId,
  expectDenied,
  pool,
} from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;

let superAdmin: U, collegeAdminA: U, eventAdminA1: U, financeHeadA1: U, mediaHeadA1: U, multiRole: U, outsider: U;
let collegeA: { id: string }, collegeB: { id: string };
let eventA1: { id: string }, eventA2: { id: string }, eventB1: { id: string };

beforeAll(async () => {
  [superAdmin, collegeAdminA, eventAdminA1, financeHeadA1, mediaHeadA1, multiRole, outsider] = await Promise.all([
    createUser("Super Admin", { superAdmin: true }),
    createUser("College Admin A"),
    createUser("Event Admin A1"),
    createUser("Finance Head A1"),
    createUser("Media Head A1"),
    createUser("Multi Role"),
    createUser("Outsider"),
  ]);
  collegeA = await createCollege("College A");
  collegeB = await createCollege("College B");
  eventA1 = await createEvent(collegeA.id, "Fest A1");
  eventA2 = await createEvent(collegeA.id, "Fest A2");
  eventB1 = await createEvent(collegeB.id, "Fest B1");

  await addCollegeMember(collegeA.id, collegeAdminA.id, "college_admin");
  await addEventMember(eventA1.id, eventAdminA1.id, "event_admin");
  await addDepartmentMember(await departmentId(eventA1.id, "Finance"), financeHeadA1.id, "finance_head");
  await addDepartmentMember(await departmentId(eventA1.id, "Media and PR"), mediaHeadA1.id, "media_head");
  // Same person: Finance Head in A1, Media Head in B1.
  await addDepartmentMember(await departmentId(eventA2.id, "Finance"), multiRole.id, "finance_head");
  await addDepartmentMember(await departmentId(eventB1.id, "Media and PR"), multiRole.id, "media_head");
});

afterAll(() => pool.end());

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe("profiles & identity", () => {
  it("creates a profile for every auth user, never as super admin", async () => {
    const [p] = await asOwner((q) => q<{ is_super_admin: boolean; full_name: string }>(
      "select is_super_admin, full_name from public.profiles where id = $1", [outsider.id]));
    expect(p.is_super_admin).toBe(false);
    expect(p.full_name).toBe("Outsider");
  });

  it("ignores is_super_admin smuggled through signup metadata", async () => {
    const [row] = await asOwner(async (q) => {
      await q("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'sneaky@test.local', '{\"is_super_admin\": true}')");
      return q<{ is_super_admin: boolean }>("select is_super_admin from public.profiles where email = 'sneaky@test.local'");
    });
    expect(row.is_super_admin).toBe(false);
  });

  it("prevents users from promoting themselves", async () => {
    await expectDenied(
      asUser(outsider.id, (q) => q("update public.profiles set is_super_admin = true where id = $1", [outsider.id])),
      /Super Admin/,
    );
  });

  it("lets users edit their own name", async () => {
    await asUser(outsider.id, (q) => q("update public.profiles set full_name = 'Out Sider' where id = $1", [outsider.id]));
    const [p] = await asOwner((q) => q<{ full_name: string }>("select full_name from public.profiles where id = $1", [outsider.id]));
    expect(p.full_name).toBe("Out Sider");
  });

  it("hides unrelated users' profiles", async () => {
    const rows = await asUser(outsider.id, (q) => q("select id from public.profiles"));
    expect(rows.map((r) => r.id)).toEqual([outsider.id]);
  });

  it("shows teammates' profiles within a shared event", async () => {
    const rows = await asUser(financeHeadA1.id, (q) => q<{ id: string }>("select id from public.profiles"));
    expect(ids(rows)).toEqual(expect.arrayContaining([eventAdminA1.id, mediaHeadA1.id, financeHeadA1.id]));
    expect(ids(rows)).not.toContain(multiRole.id);
  });
});

describe("college isolation", () => {
  it("super admin sees every college", async () => {
    const rows = await asUser(superAdmin.id, (q) => q<{ id: string }>("select id from public.colleges"));
    expect(ids(rows)).toEqual(expect.arrayContaining([collegeA.id, collegeB.id]));
  });

  it("college admin sees only their college and its events", async () => {
    const colleges = await asUser(collegeAdminA.id, (q) => q<{ id: string }>("select id from public.colleges"));
    expect(ids(colleges)).toEqual([collegeA.id]);
    const events = await asUser(collegeAdminA.id, (q) => q<{ id: string }>("select id from public.events"));
    expect(ids(events)).toEqual([eventA1.id, eventA2.id].sort());
  });

  it("college admin cannot create events in another college", async () => {
    await expectDenied(
      asUser(collegeAdminA.id, (q) =>
        q("insert into public.events (college_id, name, slug, starts_on, ends_on) values ($1, 'Rogue', 'rogue', current_date, current_date)", [collegeB.id]),
      ),
      /row-level security/,
    );
  });

  it("college admin can create events in their college, which bootstraps the workspace", async () => {
    const [ev] = await asUser(collegeAdminA.id, (q) =>
      q<{ id: string }>(
        "insert into public.events (college_id, name, slug, starts_on, ends_on) values ($1, 'New Fest', 'new-fest', current_date, current_date + 1) returning id",
        [collegeA.id],
      ),
    );
    const [counts] = await asOwner((q) =>
      q<{ departments: string; packages: string; settings: string; budgets: string }>(
        `select (select count(*) from public.departments where event_id = $1) as departments,
                (select count(*) from public.sponsorship_packages where event_id = $1) as packages,
                (select count(*) from public.event_settings where event_id = $1) as settings,
                (select count(*) from public.budgets where event_id = $1) as budgets`,
        [ev.id],
      ),
    );
    expect(counts).toEqual({ departments: "18", packages: "10", settings: "1", budgets: "1" });
  });

  it("only super admin can create colleges", async () => {
    await expectDenied(
      asUser(collegeAdminA.id, (q) => q("insert into public.colleges (name, code) values ('X College', 'XCOL')")),
      /row-level security/,
    );
    await asUser(superAdmin.id, (q) => q("insert into public.colleges (name, code) values ('Y College', 'YCOL')"));
  });

  it("colleges cannot be deleted through the API", async () => {
    const rows = await asUser(superAdmin.id, (q) => q("delete from public.colleges where id = $1 returning id", [collegeB.id]));
    expect(rows).toHaveLength(0);
  });

  it("outsiders see nothing", async () => {
    expect(await asUser(outsider.id, (q) => q("select id from public.colleges"))).toHaveLength(0);
    expect(await asUser(outsider.id, (q) => q("select id from public.events"))).toHaveLength(0);
    expect(await asUser(outsider.id, (q) => q("select id from public.departments"))).toHaveLength(0);
  });

  it("anonymous requests are denied", async () => {
    await expectDenied(asAnon((q) => q("select id from public.colleges")), /permission denied/);
    await expectDenied(asAnon((q) => q("select id from public.registrations")), /permission denied/);
  });
});

describe("event isolation", () => {
  it("event admin sees only their event", async () => {
    const rows = await asUser(eventAdminA1.id, (q) => q<{ id: string }>("select id from public.events"));
    expect(ids(rows)).toEqual([eventA1.id]);
    const depts = await asUser(eventAdminA1.id, (q) => q<{ event_id: string }>("select distinct event_id from public.departments"));
    expect(depts.map((d) => d.event_id)).toEqual([eventA1.id]);
  });

  it("event admin cannot modify another event", async () => {
    const rows = await asUser(eventAdminA1.id, (q) => q("update public.events set name = 'Hijacked' where id = $1 returning id", [eventA2.id]));
    expect(rows).toHaveLength(0);
  });

  it("an event cannot be moved to another college", async () => {
    await expectDenied(
      asUser(superAdmin.id, (q) => q("update public.events set college_id = $1 where id = $2", [collegeB.id, eventA1.id])),
      /cannot be moved/,
    );
  });

  it("spoofed college_id is overwritten from the event", async () => {
    const [dept] = await asUser(eventAdminA1.id, (q) =>
      q<{ college_id: string }>(
        "insert into public.departments (event_id, college_id, name) values ($1, $2, 'Robotics') returning college_id",
        [eventA1.id, collegeB.id],
      ),
    );
    expect(dept.college_id).toBe(collegeA.id);
  });

  it("rows cannot reference a department of another event", async () => {
    const foreignDept = await departmentId(eventA2.id, "Technical");
    await expectDenied(
      asUser(eventAdminA1.id, (q) =>
        q("insert into public.tasks (event_id, department_id, title) values ($1, $2, 'Cross-event task')", [eventA1.id, foreignDept]),
      ),
      /does not belong|row-level security/,
    );
  });
});

describe("department-scoped access", () => {
  it("the same user holds different roles in different events", async () => {
    const [res] = await asUser(multiRole.id, (q) =>
      q<{ a2_fin: boolean; b1_fin: boolean; b1_media: boolean; a2_media: boolean }>(
        `select app.has_event_permission($1, 'finance.view') a2_fin,
                app.has_event_permission($2, 'finance.view') b1_fin,
                app.has_event_permission($2, 'media.manage') b1_media,
                app.has_event_permission($1, 'media.manage') a2_media`,
        [eventA2.id, eventB1.id],
      ),
    );
    expect(res).toEqual({ a2_fin: true, b1_fin: false, b1_media: true, a2_media: false });
  });

  it("a department head manages their department but not others", async () => {
    const media = await departmentId(eventA1.id, "Media and PR");
    const finance = await departmentId(eventA1.id, "Finance");
    const ok = await asUser(mediaHeadA1.id, (q) => q("update public.departments set progress_pct = 40 where id = $1 returning id", [media]));
    expect(ok).toHaveLength(1);
    const blocked = await asUser(mediaHeadA1.id, (q) => q("update public.departments set progress_pct = 40 where id = $1 returning id", [finance]));
    expect(blocked).toHaveLength(0);
  });

  it("department heads can add team members but not appoint heads", async () => {
    const media = await departmentId(eventA1.id, "Media and PR");
    const member = await createUser("Photographer");
    const [{ id: teamRole }] = await asOwner((q) => q<{ id: string }>("select id from public.roles where key = 'team_member'"));
    await asUser(mediaHeadA1.id, (q) =>
      q("insert into public.department_members (department_id, event_id, college_id, user_id, role_id, position) values ($1, $2, $3, $4, $5, 'member')",
        [media, eventA1.id, collegeA.id, member.id, teamRole]),
    );
    await expectDenied(
      asUser(mediaHeadA1.id, (q) =>
        q("insert into public.department_members (department_id, event_id, college_id, user_id, role_id, position) values ($1, $2, $3, $4, $5, 'assistant_head')",
          [media, eventA1.id, collegeA.id, outsider.id, teamRole]),
      ),
      /row-level security/,
    );
  });

  it("only one active head per department", async () => {
    const media = await departmentId(eventA1.id, "Media and PR");
    const [{ id: headRole }] = await asOwner((q) => q<{ id: string }>("select id from public.roles where key = 'media_head'"));
    await expectDenied(
      asUser(eventAdminA1.id, (q) =>
        q("insert into public.department_members (department_id, event_id, college_id, user_id, role_id, position) values ($1, $2, $3, $4, $5, 'head')",
          [media, eventA1.id, collegeA.id, outsider.id, headRole]),
      ),
      /department_members_one_head/,
    );
  });

  it("media head cannot read registrations or the ledger; finance head can read the ledger", async () => {
    await asOwner((q) =>
      q("insert into public.registrations (event_id, college_id, participant_name, email, category, amount) values ($1, $2, 'Asha', 'asha@example.com', 'dance', 300)",
        [eventA1.id, collegeA.id]),
    );
    expect(await asUser(mediaHeadA1.id, (q) => q("select id from public.registrations"))).toHaveLength(0);
    expect(await asUser(financeHeadA1.id, (q) => q("select id from public.registrations"))).toHaveLength(1);
    expect(await asUser(eventAdminA1.id, (q) => q("select id from public.registrations"))).toHaveLength(1);
    await expectDenied(asUser(mediaHeadA1.id, (q) => q("select public.event_financial_summary($1)", [eventA1.id])), /Not authorized/);
    await asUser(financeHeadA1.id, (q) => q("select public.event_financial_summary($1)", [eventA1.id]));
  });

  it("my_event_permissions separates event-wide and department grants", async () => {
    const [{ p }] = await asUser(mediaHeadA1.id, (q) => q<{ p: { event: string[]; departments: Record<string, string[]> } }>(
      "select public.my_event_permissions($1) p", [eventA1.id]));
    expect(p.event).toContain("media.manage");
    expect(p.event).not.toContain("tasks.manage");
    const media = await departmentId(eventA1.id, "Media and PR");
    expect(p.departments[media]).toContain("tasks.manage");
  });

  it("event dashboard hides finance figures without finance.view", async () => {
    const [{ d }] = await asUser(mediaHeadA1.id, (q) => q<{ d: { finance: unknown; registrations: unknown } }>(
      "select public.event_dashboard($1) d", [eventA1.id]));
    expect(d.finance).toBeNull();
    expect(d.registrations).toBeNull();
    const [{ d: d2 }] = await asUser(financeHeadA1.id, (q) => q<{ d: { finance: unknown } }>(
      "select public.event_dashboard($1) d", [eventA1.id]));
    expect(d2.finance).not.toBeNull();
  });

  it("global dashboard is limited to super admins and college admins", async () => {
    await expectDenied(asUser(eventAdminA1.id, (q) => q("select public.global_dashboard()")), /Not authorized/);
    const [{ d }] = await asUser(collegeAdminA.id, (q) => q<{ d: { cards: { total_colleges: number } } }>("select public.global_dashboard() d"));
    expect(d.cards.total_colleges).toBe(1);
  });

  it("suspended users lose all access", async () => {
    const temp = await createUser("Temp Admin");
    await addEventMember(eventA1.id, temp.id, "event_admin");
    expect(await asUser(temp.id, (q) => q("select id from public.events"))).toHaveLength(1);
    await asUser(superAdmin.id, (q) => q("update public.profiles set status = 'suspended' where id = $1", [temp.id]));
    expect(await asUser(temp.id, (q) => q("select id from public.events"))).toHaveLength(0);
  });

  it("ended memberships are history, not access", async () => {
    const temp = await createUser("Former Admin");
    await addEventMember(eventA1.id, temp.id, "event_admin");
    await asOwner((q) => q("update public.event_members set ended_at = now() where user_id = $1", [temp.id]));
    expect(await asUser(temp.id, (q) => q("select id from public.events"))).toHaveLength(0);
  });
});

describe("audit trail & integration secrets", () => {
  it("records audit entries that cannot be modified", async () => {
    const rows = await asUser(superAdmin.id, (q) =>
      q<{ id: string }>("select id from public.audit_logs where entity_type = 'colleges' and entity_id = $1", [collegeA.id]),
    );
    expect(rows.length).toBeGreaterThan(0);
    await expectDenied(asOwner((q) => q("update public.audit_logs set action = 'tampered' where id = $1", [rows[0].id])), /append-only/);
    await expectDenied(asUser(superAdmin.id, (q) => q("insert into public.audit_logs (action, entity_type) values ('fake', 'x')")), /permission denied/);
  });

  it("API key hashes are never readable through the Data API", async () => {
    await asOwner((q) =>
      q("insert into public.api_credentials (event_id, college_id, name, key_prefix, key_hash) values ($1, $2, 'Website', 'eak_test_x1', 'deadbeef')",
        [eventA1.id, collegeA.id]),
    );
    const rows = await asUser(eventAdminA1.id, (q) => q("select id, key_prefix from public.api_credentials"));
    expect(rows).toHaveLength(1);
    await expectDenied(asUser(eventAdminA1.id, (q) => q("select key_hash from public.api_credentials")), /permission denied/);
    await expectDenied(asUser(superAdmin.id, (q) => q("select key_hash from public.api_credentials")), /permission denied/);
  });
});
