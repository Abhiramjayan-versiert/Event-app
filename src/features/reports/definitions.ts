import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { FinanceSummary } from "@/features/dashboard/types";
import { canAnywhere, type EventPermissionSet, type PermissionKey } from "@/lib/permissions";
import type {
  ReportColumn, ReportFilterKind, ReportFilters, ReportOutput, ReportRow, ReportSummaryItem,
} from "./types";

/**
 * Report engine. Every query runs with the signed-in user's Supabase client,
 * so Row Level Security decides which rows each role sees (a department head
 * sees their own department's tasks and expenses, never another college's
 * data). Permission checks here only decide which reports are *offered*.
 */

type Client = SupabaseClient<Database>;
export type ReportEvent = { id: string; name: string; currency: string; timezone: string; status: string; starts_on: string; ends_on: string };

type Ctx = {
  supabase: Client;
  events: ReportEvent[];
  eventIds: string[];
  filters: ReportFilters;
  departments: { id: string; name: string; event_id: string }[];
};

type Loaded = {
  columns: ReportColumn[];
  rows: ReportRow[];
  categoryKey?: string;
  statusKey?: string;
  summarize: (rows: ReportRow[]) => ReportSummaryItem[];
  notes?: string[];
  truncated?: boolean;
};

export type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  /** The report is offered when the user holds ANY of these permissions (event-wide or in a department). */
  anyOf: PermissionKey[];
  filters: ReportFilterKind[];
  load: (ctx: Ctx) => Promise<Loaded>;
};

export const ROW_LIMIT = 5000;

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const sum = (rows: ReportRow[], key: string) => rows.reduce((acc, r) => acc + n(r[key]), 0);
const count = (rows: ReportRow[], pred: (r: ReportRow) => boolean) => rows.filter(pred).length;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Midnight of a calendar date in the given IANA zone, as a UTC ISO string. */
export function zonedMidnight(date: string, timeZone: string) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return new Date(guess - (wall - guess)).toISOString();
}

function nextDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function timestampBounds(ctx: Ctx) {
  const tz = ctx.events[0]?.timezone ?? "Asia/Kolkata";
  return {
    gte: ctx.filters.from ? zonedMidnight(ctx.filters.from, tz) : null,
    lt: ctx.filters.to ? zonedMidnight(nextDay(ctx.filters.to), tz) : null,
  };
}

function eventName(ctx: Ctx, id: string) {
  return ctx.events.find((e) => e.id === id)?.name ?? "";
}

function deptName(ctx: Ctx, id: string | null) {
  if (!id) return null;
  return ctx.departments.find((d) => d.id === id)?.name ?? null;
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

/** Per-event financial summaries; events the user may not see finances for are skipped. */
async function financeByEvent(ctx: Ctx) {
  const results = await Promise.all(
    ctx.eventIds.map(async (id) => {
      const { data, error } = await ctx.supabase.rpc("event_financial_summary", {
        p_event: id, p_from: ctx.filters.from ?? undefined, p_to: ctx.filters.to ?? undefined,
      });
      return [id, error ? null : (data as unknown as FinanceSummary)] as const;
    }),
  );
  return new Map(results);
}

// ---------------------------------------------------------------------------

const eventSummary: ReportDefinition = {
  key: "event-summary",
  title: "Event summary",
  description: "Headline figures for each event: registrations, money in and out, sponsorship and task progress.",
  anyOf: ["reports.view"],
  filters: ["date"],
  async load(ctx) {
    const b = timestampBounds(ctx);
    let regQ = ctx.supabase.from("registrations").select("event_id, status").in("event_id", ctx.eventIds).eq("is_test", false).limit(50000);
    if (b.gte) regQ = regQ.gte("created_at", b.gte);
    if (b.lt) regQ = regQ.lt("created_at", b.lt);
    const [regs, tasks, finance] = await Promise.all([
      regQ,
      ctx.supabase.from("tasks").select("event_id, status").in("event_id", ctx.eventIds).limit(50000),
      financeByEvent(ctx),
    ]);
    const hasFinance = [...finance.values()].some(Boolean);
    const rows: ReportRow[] = ctx.events.map((e) => {
      const r = (regs.data ?? []).filter((x) => x.event_id === e.id);
      const t = (tasks.data ?? []).filter((x) => x.event_id === e.id);
      const f = finance.get(e.id);
      const done = t.filter((x) => x.status === "completed").length;
      return {
        event: e.name, status: e.status, starts_on: e.starts_on, ends_on: e.ends_on,
        registrations: r.length, confirmed: r.filter((x) => x.status === "confirmed").length,
        income: f ? n(f.total_income_received) : null, expenditure: f ? n(f.expenditure_paid) : null,
        refunds: f ? n(f.refunds_paid) : null, net_cash: f ? n(f.net_cash_position) : null,
        sponsorship_committed: f ? n(f.sponsorship_committed) : null, outstanding_sponsorship: f ? n(f.outstanding_sponsorship) : null,
        tasks: t.length, tasks_completed: done, task_completion: pct(done, t.length),
      };
    });
    const columns: ReportColumn[] = [
      { key: "event", header: "Event" }, { key: "status", header: "Status", kind: "status" },
      { key: "starts_on", header: "Starts", kind: "date" }, { key: "ends_on", header: "Ends", kind: "date" },
      { key: "registrations", header: "Registrations", kind: "number" }, { key: "confirmed", header: "Confirmed", kind: "number" },
      ...(hasFinance
        ? ([
            { key: "income", header: "Income received", kind: "money" }, { key: "refunds", header: "Refunds", kind: "money" },
            { key: "expenditure", header: "Expenditure paid", kind: "money" }, { key: "net_cash", header: "Net cash position", kind: "money" },
            { key: "sponsorship_committed", header: "Sponsorship committed", kind: "money" },
            { key: "outstanding_sponsorship", header: "Outstanding sponsorship", kind: "money" },
          ] satisfies ReportColumn[])
        : []),
      { key: "tasks", header: "Tasks", kind: "number" }, { key: "tasks_completed", header: "Completed", kind: "number" },
      { key: "task_completion", header: "Completion", kind: "percent" },
    ];
    return {
      columns, rows,
      notes: hasFinance ? [] : ["Financial figures are hidden because you do not have finance access."],
      summarize: (rs) => [
        { label: "Registrations", value: sum(rs, "registrations"), kind: "number" },
        { label: "Confirmed", value: sum(rs, "confirmed"), kind: "number" },
        ...(hasFinance
          ? ([
              { label: "Income received", value: sum(rs, "income"), kind: "money" },
              { label: "Expenditure paid", value: sum(rs, "expenditure"), kind: "money" },
              { label: "Net cash position", value: sum(rs, "net_cash"), kind: "money" },
            ] satisfies ReportSummaryItem[])
          : []),
        { label: "Task completion", value: pct(sum(rs, "tasks_completed"), sum(rs, "tasks")), kind: "percent" },
      ],
    };
  },
};

async function loadRegistrations(ctx: Ctx) {
  const b = timestampBounds(ctx);
  let q = ctx.supabase
    .from("registrations")
    .select("id, event_id, registration_number, participant_name, email, phone, participant_college, course, academic_year, category, registration_type, team_name, team_members, source, status, payable_amount, amount_paid, amount_refunded, payment_status, created_at, items:registration_items(item_name, quantity)")
    .in("event_id", ctx.eventIds)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT + 1);
  if (b.gte) q = q.gte("created_at", b.gte);
  if (b.lt) q = q.lt("created_at", b.lt);
  const { data, error } = await q;
  if (error) fail("registrations", error);
  return { data: data.slice(0, ROW_LIMIT), truncated: data.length > ROW_LIMIT };
}

