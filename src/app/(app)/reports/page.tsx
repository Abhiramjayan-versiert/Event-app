import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { canSeeGlobalDashboard } from "@/lib/auth/types";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { REPORTS, getReport, parseFilters, runReport, type ReportEvent } from "@/features/reports/definitions";
import { ReportFilterForm, describeFilters } from "@/features/reports/report-filters";
import { ReportView } from "@/features/reports/report-view";

export const metadata = { title: "Reports" };

const MAX_EVENTS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cross-event reports. Super Admins see every college; College Admins see the
 * colleges they administer. RLS still applies to every query.
 */
export default async function GlobalReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAccess();
  if (!canSeeGlobalDashboard(access)) redirect("/dashboard");
  const sp = await searchParams;
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const def = getReport(pick("report") ?? "event-summary") ?? REPORTS[0];
  const filters = parseFilters(sp);
  const supabase = await createClient();

  const adminCollegeIds = access.is_super_admin ? null : access.colleges.filter((c) => c.roles.includes("college_admin")).map((c) => c.id);
  let collegesQ = supabase.from("colleges").select("id, name").order("name");
  if (adminCollegeIds) collegesQ = collegesQ.in("id", adminCollegeIds);
  const { data: colleges } = await collegesQ;

  const collegeParam = pick("college");
  const collegeId = collegeParam && UUID_RE.test(collegeParam) && (colleges ?? []).some((c) => c.id === collegeParam) ? collegeParam : undefined;
  let eventsQ = supabase
    .from("events")
    .select("id, name, currency, timezone, status, starts_on, ends_on, college_id")
    .order("starts_on", { ascending: false })
    .limit(MAX_EVENTS + 1);
  if (collegeId) eventsQ = eventsQ.eq("college_id", collegeId);
  else if (adminCollegeIds) eventsQ = eventsQ.in("college_id", adminCollegeIds.length ? adminCollegeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: eventRows, error } = await eventsQ;
  if (error) return <ErrorState title="Could not load events" message={error.message} />;
  const allEvents = (eventRows ?? []).slice(0, MAX_EVENTS);

  const eventParam = pick("event");
  const selected = eventParam ? allEvents.filter((e) => e.id === eventParam) : allEvents;
  const singleEvent = selected.length === 1 && Boolean(eventParam);
  // Department filters only make sense inside one event.
  const kinds = def.filters.filter((k) => k !== "department" || singleEvent);
  const effective = { ...filters, departmentId: singleEvent ? filters.departmentId : undefined };

  const currencies = new Set(selected.map((e) => e.currency));
  const scoped: ReportEvent[] = selected.map((e) => ({ id: e.id, name: e.name, currency: e.currency, timezone: e.timezone, status: e.status, starts_on: e.starts_on, ends_on: e.ends_on }));

  let report;
  try {
    report = await runReport(def, supabase, scoped, effective);
  } catch (e) {
    return <ErrorState title="Could not build the report" message={e instanceof Error ? e.message : "Unknown error"} />;
  }
  if (currencies.size > 1) report.notes.push("Events use different currencies; totals mix currencies. Filter by event for exact figures.");
  if ((eventRows ?? []).length > MAX_EVENTS) report.notes.push(`Only the ${MAX_EVENTS} most recent events are included. Filter by college.`);

  let departments: { value: string; label: string }[] = [];
  if (singleEvent) {
    const { data } = await supabase.from("departments").select("id, name").eq("event_id", selected[0].id).eq("status", "active").order("sort_order");
    departments = (data ?? []).map((d) => ({ value: d.id, label: d.name }));
  }
  const collegeName = collegeId ? colleges?.find((c) => c.id === collegeId)?.name : access.is_super_admin ? "All colleges" : "Your colleges";
  const scope = singleEvent ? `${selected[0].name} · ${collegeName}` : `${collegeName} · ${selected.length} event${selected.length === 1 ? "" : "s"}`;
  const keep = (key: string) => {
    const q = new URLSearchParams({ report: key });
    if (collegeId) q.set("college", collegeId);
    if (eventParam) q.set("event", eventParam);
    return `/reports?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description={access.is_super_admin ? "Reports across every college and event." : "Reports for the colleges you administer."} />
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Reports">
        {REPORTS.map((r) => (
          <Link
            key={r.key}
            href={keep(r.key)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
              r.key === def.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {r.title.replace(/ report$/, "")}
          </Link>
        ))}
      </nav>
      <ReportFilterForm
        action="/reports"
        hidden={{ report: def.key }}
        kinds={kinds}
        values={effective}
        departments={departments}
        categoryOptions={report.categoryOptions}
        statusOptions={report.statusOptions}
        scopeSelects={[
          { name: "college", label: "College", value: collegeId, allLabel: access.is_super_admin ? "All colleges" : "All my colleges", options: (colleges ?? []).map((c) => ({ value: c.id, label: c.name })) },
          { name: "event", label: "Event", value: eventParam, allLabel: "All events", options: allEvents.map((e) => ({ value: e.id, label: e.name })) },
        ]}
      />
      {allEvents.length === 0 ? (
        <EmptyState icon={BarChart3} title="No events yet" description="Reports appear once events exist." />
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">{report.title}</h2>
            <p className="text-sm text-muted-foreground">{report.description}</p>
          </div>
          <ReportView report={report} scope={scope} filterLabel={describeFilters(effective, departments)} canExport />
        </>
      )}
    </div>
  );
}
