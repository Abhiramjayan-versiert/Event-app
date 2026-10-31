import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addEventMember, asOwner, asUser, createCollege, createEvent, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let admin: U, viewer: U;
let event: { id: string }, college: { id: string };
let survey: { id: string; token: string }, tickets: string[];

const questions = [
  { id: "overall", type: "rating", label: "Overall", required: true },
  { id: "nps", type: "nps", label: "Recommend?", required: true },
  { id: "track", type: "choice", label: "Best track", options: ["Tech", "Arts"] },
  { id: "improve", type: "text", label: "Improve" },
];

beforeAll(async () => {
  [admin, viewer] = await Promise.all([createUser("Survey Admin"), createUser("Survey Viewer")]);
  college = await createCollege("Survey College");
  event = await createEvent(college.id, "Survey Fest");
  await addEventMember(event.id, admin.id, "event_admin");
  await addEventMember(event.id, viewer.id, "event_viewer");
  tickets = [];
  for (const n of ["A", "B", "C"]) {
    const [r] = await asUser(admin.id, (q) => q<{ ticket_code: string }>("insert into public.registrations (event_id, college_id, participant_name, email, category, amount, status) values ($1, $2, $3, $4, 'general', 0, 'confirmed') returning ticket_code", [event.id, college.id, n, `${n}@x.in`]));
    tickets.push(r.ticket_code);
  }
});
afterAll(() => pool.end());

const submit = (ticket: string | null, answers: object) =>
  asOwner((q) => q("select public.submit_survey_response($1, $2, 'X', $3::jsonb)", [survey.token, ticket, JSON.stringify(answers)]));

describe("surveys", () => {
  it("is created by organisers with valid questions only", async () => {
    await expectDenied(asUser(viewer.id, (q) => q("select public.save_survey($1, null, $2::jsonb)", [event.id, JSON.stringify({ title: "Feedback", questions })])), /not allowed/);
    await expectDenied(asUser(admin.id, (q) => q("select public.save_survey($1, null, $2::jsonb)", [event.id, JSON.stringify({ title: "Bad", questions: [{ id: "x", type: "choice", label: "Pick", options: ["one"] }] })])), /two options/);
    const [r] = await asUser(admin.id, (q) => q<{ id: string }>("select public.save_survey($1, null, $2::jsonb) id", [event.id, JSON.stringify({ title: "Feedback", questions, status: "open" })]));
    const [t] = await asOwner((q) => q<{ public_token: string }>("select public_token from public.surveys where id = $1", [r.id]));
    survey = { id: r.id, token: t.public_token };
  });

  it("accepts one valid response per participant ticket", async () => {
    await expectDenied(submit(null, { overall: 5, nps: 10 }), /personal link/);
    await expectDenied(submit(tickets[0], { nps: 10 }), /Please answer: Overall/);
    await expectDenied(submit(tickets[0], { overall: 7, nps: 10 }), /Invalid rating/);
    await submit(tickets[0], { overall: 5, nps: 10, track: "Tech", improve: "More food" });
    await expectDenied(submit(tickets[0], { overall: 4, nps: 9 }), /already answered/);
    await submit(tickets[1], { overall: 3, nps: 5, track: "Arts" });
    await submit(tickets[2], { overall: 4, nps: 9 });
    const [p] = await asOwner((q) => q<{ s: { respondent: { answered: boolean } } }>("select public.public_survey($1, $2) s", [survey.token, tickets[0].toLowerCase()]));
    expect(p.s.respondent.answered).toBe(true);
  });

  it("summarises results for organisers only", async () => {
    await expectDenied(asUser(viewer.id, (q) => q("select public.survey_results($1)", [survey.id])), /not allowed/);
    const [r] = await asUser(admin.id, (q) => q<{ r: { responses: number; questions: { id: string; result: { average?: number; nps?: number; distribution?: Record<string, number>; answers?: string[] } }[] } }>("select public.survey_results($1) r", [survey.id]));
    expect(r.r.responses).toBe(3);
    const by = Object.fromEntries(r.r.questions.map((q) => [q.id, q.result]));
    expect(Number(by.overall.average)).toBe(4);
    expect(Number(by.nps.nps)).toBe(33); // 2 promoters, 1 detractor of 3
    expect(by.track.distribution).toEqual({ Tech: 1, Arts: 1 });
    expect(by.improve.answers).toEqual(["More food"]);
  });

  it("hands out invitation batches once", async () => {
    const batch = await asUser(admin.id, (q) => q<{ registration_id: string }>("select * from public.survey_invite_batch($1, 10)", [survey.id]));
    expect(batch).toHaveLength(3);
    await asUser(admin.id, (q) => q("select public.mark_survey_invited($1, $2::uuid[])", [survey.id, batch.map((b) => b.registration_id)]));
    expect(await asUser(admin.id, (q) => q("select * from public.survey_invite_batch($1, 10)", [survey.id]))).toHaveLength(0);
  });
});