const registrationReport: ReportDefinition = {
  key: "registrations",
  title: "Registration report",
  description: "Every registration with its category, source, status and amounts.",
  anyOf: ["registrations.view"],
  filters: ["date", "category", "status"],
  async load(ctx) {
    const { data, truncated } = await loadRegistrations(ctx);
    const rows: ReportRow[] = data.map((r) => ({
      event: eventName(ctx, r.event_id), registration_number: r.registration_number, participant: r.participant_name, email: r.email,
      phone: r.phone, college: r.participant_college, category: r.category, type: r.registration_type, source: r.source, status: r.status,
      payment_status: r.payment_status, payable: n(r.payable_amount), paid: n(r.amount_paid), refunded: n(r.amount_refunded), created_at: r.created_at,
    }));
    return {
      truncated, rows, categoryKey: "category", statusKey: "status",
      columns: [
        { key: "registration_number", header: "Reg. no." }, { key: "participant", header: "Participant" }, { key: "email", header: "Email" },
        { key: "phone", header: "Phone" }, { key: "college", header: "College" }, { key: "category", header: "Category" },
        { key: "type", header: "Type", kind: "status" }, { key: "source", header: "Source", kind: "status" },
        { key: "status", header: "Status", kind: "status" }, { key: "payment_status", header: "Payment", kind: "status" },
        { key: "payable", header: "Payable", kind: "money" }, { key: "paid", header: "Paid", kind: "money" },
        { key: "refunded", header: "Refunded", kind: "money" }, { key: "created_at", header: "Registered at", kind: "datetime" },
      ],
      summarize: (rs) => [
        { label: "Registrations", value: rs.length, kind: "number" },
        { label: "Confirmed", value: count(rs, (r) => r.status === "confirmed"), kind: "number" },
        { label: "Cancelled", value: count(rs, (r) => r.status === "cancelled"), kind: "number" },
        { label: "Amount collected", value: sum(rs, "paid") - sum(rs, "refunded"), kind: "money" },
      ],
    };
  },
};

const participantReport: ReportDefinition = {
  key: "participants",
  title: "Participant report",
  description: "Participant directory: contact details, college, course, team and the competitions entered.",
  anyOf: ["registrations.view"],
  filters: ["date", "category", "status"],
  async load(ctx) {
    const { data, truncated } = await loadRegistrations(ctx);
    const rows: ReportRow[] = data.map((r) => {
      const team = Array.isArray(r.team_members) ? r.team_members.length : 0;
      return {
        event: eventName(ctx, r.event_id), participant: r.participant_name, email: r.email, phone: r.phone, college: r.participant_college,
        course: r.course, academic_year: r.academic_year, category: r.category, team_name: r.team_name,
        team_size: r.team_name || team ? team + 1 : 1, competitions: (r.items ?? []).map((i) => i.item_name).join("; "), status: r.status,
        registration_number: r.registration_number,
      };
    });
    return {
      truncated, rows, categoryKey: "category", statusKey: "status",
      columns: [
        { key: "registration_number", header: "Reg. no." }, { key: "participant", header: "Participant" }, { key: "email", header: "Email" },
        { key: "phone", header: "Phone" }, { key: "college", header: "College" }, { key: "course", header: "Course" },
        { key: "academic_year", header: "Year" }, { key: "category", header: "Category" }, { key: "team_name", header: "Team" },
        { key: "team_size", header: "Team size", kind: "number" }, { key: "competitions", header: "Competitions" },
        { key: "status", header: "Status", kind: "status" },
      ],
      summarize: (rs) => [
        { label: "Participants (incl. team members)", value: sum(rs, "team_size"), kind: "number" },
        { label: "Registrations", value: rs.length, kind: "number" },
        { label: "Colleges represented", value: new Set(rs.map((r) => String(r.college ?? "").trim().toLowerCase()).filter(Boolean)).size, kind: "number" },
        { label: "Teams", value: count(rs, (r) => Boolean(r.team_name)), kind: "number" },
      ],
    };
  },
};

