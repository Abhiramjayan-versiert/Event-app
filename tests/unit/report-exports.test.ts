import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildPdf, buildXlsx } from "@/features/reports/exporters";
import type { ReportOutput } from "@/features/reports/types";

const report: ReportOutput = {
  key: "income", title: "Income report", description: "", currency: "INR", timeZone: "Asia/Kolkata",
  columns: [
    { key: "txn", header: "Txn no." }, { key: "on", header: "Date", kind: "date" }, { key: "category", header: "Category", kind: "status" },
    { key: "amount", header: "Amount", kind: "money" }, { key: "share", header: "Share", kind: "percent" }, { key: "note", header: "Note" },
    { key: "count", header: "Count", kind: "number" },
  ],
  rows: Array.from({ length: 120 }, (_, i) => ({
    txn: `TXN-${i}`, on: "2026-11-02", category: "online_registration", amount: i % 10 === 0 ? -250 : 1234.5, share: 12.5,
    note: i === 3 ? "=cmd|' /C calc'!A0" : "Fee ₹500", count: i,
  })),
  summary: [{ label: "Net income", value: 98765, kind: "money" }, { label: "Closed", value: "1 of 2" }],
  categoryOptions: [], statusOptions: [], truncated: false, notes: ["Refunds are negative."],
};

describe("report exports", () => {
  it("builds an XLSX with numeric money cells, a header row and a summary sheet", async () => {
    const buf = await buildXlsx(report, "Tech Fest · Test College", "Filters — none");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Report")!;
    expect(ws.getRow(1).getCell(1).value).toBe("Income report");
    expect(ws.getRow(5).getCell(4).value).toBe("Amount");
    expect(ws.getRow(6).getCell(4).value).toBe(-250);
    expect(ws.getRow(7).getCell(4).value).toBe(1234.5);
    expect(ws.getRow(6).getCell(3).value).toBe("online registration");
    expect(ws.rowCount).toBe(5 + 120);
    const sum = wb.getWorksheet("Summary")!;
    expect(sum.getRow(2).values).toEqual([undefined, "Net income", 98765]);
    expect(sum.getRow(3).values).toEqual([undefined, "Closed", "1 of 2"]);
  });

  it("builds a multi-page landscape PDF", async () => {
    const buf = await buildPdf(report, "Tech Fest · Test College", "Filters — none");
    const text = Buffer.from(buf).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    const [, w, h] = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) ?? [];
    expect(Number(w)).toBeGreaterThan(Number(h)); // landscape A4
  });
});
