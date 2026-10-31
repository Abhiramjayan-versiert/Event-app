import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { ReportFilterKind, ReportFilters } from "./types";

type Option = { value: string; label: string };

const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** GET filter form shared by event and global reports; the URL is the source of truth. */
export function ReportFilterForm({
  action, kinds, values, departments, categoryOptions, statusOptions, scopeSelects = [], hidden = {},
}: {
  action: string;
  kinds: ReportFilterKind[];
  values: ReportFilters;
  departments: Option[];
  categoryOptions: string[];
  statusOptions: string[];
  /** Extra leading selects (college / event on the global page). */
  scopeSelects?: { name: string; label: string; value?: string; options: Option[]; allLabel: string }[];
  hidden?: Record<string, string>;
}) {
  const show = (k: ReportFilterKind) => kinds.includes(k);
  if (!scopeSelects.length && !kinds.length) return null;
  return (
    <form action={action} method="get" className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {scopeSelects.map((s) => (
        <div key={s.name} className="space-y-1.5">
          <Label htmlFor={`f-${s.name}`}>{s.label}</Label>
          <NativeSelect id={`f-${s.name}`} name={s.name} defaultValue={s.value ?? ""}>
            <option value="">{s.allLabel}</option>
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </NativeSelect>
        </div>
      ))}
      {show("date") && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" name="from" defaultValue={values.from ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" name="to" defaultValue={values.to ?? ""} />
          </div>
        </>
      )}
      {show("department") && departments.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="f-dept">Department</Label>
          <NativeSelect id="f-dept" name="department" defaultValue={values.departmentId ?? ""}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </NativeSelect>
        </div>
      )}
      {show("category") && (
        <div className="space-y-1.5">
          <Label htmlFor="f-cat">Category</Label>
          <NativeSelect id="f-cat" name="category" defaultValue={values.category ?? ""}>
            <option value="">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </NativeSelect>
        </div>
      )}
      {show("status") && (
        <div className="space-y-1.5">
          <Label htmlFor="f-status">Status</Label>
          <NativeSelect id="f-status" name="status" defaultValue={values.status ?? ""}>
            <option value="">All statuses</option>
            {statusOptions.map((c) => <option key={c} value={c}>{label(c)}</option>)}
          </NativeSelect>
        </div>
      )}
      <div className="flex items-end gap-2">
        <Button type="submit" size="sm">Apply</Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`${action}${hidden.report ? `?report=${encodeURIComponent(hidden.report)}` : ""}`}>Reset</Link>
        </Button>
      </div>
    </form>
  );
}

export function describeFilters(values: ReportFilters, departments: Option[]) {
  const parts: string[] = [];
  if (values.from || values.to) parts.push(`Dates: ${values.from ?? "start"} → ${values.to ?? "today"}`);
  if (values.departmentId) parts.push(`Department: ${departments.find((d) => d.value === values.departmentId)?.label ?? "—"}`);
  if (values.category) parts.push(`Category: ${label(values.category)}`);
  if (values.status) parts.push(`Status: ${label(values.status)}`);
  return parts.length ? `Filters — ${parts.join(" · ")}` : "Filters — none";
}