const paymentReport: ReportDefinition = {
  key: "payments",
  title: "Payment report",
  description: "Online payment attempts and their gateway status, linked to registrations.",
  anyOf: ["registrations.view", "finance.view"],
  filters: ["date", "category", "status"],
  async load(ctx) {
    const b = timestampBounds(ctx);
    let q = ctx.supabase
      .from("payments")
      .select("event_id, provider, provider_order_id, provider_payment_id, amount, currency, status, method, verified_via, verified_at, failure_reason, created_at, registration:registrations(registration_number, participant_name)")
      .in("event_id", ctx.eventIds)
      .eq("is_test", false)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT + 1);
    if (b.gte) q = q.gte("created_at", b.gte);
    if (b.lt) q = q.lt("created_at", b.lt);
    const { data, error } = await q;
    if (error) fail("payments", error);
    const rows: ReportRow[] = data.slice(0, ROW_LIMIT).map((p) => ({
      event: eventName(ctx, p.event_id), created_at: p.created_at, registration_number: p.registration?.registration_number ?? null,
      participant: p.registration?.participant_name ?? null, provider: p.provider, order_id: p.provider_order_id, payment_id: p.provider_payment_id,
      method: p.method, amount: n(p.amount), status: p.status, verified_via: p.verified_via, verified_at: p.verified_at, failure_reason: p.failure_reason,
    }));
    return {
      truncated: data.length > ROW_LIMIT, rows, categoryKey: "provider", statusKey: "status",
      columns: [
        { key: "created_at", header: "Created", kind: "datetime" }, { key: "registration_number", header: "Reg. no." },
        { key: "participant", header: "Participant" }, { key: "provider", header: "Provider" }, { key: "order_id", header: "Order ID" },
        { key: "payment_id", header: "Payment ID" }, { key: "method", header: "Method" }, { key: "amount", header: "Amount", kind: "money" },
        { key: "status", header: "Status", kind: "status" }, { key: "verified_via", header: "Verified via", kind: "status" },
        { key: "verified_at", header: "Verified at", kind: "datetime" }, { key: "failure_reason", header: "Failure reason" },
      ],
      summarize: (rs) => {
        const paid = rs.filter((r) => r.status === "paid");
        return [
          { label: "Payment attempts", value: rs.length, kind: "number" },
          { label: "Successful", value: paid.length, kind: "number" },
          { label: "Failed", value: count(rs, (r) => r.status === "failed"), kind: "number" },
          { label: "Amount captured", value: sum(paid, "amount"), kind: "money" },
        ];
      },
    };
  },
};

async function loadLedger(ctx: Ctx, kinds: ("income" | "adjustment" | "refund")[]) {
  let q = ctx.supabase
    .from("financial_transactions")
    .select("event_id, department_id, txn_number, kind, direction, category, amount, occurred_on, description, payment_method, payment_reference, status, recorder:profiles!financial_transactions_recorded_by_fkey(full_name)")
    .in("event_id", ctx.eventIds)
    .in("kind", kinds)
    .order("occurred_on", { ascending: false })
    .limit(ROW_LIMIT + 1);
  if (ctx.filters.from) q = q.gte("occurred_on", ctx.filters.from);
  if (ctx.filters.to) q = q.lte("occurred_on", ctx.filters.to);
  if (ctx.filters.departmentId) q = q.eq("department_id", ctx.filters.departmentId);
  const { data, error } = await q;
  if (error) fail("transactions", error);
  return { data: data.slice(0, ROW_LIMIT), truncated: data.length > ROW_LIMIT };
}

