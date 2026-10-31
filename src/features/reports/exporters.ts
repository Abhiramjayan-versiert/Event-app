/**
 * XLSX and PDF builders. Pure functions (no DOM) so they run in the browser
 * when a user exports, and in Node for tests. Loaded on demand.
 */
import { formatCell, type ReportCell, type ReportColumn, type ReportOutput } from "./types";

const NUMERIC = new Set(["money", "number", "percent"]);

function rawCell(value: ReportCell | undefined, col: ReportColumn, report: ReportOutput): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (col.kind && NUMERIC.has(col.kind)) return Number(value);
  return formatCell(value, col.kind, report.currency, report.timeZone);
}

const generatedAt = (report: ReportOutput) =>
  `Generated ${formatCell(new Date().toISOString(), "datetime", report.currency, report.timeZone)}`;

export async function buildXlsx(report: ReportOutput, scope: string, filterLabel: string): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "EVENT APP";
  wb.created = new Date();
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.addRow([report.title]).font = { bold: true, size: 14 };
  ws.addRow([scope]);
  ws.addRow([filterLabel]);
  ws.addRow([generatedAt(report)]);
  const head = ws.addRow(report.columns.map((c) => c.header));
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF0A0A0A" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB6F23A" } };
  });
  for (const r of report.rows) ws.addRow(report.columns.map((c) => rawCell(r[c.key], c, report)));
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === "money") col.numFmt = "#,##0.00";
    if (c.kind === "percent") col.numFmt = '0.0"%"';
    if (c.kind === "number") col.numFmt = "#,##0";
    const longest = Math.max(
      c.header.length,
      ...report.rows.slice(0, 500).map((r) => formatCell(r[c.key], c.kind, report.currency, report.timeZone).length),
    );
    col.width = Math.min(Math.max(longest + 2, 10), 50);
  });
  const sum = wb.addWorksheet("Summary");
  sum.addRow(["Metric", "Value"]).font = { bold: true };
  for (const s of report.summary) {
    sum.addRow([s.label, typeof s.value === "number" && s.kind && NUMERIC.has(s.kind) ? s.value : String(s.value)]);
  }
  for (const note of report.notes) sum.addRow([note]);
  sum.getColumn(1).width = 36;
  sum.getColumn(2).width = 20;
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// Built-in PDF fonts cannot draw ₹ (or other non-Latin-1 text); use the ISO code.
const pdfText = (s: string) => s.replace(/₹/g, "INR ");

export async function buildPdf(report: ReportOutput, scope: string, filterLabel: string): Promise<ArrayBuffer> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const wide = report.columns.length > 6;
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const fmt = (v: ReportCell | undefined, c: ReportColumn) => pdfText(formatCell(v, c.kind, report.currency, report.timeZone));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(10, 10, 10);
  doc.text("EVENT", 40, 40);
  doc.setTextColor(145, 201, 39);
  doc.text("APP", 40 + doc.getTextWidth("EVENT "), 40);
  doc.setTextColor(10, 10, 10);
  doc.setFontSize(16);
  doc.text(pdfText(report.title), 40, 64);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(pdfText(scope), 40, 80);
  doc.text(pdfText(filterLabel), 40, 92);
  doc.text(generatedAt(report), 40, 104);
  const summaryLine = report.summary
    .map((s) => `${s.label}: ${typeof s.value === "number" ? formatCell(s.value, s.kind, report.currency) : s.value}`)
    .join("   ·   ");
  doc.setTextColor(10, 10, 10);
  const lines = doc.splitTextToSize(pdfText(summaryLine), width - 80) as string[];
  doc.text(lines, 40, 122);
  autoTable(doc, {
    startY: 130 + lines.length * 11,
    head: [report.columns.map((c) => c.header)],
    body: report.rows.map((r) => report.columns.map((c) => fmt(r[c.key], c))),
    styles: { fontSize: wide ? 6.5 : 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [10, 10, 10], textColor: [182, 242, 58] },
    alternateRowStyles: { fillColor: [246, 250, 236] },
    columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, c.kind && NUMERIC.has(c.kind) ? { halign: "right" as const } : {}])),
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`${pdfText(report.title)} · page ${doc.getNumberOfPages()}`, 40, h - 20);
    },
  });
  if (report.notes.length) {
    const y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 140;
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(report.notes.map(pdfText).join(" "), width - 80) as string[], 40, y + 18);
  }
  return doc.output("arraybuffer");
}
