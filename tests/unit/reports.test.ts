import { describe, expect, it } from "vitest";
import { parseFilters, reportsFor, runReport, zonedMidnight, REPORTS, type ReportDefinition } from "@/features/reports/definitions";
import { formatCell } from "@/features/reports/types";
import { toCsv } from "@/lib/export/csv";

/** Minimal stand-in for the departments lookup runReport performs. */
function fakeClient(departments: { id: string; name: string; event_id: string }[] = []) {
  const chain = { select: () => chain, in: () => chain, eq: () => chain, order: () => chain, then: (r: (v: unknown) => void) => r({ data: departments, error: null }) };
  return { from: () => chain } as never;
}

const events = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Fest A", currency: "INR", timezone: "Asia/Kolkata", status: "live", starts_on: "2026-11-01", ends_on: "2026-11-02" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Fest B", currency: "INR", timezone: "Asia/Kolkata", status: "draft", starts_on: "2026-12-01", ends_on: "2026-12-02" },
];

const fake: ReportDefinition = {
  key: "fake", title: "Fake", description: "", anyOf: ["reports.view"], filters: ["category", "status"],
  async load() {
    return {
      columns: [{ key: "name", header: "Name" }, { key: "amount", header: "Amount", kind: "money" }],
      rows: [
        { event: "Fest A", name: "a", cat: "x", st: "open", amount: 10 },
        { event: "Fest A", name: "b", cat: "y", st: "open", amount: 20 },
        { event: "Fest B", name: "c", cat: "x", st: "closed", amount: 5 },
      ],
      categoryKey: "cat", statusKey: "st",
      summarize: (rs) => [{ label: "Total", value: rs.reduce((a, r) => a + Number(r.amount), 0), kind: "money" }],
    };
  },
};

describe("report filters", () => {
  it("accepts only well-formed dates and department ids", () => {
    expect(parseFilters({ from: "2026-11-01", to: "2026-11-30", department: "11111111-1111-1111-1111-111111111111", status: "paid" })).toEqual({
      from: "2026-11-01", to: "2026-11-30", departmentId: "11111111-1111-1111-1111-111111111111", category: undefined, status: "paid",
    });
    const bad = parseFilters({ from: "1 Nov", to: "2026-13-1x", department: "'; drop table x; --", category: "x".repeat(200) });
    expect(bad).toEqual({ from: undefined, to: undefined, departmentId: undefined, category: undefined, status: undefined });
  });

  it("computes day boundaries in the event time zone", () => {
    expect(zonedMidnight("2026-11-05", "Asia/Kolkata")).toBe("2026-11-04T18:30:00.000Z");
    expect(zonedMidnight("2026-11-05", "UTC")).toBe("2026-11-05T00:00:00.000Z");
  });
});

describe("report engine", () => {
  it("filters by category and status after deriving options from all rows", async () => {
    const out = await runReport(fake, fakeClient(), [events[0]], { category: "x", status: "open" });
    expect(out.categoryOptions).toEqual(["x", "y"]);
    expect(out.statusOptions).toEqual(["closed", "open"]);
    expect(out.rows.map((r) => r.name)).toEqual(["a"]);
    expect(out.summary).toEqual([{ label: "Total", value: 10, kind: "money" }]);
    expect(out.columns[0].key).toBe("name");
  });

  it("adds an Event column for multi-event scopes", async () => {
    const out = await runReport(fake, fakeClient(), events, {});
    expect(out.columns[0]).toEqual({ key: "event", header: "Event" });
    expect(out.rows).toHaveLength(3);
  });

  it("ignores filters the report does not support", async () => {
    let seen: unknown;
    const spy: ReportDefinition = { ...fake, filters: ["status"], load: async (ctx) => { seen = ctx.filters; return fake.load(ctx); } };
    await runReport(spy, fakeClient(), [events[0]], { from: "2026-01-01", departmentId: "11111111-1111-1111-1111-111111111111", status: "open" });
    expect(seen).toEqual({ status: "open" });
  });

  it("returns an empty report when no events are in scope", async () => {
    const out = await runReport(fake, fakeClient(), [], {});
    expect(out.rows).toEqual([]);
  });
});

describe("report catalogue and permissions", () => {
  it("ships the twelve required reports", () => {
    expect(REPORTS).toHaveLength(12);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(12);
  });

  it("offers nothing without reports.view and only module reports with it", () => {
    expect(reportsFor({ event: ["finance.view"], departments: {} })).toEqual([]);
    const deptHead = reportsFor({ event: ["event.view"], departments: { d1: ["reports.view", "tasks.view", "expenses.view", "budgets.view"] } }).map((r) => r.key);
    expect(deptHead).toEqual(["event-summary", "expenses", "budget-utilization", "department-performance", "tasks"]);
    expect(deptHead).not.toContain("income");
    expect(deptHead).not.toContain("registrations");
  });
});

describe("cell formatting and CSV safety", () => {
  it("formats money, percent, status and datetimes in the event zone", () => {
    expect(formatCell(123456.5, "money", "INR")).toBe("₹1,23,456.50");
    expect(formatCell(42.25, "percent", "INR")).toBe("42.3%");
    expect(formatCell("partially_paid", "status", "INR")).toBe("partially paid");
    expect(formatCell("2026-11-04T18:30:00Z", "datetime", "INR", "Asia/Kolkata")).toBe("2026-11-05 00:00");
    expect(formatCell(null, "money", "INR")).toBe("");
  });

  it("neutralises spreadsheet formulas in exported text", () => {
    const csv = toCsv([{ name: "=HYPERLINK(\"x\")", amount: -5 }], [{ key: "name", header: "Name" }, { key: "amount", header: "Amount" }]);
    expect(csv.split("\r\n")[1]).toBe(`"'=HYPERLINK(""x"")",-5`);
  });
});