const incomeReport: ReportDefinition = {
  key: "income",
  title: "Income report",
  description: "Income recorded in the ledger (registrations, sponsorship and other income), with refunds.",
  anyOf: ["finance.view"],
  filters: ["date", "department", "category", "status"],
  async load(ctx) {
    const { data, truncated } = await loadLedger(ctx, ["income", "adjustment", "refund"]);
    const rows: ReportRow[] = data
      .filter((t) => t.kind !== "adjustment" || t.direction === "in")
      .map((t) => ({
        event: eventName(ctx, t.event_id), txn_number: t.txn_number, occurred_on: t.occurred_on, kind: t.kind, category: t.category,
        department: deptName(ctx, t.department_id), description: t.description, method: t.payment_method, reference: t.payment_reference,
        amount: t.kind === "refund" ? -n(t.amount) : n(t.amount), status: t.status, recorded_by: t.recorder?.full_name ?? null,
      }));
    return {
      truncated, rows, categoryKey: "category", statusKey: "status",
      notes: ["Refunds are shown as negative amounts. Totals count verified entries only."],
      columns: [
        { key: "txn_number", header: "Txn no." }, { key: "occurred_on", header: "Date", kind: "date" }, { key: "kind", header: "Kind", kind: "status" },
        { key: "category", header: "Category", kind: "status" }, { key: "department", header: "Department" }, { key: "description", header: "Description" },
        { key: "method", header: "Method" }, { key: "reference", header: "Reference" }, { key: "amount", header: "Amount", kind: "money" },
        { key: "status", header: "Status", kind: "status" }, { key: "recorded_by", header: "Recorded by" },
      ],
      summarize: (rs) => {
        const v = rs.filter((r) => r.status === "verified");
        const gross = sum(v.filter((r) => r.kind !== "refund"), "amount");
        const refunds = -sum(v.filter((r) => r.kind === "refund"), "amount");
        return [
          { label: "Gross income (verified)", value: gross, kind: "money" },
          { label: "Refunds", value: refunds, kind: "money" },
          { label: "Net income", value: gross - refunds, kind: "money" },
          { label: "Pending verification", value: count(rs, (r) => r.status === "pending"), kind: "number" },
        ];
      },
    };
  },
};

const expenseReport: ReportDefinition = {
  key: "expenses",
  title: "Expense report",
  description: "Expense requests with requested, approved and paid amounts by department and category.",
  anyOf: ["finance.view", "expenses.view"],
  filters: ["date", "department", "category", "status"],
  async load(ctx) {
    let q = ctx.supabase
      .from("expense_requests")
      .select("event_id, department_id, request_number, title, category, requested_amount, approved_amount, paid_amount, status, request_date, required_by, vendor:vendors(name), submitter:profiles!expense_requests_submitted_by_fkey(full_name)")
      .in("event_id", ctx.eventIds)
      .order("request_date", { ascending: false })
      .limit(ROW_LIMIT + 1);
    if (ctx.filters.from) q = q.gte("request_date", ctx.filters.from);
    if (ctx.filters.to) q = q.lte("request_date", ctx.filters.to);
    if (ctx.filters.departmentId) q = q.eq("department_id", ctx.filters.departmentId);
    const { data, error } = await q;
    if (error) fail("expenses", error);
    const rows: ReportRow[] = data.slice(0, ROW_LIMIT).map((e) => ({
      event: eventName(ctx, e.event_id), request_number: e.request_number, title: e.title, department: deptName(ctx, e.department_id),
      category: e.category, vendor: e.vendor?.name ?? null, requested: n(e.requested_amount),
      approved: e.approved_amount === null ? null : n(e.approved_amount), paid: n(e.paid_amount), status: e.status,
      request_date: e.request_date, required_by: e.required_by, submitted_by: e.submitter?.full_name ?? null,
    }));
    return {
      truncated: data.length > ROW_LIMIT, rows, categoryKey: "category", statusKey: "status",
      columns: [
        { key: "request_number", header: "Request no." }, { key: "title", header: "Title" }, { key: "department", header: "Department" },
        { key: "category", header: "Category", kind: "status" }, { key: "vendor", header: "Vendor" },
        { key: "requested", header: "Requested", kind: "money" }, { key: "approved", header: "Approved", kind: "money" },
        { key: "paid", header: "Paid", kind: "money" }, { key: "status", header: "Status", kind: "status" },
        { key: "request_date", header: "Requested on", kind: "date" }, { key: "required_by", header: "Required by", kind: "date" },
        { key: "submitted_by", header: "Submitted by" },
      ],
      summarize: (rs) => {
        const approvedRows = rs.filter((r) => ["approved", "partially_paid", "paid"].includes(String(r.status)));
        return [
          { label: "Requests", value: rs.length, kind: "number" },
          { label: "Requested", value: sum(rs, "requested"), kind: "money" },
          { label: "Approved", value: sum(approvedRows, "approved"), kind: "money" },
          { label: "Paid", value: sum(rs, "paid"), kind: "money" },
          { label: "Approved, unpaid", value: approvedRows.reduce((a, r) => a + Math.max(n(r.approved) - n(r.paid), 0), 0), kind: "money" },
        ];
      },
    };
  },
};

