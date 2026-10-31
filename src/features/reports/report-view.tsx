"use client";

import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { downloadCsv, toCsv } from "@/lib/export/csv";
import { cn } from "@/lib/utils";
import { formatCell, type ReportCell, type ReportColumn, type ReportOutput } from "./types";

const PAGE = 100;
const NUMERIC = new Set(["money", "number", "percent"]);

function fileBase(title: string, scope: string) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${slug(scope)}-${slug(title)}-${new Date().toISOString().slice(0, 10)}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Raw value for spreadsheet cells: numbers stay numeric, everything else is formatted text. */
function rawCell(value: ReportCell | undefined, col: ReportColumn, report: ReportOutput): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (col.kind && NUMERIC.has(col.kind)) return Number(value);
  return formatCell(value, col.kind, report.currency, report.timeZone);
}

export function ReportView({
  report, scope, filterLabel, canExport,
}: {
  report: ReportOutput;
  /** "Event · College" or "All colleges" — printed on exports. */
  scope: string;
  /** Human readable list of active filters, printed on exports. */
  filterLabel: string;
  canExport: boolean;
}) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(report.rows.length / PAGE));
  const visible = useMemo(() => report.rows.slice(page * PAGE, page * PAGE + PAGE), [report.rows, page]);
  const base = fileBase(report.title, scope);
  const fmt = (v: ReportCell | undefined, c: ReportColumn) => formatCell(v, c.kind, report.currency, report.timeZone);

  const exportCsv = () => {
    const rows = report.rows.map((r) => Object.fromEntries(report.columns.map((c) => [c.key, rawCell(r[c.key], c, report)])));
    downloadCsv(`${base}.csv`, toCsv(rows, report.columns.map((c) => ({ key: c.key, header: c.header }))));
  };

  const exportXlsx = async () => {
    const { buildXlsx } = await import("./exporters");
    download(new Blob([await buildXlsx(report, scope, filterLabel)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${base}.xlsx`);
  };

  const exportPdf = async () => {
    const { buildPdf } = await import("./exporters");
    download(new Blob([await buildPdf(report, scope, filterLabel)], { type: "application/pdf" }), `${base}.pdf`);
  };

  const run = (kind: string, fn: () => void | Promise<void>) => async () => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(`Export failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {report.summary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {report.summary.map((s, i) => (
            <StatCard
              key={s.label}
              label={s.label}
              highlight={i === 0}
              value={typeof s.value === "number" ? formatCell(s.value, s.kind, report.currency) || "0" : s.value}
            />
          ))}
        </div>
      )}

      {(report.notes.length > 0 || report.truncated) && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            {report.truncated && <p>Only the first 5,000 rows are included. Narrow the date range to see the rest.</p>}
            {report.notes.map((note) => <p key={note}>{note}</p>)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {report.rows.length.toLocaleString("en-IN")} row{report.rows.length === 1 ? "" : "s"}
        </p>
        {canExport ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!report.rows.length || busy !== null} onClick={run("csv", exportCsv)}>
              <FileDown /> CSV
            </Button>
            <Button variant="outline" size="sm" disabled={!report.rows.length || busy !== null} onClick={run("xlsx", exportXlsx)}>
              <FileSpreadsheet /> {busy === "xlsx" ? "Preparing…" : "Excel"}
            </Button>
            <Button variant="outline" size="sm" disabled={!report.rows.length || busy !== null} onClick={run("pdf", exportPdf)}>
              <FileText /> {busy === "pdf" ? "Preparing…" : "PDF"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Exporting needs the “Export reports” permission.</p>
        )}
      </div>

      {report.rows.length === 0 ? (
        <EmptyState icon={FileText} title="No data" description="Nothing matches these filters yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {report.columns.map((c) => (
                  <TableHead key={c.key} className={cn("whitespace-nowrap", c.kind && NUMERIC.has(c.kind) && "text-right")}>{c.header}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r, i) => (
                <TableRow key={page * PAGE + i}>
                  {report.columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn("max-w-72 truncate", c.kind && NUMERIC.has(c.kind) && "tabular text-right", c.kind === "status" && "capitalize")}
                      title={fmt(r[c.key], c)}
                    >
                      {fmt(r[c.key], c) || "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
