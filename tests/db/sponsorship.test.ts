import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDepartmentMember, asOwner, asUser, createCollege, createEvent, createUser, departmentId, expectDenied, pool,
} from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let sponsorHead: U, financeHead: U, mediaHead: U;
let college: { id: string }, event: { id: string };
let dealId: string, sponsorId: string;

beforeAll(async () => {
  [sponsorHead, financeHead, mediaHead] = await Promise.all([createUser("SP Head"), createUser("SP Finance"), createUser("SP Media")]);
  college = await createCollege("SP College");
  event = await createEvent(college.id, "SP Fest");
  await addDepartmentMember(await departmentId(event.id, "Sponsorship"), sponsorHead.id, "sponsorship_head");
  await addDepartmentMember(await departmentId(event.id, "Finance"), financeHead.id, "finance_head");
  await addDepartmentMember(await departmentId(event.id, "Media and PR"), mediaHead.id, "media_head");
});

afterAll(() => pool.end());

describe("sponsorship CRM", () => {
  it("sponsorship head manages sponsors and deals; others cannot see them", async () => {
    const [s] = await asUser(sponsorHead.id, (q) => q<{ id: string }>("insert into public.sponsors (event_id, college_id, company_name) values ($1, $2, 'Acme Corp') returning id", [event.id, college.id]));
    sponsorId = s.id;
    const [d] = await asUser(sponsorHead.id, (q) =>
      q<{ id: string; owner_id: string }>("insert into public.sponsorship_deals (event_id, college_id, sponsor_id, stage, proposed_amount) values ($1, $2, $3, 'lead_identified', 100000) returning id, owner_id", [event.id, college.id, sponsorId]));
    dealId = d.id;
    expect(d.owner_id).toBe(sponsorHead.id);
    expect(await asUser(mediaHead.id, (q) => q("select id from public.sponsors"))).toHaveLength(0);
  });

  it("confirming stamps confirmed_at and logs activity", async () => {
    await asUser(sponsorHead.id, (q) => q("update public.sponsorship_deals set stage = 'confirmed', agreed_amount = 80000 where id = $1", [dealId]));
    const [d] = await asOwner((q) => q<{ confirmed_at: string | null }>("select confirmed_at from public.sponsorship_deals where id = $1", [dealId]));
    expect(d.confirmed_at).not.toBeNull();
    const acts = await asOwner((q) => q<{ activity_type: string }>("select activity_type from public.activity_log where entity_id = $1", [dealId]));
    expect(acts.map((a) => a.activity_type)).toContain("sponsorship.confirmed");
  });

  it("payments are recorded pending; only finance verifies, booking income once and advancing the stage", async () => {
    const [p] = await asUser(sponsorHead.id, (q) =>
      q<{ id: string; sponsor_id: string; recorded_by: string }>("insert into public.sponsorship_payments (event_id, college_id, deal_id, sponsor_id, amount, paid_on, payment_method) values ($1, $2, $3, $3, 30000, current_date, 'Bank transfer') returning id, sponsor_id, recorded_by", [event.id, college.id, dealId]));
    expect(p.sponsor_id).toBe(sponsorId); // spoofed sponsor id corrected from the deal
    expect(p.recorded_by).toBe(sponsorHead.id);
    await expectDenied(
      asUser(sponsorHead.id, (q) => q("insert into public.sponsorship_payments (event_id, college_id, deal_id, sponsor_id, amount, paid_on, payment_method, status) values ($1, $2, $3, $3, 1, current_date, 'x', 'verified')", [event.id, college.id, dealId])),
      /row-level security/,
    );
    await expectDenied(asUser(sponsorHead.id, (q) => q("select public.verify_sponsorship_payment($1, true)", [p.id])), /Only finance/);

    await asUser(financeHead.id, (q) => q("select public.verify_sponsorship_payment($1, true)", [p.id]));
    const [d] = await asOwner((q) => q<{ stage: string; received_amount: string }>("select stage, received_amount from public.sponsorship_deals where id = $1", [dealId]));
    expect(d).toEqual({ stage: "partially_paid", received_amount: "30000.00" });
    await expectDenied(asUser(financeHead.id, (q) => q("select public.verify_sponsorship_payment($1, true)", [p.id])), /already processed/);

    const [{ s }] = await asUser(financeHead.id, (q) => q<{ s: Record<string, string> }>("select public.event_financial_summary($1) s", [event.id]));
    expect(Number(s.sponsorship_income)).toBe(30000);
    expect(Number(s.sponsorship_committed)).toBe(80000);
    expect(Number(s.outstanding_sponsorship)).toBe(50000);
  });

  it("paying the remainder marks the deal fully paid; rejected payments never count", async () => {
    const [bad] = await asUser(sponsorHead.id, (q) => q<{ id: string }>("insert into public.sponsorship_payments (event_id, college_id, deal_id, sponsor_id, amount, paid_on, payment_method) values ($1, $2, $3, $3, 999, current_date, 'Cheque') returning id", [event.id, college.id, dealId]));
    await asUser(financeHead.id, (q) => q("select public.verify_sponsorship_payment($1, false, 'Cheque bounced')", [bad.id]));
    const [rest] = await asUser(sponsorHead.id, (q) => q<{ id: string }>("insert into public.sponsorship_payments (event_id, college_id, deal_id, sponsor_id, amount, paid_on, payment_method) values ($1, $2, $3, $3, 50000, current_date, 'UPI') returning id", [event.id, college.id, dealId]));
    await asUser(financeHead.id, (q) => q("select public.verify_sponsorship_payment($1, true)", [rest.id]));
    const [d] = await asOwner((q) => q<{ stage: string; received_amount: string }>("select stage, received_amount from public.sponsorship_deals where id = $1", [dealId]));
    expect(d).toEqual({ stage: "fully_paid", received_amount: "80000.00" });
  });

  it("deliverables stamp completion", async () => {
    const [dl] = await asUser(sponsorHead.id, (q) => q<{ id: string }>("insert into public.sponsorship_deliverables (event_id, college_id, deal_id, deliverable_type) values ($1, $2, $3, 'logo_placement') returning id", [event.id, college.id, dealId]));
    const [done] = await asUser(sponsorHead.id, (q) => q<{ completed_at: string | null }>("update public.sponsorship_deliverables set status = 'completed' where id = $1 returning completed_at", [dl.id]));
    expect(done.completed_at).not.toBeNull();
  });
});