const budgetReport: ReportDefinition = {
  key: "budget-utilization",
  title: "Budget utilization report",
  description: "Allocated budget against approved and paid expenses for each department.",
  anyOf: ["finance.view", "budgets.manage", "budgets.view"],
  filters: ["department"],
  async load(ctx) {
    let depts = ctx.departments;
    if (ctx.filters.departmentId) depts = depts.filter((d) => d.id === ctx.filters.departmentId);
    const ids = depts.map((d) => d.id);
    const [alloc, exp] = await Promise.all([
      ctx.supabase.from("budget_allocations").select("department_id, allocated_amount").in("department_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ctx.supabase.from("expense_requests").select("department_id, requested_amount, approved_amount, paid_amount, status").in("department_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).limit(50000),
    ]);
    if (alloc.error) fail("allocations", alloc.error);
    if (exp.error) fail("expenses", exp.error);
    const pendingStatuses = ["submitted", "under_review", "forwarded", "changes_requested"];
    const approvedStatuses = ["approved", "partially_paid", "paid"];
    const rows: ReportRow[] = depts.map((d) => {
        const allocated = n(alloc.data.find((a) => a.department_id === d.id)?.allocated_amount);
        const e = exp.data.filter((x) => x.department_id === d.id);
        const approved = e.filter((x) => approvedStatuses.includes(x.status)).reduce((a, x) => a + n(x.approved_amount), 0);
        const paid = e.reduce((a, x) => a + n(x.paid_amount), 0);
        const pending = e.filter((x) => pendingStatuses.includes(x.status)).reduce((a, x) => a + n(x.requested_amount), 0);
        return {
          event: eventName(ctx, d.event_id), department: d.name, allocated, approved, paid, pending,
          remaining: allocated - approved, utilization: pct(approved, allocated), paid_pct: pct(paid, allocated),
          over_budget: allocated > 0 && approved > allocated,
        };
      });
    return {
      rows,
      columns: [
        { key: "department", header: "Department" }, { key: "allocated", header: "Allocated", kind: "money" },
        { key: "approved", header: "Approved", kind: "money" }, { key: "paid", header: "Paid", kind: "money" },
        { key: "pending", header: "Pending requests", kind: "money" }, { key: "remaining", header: "Remaining", kind: "money" },
        { key: "utilization", header: "Utilization", kind: "percent" }, { key: "paid_pct", header: "Paid %", kind: "percent" },
        { key: "over_budget", header: "Over budget" },
      ],
      notes: ["Utilization = approved expenses ÷ allocated budget. Only departments you can see are listed."],
      summarize: (rs) => [
        { label: "Allocated", value: sum(rs, "allocated"), kind: "money" },
        { label: "Approved", value: sum(rs, "approved"), kind: "money" },
        { label: "Paid", value: sum(rs, "paid"), kind: "money" },
        { label: "Utilization", value: pct(sum(rs, "approved"), sum(rs, "allocated")), kind: "percent" },
        { label: "Over budget", value: count(rs, (r) => r.over_budget === true), kind: "number" },
      ],
    };
  },
};

const sponsorshipReport: ReportDefinition = {
  key: "sponsorship",
  title: "Sponsorship report",
  description: "Sponsorship pipeline: deals by stage with agreed, received and outstanding amounts.",
  anyOf: ["sponsors.view"],
  filters: ["date", "category", "status"],
  async load(ctx) {
    const b = timestampBounds(ctx);
    let q = ctx.supabase
      .from("sponsorship_deals")
      .select("event_id, stage, proposed_amount, agreed_amount, received_amount, confirmed_at, expected_payment_date, created_at, sponsor:sponsors(company_name, category, contact_person), package:sponsorship_packages(name), owner:profiles!sponsorship_deals_owner_id_fkey(full_name)")
      .in("event_id", ctx.eventIds)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT + 1);
    if (b.gte) q = q.gte("created_at", b.gte);
    if (b.lt) q = q.lt("created_at", b.lt);
    const [{ data, error }, deliverables] = await Promise.all([
      q,
      ctx.supabase.from("sponsorship_deliverables").select("status").in("event_id", ctx.eventIds).limit(50000),
    ]);
    if (error) fail("sponsorship deals", error);
    const committedStages = ["confirmed", "partially_paid", "fully_paid"];
    const rows: ReportRow[] = data.slice(0, ROW_LIMIT).map((d) => ({
      event: eventName(ctx, d.event_id), sponsor: d.sponsor?.company_name ?? null, category: d.sponsor?.category ?? "uncategorised",
      contact: d.sponsor?.contact_person ?? null, package: d.package?.name ?? null, stage: d.stage, proposed: n(d.proposed_amount),
      agreed: n(d.agreed_amount), received: n(d.received_amount),
      outstanding: committedStages.includes(d.stage) ? Math.max(n(d.agreed_amount) - n(d.received_amount), 0) : 0,
      expected_payment_date: d.expected_payment_date, confirmed_at: d.confirmed_at, owner: d.owner?.full_name ?? null,
    }));
    const dl = deliverables.data ?? [];
    return {
      truncated: data.length > ROW_LIMIT, rows, categoryKey: "category", statusKey: "stage",
      notes: dl.length ? [`Deliverables: ${dl.filter((x) => x.status === "completed").length} of ${dl.length} completed.`] : [],
      columns: [
        { key: "sponsor", header: "Sponsor" }, { key: "category", header: "Category" }, { key: "contact", header: "Contact" },
        { key: "package", header: "Package" }, { key: "stage", header: "Stage", kind: "status" },
        { key: "proposed", header: "Proposed", kind: "money" }, { key: "agreed", header: "Agreed", kind: "money" },
        { key: "received", header: "Received", kind: "money" }, { key: "outstanding", header: "Outstanding", kind: "money" },
        { key: "expected_payment_date", header: "Expected payment", kind: "date" }, { key: "confirmed_at", header: "Confirmed", kind: "datetime" },
        { key: "owner", header: "Owner" },
      ],
      summarize: (rs) => {
        const committed = rs.filter((r) => committedStages.includes(String(r.stage)));
        return [
          { label: "Deals", value: rs.length, kind: "number" },
          { label: "Committed", value: sum(committed, "agreed"), kind: "money" },
          { label: "Received", value: sum(rs, "received"), kind: "money" },
          { label: "Outstanding", value: sum(rs, "outstanding"), kind: "money" },
        ];
      },
    };
  },
};

