import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, judgeA: U, judgeB: U, viewer: U;
let event: { id: string }, comp: string, regs: string[];
let criteria: { id: string; name: string }[];

beforeAll(async () => {
  [admin, judgeA, judgeB, viewer] = await Promise.all([createUser("Judging Admin"), createUser("Judge A"), createUser("Judge B"), createUser("Judging Viewer")]);
  const college = await createCollege("Judging College");
  event = await createEvent(college.id, "Judging Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addEventMember(event.id, viewer.id, "event_viewer");
  const [k] = await asUser(admin.id, (q) => q<{ id: string }>("insert into public.event_competitions (event_id, college_id, name, code, fee) values ($1, $2, 'Debate', 'DEB', 0) returning id", [event.id, college.id]));
  comp = k.id;
  regs = [];
  for (const name of ["Asha", "Bilal", "Chen"]) {
    const [r] = await asUser(admin.id, (q) => q<{ id: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, status) values ($1, $2, $3, $4, 'general', 0, 'confirmed') returning id", [event.id, college.id, name, `${name.toLowerCase()}@x.in`]));
    await asUser(admin.id, (q) => q("insert into public.registration_items (registration_id, event_id, college_id, competition_id, item_name, unit_price) values ($1, $2, $3, $4, 'Debate', 0)", [r.id, event.id, college.id, comp]));
    regs.push(r.id);
  }
});
afterAll(() => pool.end());

describe("judging", () => {
  it("lets organisers set criteria and judges, not others", async () => {
    const setup = JSON.stringify([{ name: "Content", max_score: 10, weight: 2 }, { name: "Delivery", max_score: 5, weight: 1 }]);
    await expectDenied(asUser(viewer.id, (q) => q("select public.set_judging_setup($1, $2::jsonb, $3::uuid[])", [comp, setup, [judgeA.id]])), /not allowed/);
    await asUser(admin.id, (q) => q("select public.set_judging_setup($1, $2::jsonb, $3::uuid[])", [comp, setup, [judgeA.id, judgeB.id]]));
    const [sheet] = await asUser(judgeA.id, (q) => q<{ s: { criteria: { id: string; name: string }[]; entrants: unknown[]; is_judge: boolean } }>("select public.judging_sheet($1) s", [comp]));
    expect(sheet.s.is_judge).toBe(true);
    expect(sheet.s.entrants).toHaveLength(3);
    criteria = sheet.s.criteria;
    await expectDenied(asUser(viewer.id, (q) => q("select public.judging_sheet($1)", [comp])), /not a judge/);
  });

  it("accepts scores within range from assigned judges and ranks entrants", async () => {
    const [content, delivery] = criteria;
    const score = (u: U, reg: string, a: number, b: number) =>
      asUser(u.id, (q) => q("select public.submit_scores($1, $2, $3::jsonb)", [comp, reg, JSON.stringify([{ criterion_id: content.id, score: a }, { criterion_id: delivery.id, score: b }])]));
    await expectDenied(score(judgeA, regs[0], 11, 5), /between 0 and 10/);
    await expectDenied(score(viewer, regs[0], 5, 5), /Only judges/);
    await score(judgeA, regs[0], 9, 4); await score(judgeB, regs[0], 7, 4);   // avg 8/10, 4/5
    await score(judgeA, regs[1], 10, 5); await score(judgeB, regs[1], 10, 5); // perfect
    await score(judgeA, regs[2], 5, 1);
    await expectDenied(asUser(judgeA.id, (q) => q("select public.competition_leaderboard($1)", [comp])), /Only organisers/);
    const [b] = await asUser(admin.id, (q) => q<{ b: { registration_id: string; total: number; judges_scored: number }[] }>("select public.competition_leaderboard($1) b", [comp]));
    expect(b.b.map((x) => x.registration_id)).toEqual([regs[1], regs[0], regs[2]]);
    expect(Number(b.b[0].total)).toBe(100);
    expect(Number(b.b[1].total)).toBe(80); // (2*0.8 + 1*0.8)/3 = 0.8
    const own = await asUser(judgeB.id, (q) => q("select * from public.judging_scores"));
    expect(own).toHaveLength(4);
  });

  it("publishes winners, locks scoring and shows public results", async () => {
    await asUser(admin.id, (q) => q("select public.publish_results($1, $2::jsonb)", [comp, JSON.stringify([{ registration_id: regs[1], position: 1, title: "Winner" }, { registration_id: regs[0], position: 2, title: "Runner-up" }])]));
    await expectDenied(asUser(judgeA.id, (q) => q("select public.submit_scores($1, $2, '[]'::jsonb)", [comp, regs[2]])), /locked/);
    const [p] = await asOwner((q) => q<{ r: { competition: string; results: { title: string; name: string }[] }[] }>("select public.public_results($1) r", [event.id]));
    expect(p.r[0].results.map((x) => `${x.title}:${x.name}`)).toEqual(["Winner:Bilal", "Runner-up:Asha"]);
    const visible = await asUser(viewer.id, (q) => q("select * from public.competition_results where event_id = $1", [event.id]));
    expect(visible).toHaveLength(2);
    await expectDenied(asUser(admin.id, (q) => q("insert into public.competition_results (competition_id, event_id, college_id, registration_id, position, title) select competition_id, event_id, college_id, registration_id, 9, 'x' from public.competition_results limit 1")));
  });
});
