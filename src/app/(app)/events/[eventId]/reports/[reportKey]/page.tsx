import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { canAnywhere } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { getReport, parseFilters, reportsFor, runReport } from "@/features/reports/definitions";
import { ReportFilterForm, describeFilters } from "@/features/reports/report-filters";
import { ReportView } from "@/features/reports/report-view";

export async function generateMetadata({ params }: { params: Promise<{ reportKey: string }> }) {
  const { reportKey } = await params;
  return { title: getReport(reportKey)?.title ?? "Report" };
}

export default async function EventReportPage({
  params, searchParams,
}: {
  params: Promise<{ eventId: string; reportKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventId, reportKey } = await params;
  const { event, permissions } = await getEventContext(eventId);
  const def = reportsFor(permissions).find((r) => r.key === reportKey);
  if (!def) notFound();
  const filters = parseFilters(await searchParams);
  const supabase = await createClient();

  let report;
  try {
    report = await runReport(def, supabase, [
      { id: event.id, name: event.name, currency: event.currency, timezone: event.timezone, status: event.status, starts_on: event.starts_on, ends_on: event.ends_on },
    ], filters);
  } catch (e) {
    return <ErrorState title="Could not build the report" message={e instanceof Error ? e.message : "Unknown error"} />;
  }

  const { data: depts } = await supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order").order("name");
  const departments = (depts ?? []).map((d) => ({ value: d.id, label: d.name }));
  const scope = `${event.name} · ${event.college?.name ?? ""}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link href={`/events/${eventId}/reports`} className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Reports</Link>}
        title={report.title}
        description={report.description}
        actions={def.key === "closing" ? <Button asChild variant="outline"><Link href={`/events/${eventId}/closing`}>Event closing</Link></Button> : null}
      />
      <ReportFilterForm
        action={`/events/${eventId}/reports/${def.key}`}
        kinds={def.filters}
        values={filters}
        departments={departments}
        categoryOptions={report.categoryOptions}
        statusOptions={report.statusOptions}
      />
      <ReportView report={report} scope={scope} filterLabel={describeFilters(filters, departments)} canExport={canAnywhere(permissions, "reports.export")} />
    </div>
  );
}