const departmentReport: ReportDefinition = {
  key: "department-performance",
  title: "Department performance report",
  description: "Team size, task completion, overdue work and budget use for each department.",
  anyOf: ["reports.view"],
  filters: ["department"],
  async load(ctx) {
    let depts = ctx.departments;
    if (ctx.filters.departmentId) depts = depts.filter((d) => d.id === ctx.filters.departmentId);
    const ids = depts.length ? depts.map((d) => d.id) : ["00000000-0000-0000-0000-000000000000"];
    const [members, tasks, alloc, exp, info] = await Promise.all([
      ctx.supabase.from("department_members").select("department_id").in("department_id", ids).is("ended_at", null).eq("status", "active").limit(50000),
      ctx.supabase.from("tasks").select("department_id, status, due_at").in("department_id", ids).limit(50000),
      ctx.supabase.from("budget_allocations").select("department_id, allocated_amount").in("department_id", ids),
      ctx.supabase.from("expense_requests").select("department_id, paid_amount").in("department_id", ids).limit(50000),
      ctx.supabase.from("departments").select("id, progress_pct").in("id", ids),
    ]);
    const now = Date.now();
    const rows: ReportRow[] = depts.map((d) => {
      const t = (tasks.data ?? []).filter((x) => x.department_id === d.id);
      const done = t.filter((x) => x.status === "completed").length;
      const overdue = t.filter((x) => x.status !== "completed" && x.due_at && new Date(x.due_at).getTime() < now).length;
      const allocated = n((alloc.data ?? []).find((a) => a.department_id === d.id)?.allocated_amount);
      const spent = (exp.data ?? []).filter((x) => x.department_id === d.id).reduce((a, x) => a + n(x.paid_amount), 0);
      return {
        event: eventName(ctx, d.event_id), department: d.name,
        members: (members.data ?? []).filter((m) => m.department_id === d.id).length,
        progress: n((info.data ?? []).find((x) => x.id === d.id)?.progress_pct),
        tasks: t.length, completed: done, overdue, completion: pct(done, t.length),
        allocated, spent, budget_used: pct(spent, allocated),
      };
    });
    return {
      rows,
      columns: [
        { key: "department", header: "Department" }, { key: "members", header: "Members", kind: "number" },
        { key: "progress", header: "Reported progress", kind: "percent" }, { key: "tasks", header: "Tasks", kind: "number" },
        { key: "completed", header: "Completed", kind: "number" }, { key: "overdue", header: "Overdue", kind: "number" },
        { key: "completion", header: "Task completion", kind: "percent" }, { key: "allocated", header: "Budget", kind: "money" },
        { key: "spent", header: "Spent", kind: "money" }, { key: "budget_used", header: "Budget used", kind: "percent" },
      ],
      notes: ["Budget columns show only what your role may see."],
      summarize: (rs) => [
        { label: "Departments", value: rs.length, kind: "number" },
        { label: "Members", value: sum(rs, "members"), kind: "number" },
        { label: "Task completion", value: pct(sum(rs, "completed"), sum(rs, "tasks")), kind: "percent" },
        { label: "Overdue tasks", value: sum(rs, "overdue"), kind: "number" },
      ],
    };
  },
};

const taskReport: ReportDefinition = {
  key: "tasks",
  title: "Task completion report",
  description: "Tasks with status, priority, due date and whether they were completed on time.",
  anyOf: ["tasks.view_all", "tasks.view"],
  filters: ["date", "department", "category", "status"],
  async load(ctx) {
    const b = timestampBounds(ctx);
    let q = ctx.supabase
      .from("tasks")
      .select("event_id, department_id, title, module, status, priority, progress_pct, due_at, completed_at, created_at, assignments:task_assignments(assignee:profiles!task_assignments_user_id_fkey(full_name))")
      .in("event_id", ctx.eventIds)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(ROW_LIMIT + 1);
    if (b.gte) q = q.gte("due_at", b.gte);
    if (b.lt) q = q.lt("due_at", b.lt);
    if (ctx.filters.departmentId) q = q.eq("department_id", ctx.filters.departmentId);
    const { data, error } = await q;
    if (error) fail("tasks", error);
    const now = Date.now();
    const rows: ReportRow[] = data.slice(0, ROW_LIMIT).map((t) => {
      const due = t.due_at ? new Date(t.due_at).getTime() : null;
      const completed = t.completed_at ? new Date(t.completed_at).getTime() : null;
      const timing = t.status === "completed"
        ? due === null || completed === null ? "completed" : completed <= due ? "on_time" : "late"
        : due !== null && due < now ? "overdue" : "open";
      return {
        event: eventName(ctx, t.event_id), title: t.title, department: deptName(ctx, t.department_id), module: t.module,
        assignees: (t.assignments ?? []).map((a) => a.assignee?.full_name).filter(Boolean).join("; "),
        status: t.status, priority: t.priority, progress: n(t.progress_pct), due_at: t.due_at, completed_at: t.completed_at, timing,
      };
    });
    return {
      truncated: data.length > ROW_LIMIT, rows, categoryKey: "module", statusKey: "status",
      columns: [
        { key: "title", header: "Task" }, { key: "department", header: "Department" }, { key: "module", header: "Module", kind: "status" },
        { key: "assignees", header: "Assignees" }, { key: "status", header: "Status", kind: "status" },
        { key: "priority", header: "Priority", kind: "status" }, { key: "progress", header: "Progress", kind: "percent" },
        { key: "due_at", header: "Due", kind: "datetime" }, { key: "completed_at", header: "Completed", kind: "datetime" },
        { key: "timing", header: "Timing", kind: "status" },
      ],
      summarize: (rs) => {
        const done = count(rs, (r) => r.status === "completed");
        return [
          { label: "Tasks", value: rs.length, kind: "number" },
          { label: "Completed", value: done, kind: "number" },
          { label: "Completion", value: pct(done, rs.length), kind: "percent" },
          { label: "Overdue", value: count(rs, (r) => r.timing === "overdue"), kind: "number" },
          { label: "Completed late", value: count(rs, (r) => r.timing === "late"), kind: "number" },
        ];
      },
    };
  },
};

