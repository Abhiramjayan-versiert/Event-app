/** Shared (client + server) shapes for the reporting module. */

export type ColumnKind = "text" | "money" | "number" | "percent" | "date" | "datetime" | "status";

export type ReportColumn = { key: string; header: string; kind?: ColumnKind };

export type ReportCell = string | number | boolean | null;
export type ReportRow = Record<string, ReportCell>;

export type ReportSummaryItem = { label: string; value: number | string; kind?: ColumnKind };

export type ReportFilters = {
  from?: string;
  to?: string;
  departmentId?: string;
  category?: string;
  status?: string;
};

export type ReportFilterKind = "date" | "department" | "category" | "status";

export type ReportOutput = {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: ReportSummaryItem[];
  currency: string;
  timeZone: string;
  /** Options derived from the unfiltered data (category/status selects). */
  categoryOptions: string[];
  statusOptions: string[];
  truncated: boolean;
  notes: string[];
};

/** Plain-text cell value, used by exports and the on-screen table. */
export function formatCell(value: ReportCell | undefined, kind: ColumnKind | undefined, currency: string, timeZone = "Asia/Kolkata"): string {
  if (value === null || value === undefined || value === "") return "";
  switch (kind) {
    case "money": {
      const n = Number(value);
      return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
        style: "currency", currency, minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2,
      }).format(n);
    }
    case "number":
      return new Intl.NumberFormat("en-IN").format(Number(value));
    case "percent":
      return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
    case "date":
      return String(value).slice(0, 10);
    case "datetime": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
          .formatToParts(d)
          .map((x) => [x.type, x.value]),
      );
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    }
    case "status":
      return String(value).replace(/_/g, " ");
    default:
      return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  }
}