const marketingReport: ReportDefinition = {
  key: "marketing",
  title: "Marketing report",
  description: "Campaign budget, spend, reach, engagement and registrations generated per platform.",
  anyOf: ["marketing.view"],
  filters: ["date", "department", "category", "status"],
  async load(ctx) {
    let q = ctx.supabase
      .from("marketing_campaigns")
      .select("event_id, department_id, name, platform, channel_type, status, start_date, end_date, budget, actual_spend, reach, impressions, engagement, registrations_generated, owner:profiles!marketing_campaigns_owner_id_fkey(full_name)")
      .in("event_id", ctx.eventIds)
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(ROW_LIMIT + 1);
    if (ctx.filters.from) q = q.gte("start_date", ctx.filters.from);
    if (ctx.filters.to) q = q.lte("start_date", ctx.filters.to);
    if (ctx.filters.departmentId) q = q.eq("department_id", ctx.filters.departmentId);
    const { data, error } = await q;
    if (error) fail("campaigns", error);
    const rows: ReportRow[] = data.slice(0, ROW_LIMIT).map((c) => ({
      event: eventName(ctx, c.event_id), name: c.name, platform: c.platform, channel: c.channel_type, status: c.status,
      start_date: c.start_date, end_date: c.end_date, budget: n(c.budget), spend: n(c.actual_spend), reach: n(c.reach),
      impressions: n(c.impressions), engagement: n(c.engagement), registrations: n(c.registrations_generated),
      engagement_rate: pct(n(c.engagement), n(c.impressions)),
      cost_per_registration: n(c.registrations_generated) > 0 ? Math.round((n(c.actual_spend) / n(c.registrations_generated)) * 100) / 100 : null,
      owner: c.owner?.full_name ?? null,
    }));
    return {
      truncated: data.length > ROW_LIMIT, rows, categoryKey: "platform", statusKey: "status",
      columns: [
        { key: "name", header: "Campaign" }, { key: "platform", header: "Platform" }, { key: "channel", header: "Channel", kind: "status" },
        { key: "status", header: "Status", kind: "status" }, { key: "start_date", header: "Start", kind: "date" },
        { key: "end_date", header: "End", kind: "date" }, { key: "budget", header: "Budget", kind: "money" },
        { key: "spend", header: "Spend", kind: "money" }, { key: "reach", header: "Reach", kind: "number" },
        { key: "impressions", header: "Impressions", kind: "number" }, { key: "engagement", header: "Engagement", kind: "number" },
        { key: "engagement_rate", header: "Eng. rate", kind: "percent" }, { key: "registrations", header: "Registrations", kind: "number" },
        { key: "cost_per_registration", header: "Cost / registration", kind: "money" }, { key: "owner", header: "Owner" },
      ],
      summarize: (rs) => {
        const spend = sum(rs, "spend");
        const regs = sum(rs, "registrations");
        return [
          { label: "Campaigns", value: rs.length, kind: "number" },
          { label: "Spend", value: spend, kind: "money" },
          { label: "Reach", value: sum(rs, "reach"), kind: "number" },
          { label: "Registrations generated", value: regs, kind: "number" },
          { label: "Cost per registration", value: regs > 0 ? Math.round((spend / regs) * 100) / 100 : 0, kind: "money" },
        ];
      },
    };
  },
};

type ClosureStatus = {
  finance: FinanceSummary;
  registrations: { total: number; confirmed: number; cancelled: number; pending_payment: number };
  pending_transactions: number;
  open_expense_requests: number;
  unpaid_approved: number;
  unfinished_tasks: number;
  pending_deliverables: number;
  pending_sponsorship_payments: number;
  closed_at: string | null;
  closing_note: string | null;
};

const closingReport: ReportDefinition = {
  key: "closing",
  title: "Event closing report",
  description: "Final settlement: income, expenditure, outstanding items and the closing status of each event.",
  anyOf: ["event.close", "finance.view"],
  filters: [],
  async load(ctx) {
    const statuses = await Promise.all(
      ctx.eventIds.map(async (id) => {
        const { data, error } = await ctx.supabase.rpc("event_closure_status", { p_event: id });
        return [id, error ? null : (data as unknown as ClosureStatus)] as const;
      }),
    );
    const rows: ReportRow[] = [];
    for (const [id, s] of statuses) {
      if (!s) continue;
      const f = s.finance;
      rows.push({
        event: eventName(ctx, id), closed: s.closed_at ? "Closed" : "Open", closed_at: s.closed_at,
        registrations: n(s.registrations.total), confirmed: n(s.registrations.confirmed),
        registration_income: n(f.registration_income), sponsorship_received: n(f.sponsorship_income),
        outstanding_sponsorship: n(f.outstanding_sponsorship), other_income: n(f.other_income), refunds: n(f.refunds_paid),
        expenditure: n(f.expenditure_paid), approved_unpaid: n(f.approved_unpaid), pending_requests: n(s.open_expense_requests),
        pending_transactions: n(s.pending_transactions), net_cash: n(f.net_cash_position), unfinished_tasks: n(s.unfinished_tasks),
        pending_deliverables: n(s.pending_deliverables), closing_note: s.closing_note,
      });
    }
    return {
      rows,
      notes: statuses.some(([, s]) => !s) ? ["Events where you lack finance access are omitted."] : [],
      columns: [
        { key: "event", header: "Event" }, { key: "closed", header: "Finances" }, { key: "closed_at", header: "Closed at", kind: "datetime" },
        { key: "registrations", header: "Registrations", kind: "number" }, { key: "confirmed", header: "Confirmed", kind: "number" },
        { key: "registration_income", header: "Registration income", kind: "money" },
        { key: "sponsorship_received", header: "Sponsorship received", kind: "money" },
        { key: "outstanding_sponsorship", header: "Outstanding sponsorship", kind: "money" },
        { key: "other_income", header: "Other income", kind: "money" }, { key: "refunds", header: "Refunds", kind: "money" },
        { key: "expenditure", header: "Expenditure paid", kind: "money" }, { key: "approved_unpaid", header: "Approved unpaid", kind: "money" },
        { key: "pending_requests", header: "Open expense requests", kind: "number" },
        { key: "pending_transactions", header: "Unverified transactions", kind: "number" },
        { key: "net_cash", header: "Remaining cash position", kind: "money" }, { key: "unfinished_tasks", header: "Unfinished tasks", kind: "number" },
        { key: "pending_deliverables", header: "Pending deliverables", kind: "number" }, { key: "closing_note", header: "Closing note" },
      ],
      summarize: (rs) => [
        { label: "Income received", value: sum(rs, "registration_income") + sum(rs, "sponsorship_received") + sum(rs, "other_income"), kind: "money" },
        { label: "Expenditure paid", value: sum(rs, "expenditure"), kind: "money" },
        { label: "Remaining cash position", value: sum(rs, "net_cash"), kind: "money" },
        { label: "Financially closed", value: `${count(rs, (r) => r.closed === "Closed")} of ${rs.length}` },
      ],
    };
  },
};

export const REPORTS: ReportDefinition[] = [
  eventSummary, registrationReport, paymentReport, incomeReport, expenseReport, budgetReport,
  sponsorshipReport, departmentReport, taskReport, marketingReport, participantReport, closingReport,
];

export function getReport(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}

/** Reports a user may open in an event: requires reports.view plus the module permission. */
export function reportsFor(perms: EventPermissionSet | null) {
  if (!canAnywhere(perms, "reports.view")) return [];
  return REPORTS.filter((r) => r.anyOf.some((k) => canAnywhere(perms, k)));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates untrusted query-string filters. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): ReportFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length <= 100 ? s.trim() : undefined;
  };
  const from = one("from");
  const to = one("to");
  const dept = one("department");
  return {
    from: from && DATE_RE.test(from) ? from : undefined,
    to: to && DATE_RE.test(to) ? to : undefined,
    departmentId: dept && UUID_RE.test(dept) ? dept : undefined,
    category: one("category") || undefined,
    status: one("status") || undefined,
  };
}

export async function runReport(def: ReportDefinition, supabase: Client, events: ReportEvent[], filters: ReportFilters): Promise<ReportOutput> {
  const eventIds = events.map((e) => e.id);
  const { data: departments } = await supabase
    .from("departments")
    .select("id, name, event_id")
    .in("event_id", eventIds.length ? eventIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("status", "active")
    .order("sort_order")
    .order("name");
  const active = { ...filters };
  if (!def.filters.includes("date")) { delete active.from; delete active.to; }
  if (!def.filters.includes("department")) delete active.departmentId;
  const ctx: Ctx = { supabase, events, eventIds, filters: active, departments: departments ?? [] };
  const loaded = eventIds.length ? await def.load(ctx) : { columns: [], rows: [], summarize: () => [] } as Loaded;

  const distinct = (key?: string) =>
    key ? [...new Set(loaded.rows.map((r) => r[key]).filter((v) => v !== null && v !== "").map(String))].sort() : [];
  const categoryOptions = def.filters.includes("category") ? distinct(loaded.categoryKey) : [];
  const statusOptions = def.filters.includes("status") ? distinct(loaded.statusKey) : [];

  let rows = loaded.rows;
  if (active.category && loaded.categoryKey) rows = rows.filter((r) => String(r[loaded.categoryKey!]) === active.category);
  if (active.status && loaded.statusKey) rows = rows.filter((r) => String(r[loaded.statusKey!]) === active.status);

  const columns = events.length > 1 && loaded.columns[0]?.key !== "event"
    ? [{ key: "event", header: "Event" }, ...loaded.columns]
    : loaded.columns;

  return {
    key: def.key,
    title: def.title,
    description: def.description,
    columns,
    rows,
    summary: loaded.summarize(rows),
    currency: events[0]?.currency ?? "INR",
    timeZone: events[0]?.timezone ?? "Asia/Kolkata",
    categoryOptions,
    statusOptions,
    truncated: Boolean(loaded.truncated),
    notes: loaded.notes ?? [],
  };
}
