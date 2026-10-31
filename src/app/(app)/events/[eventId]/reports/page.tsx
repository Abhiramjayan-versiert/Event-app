import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getEventContext } from "@/lib/auth/session";
import { can, canAnywhere } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { reportsFor } from "@/features/reports/definitions";

export const metadata = { title: "Reports" };

export default async function ReportsIndexPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  const reports = reportsFor(permissions);
  if (!reports.length) notFound();
  const showClosing = can(permissions, "event.close") || can(permissions, "finance.view");
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event.name}
        title="Reports"
        description={
          canAnywhere(permissions, "reports.export")
            ? "Open a report to filter it and export CSV, Excel or PDF."
            : "Open a report to filter it. Exporting needs the “Export reports” permission."
        }
        actions={showClosing ? <Button asChild variant="outline"><Link href={`/events/${eventId}/closing`}>Event closing</Link></Button> : null}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <Link
            key={r.key}
            href={`/events/${eventId}/reports/${r.key}`}
            className="group flex flex-col justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary"
          >
            <div className="space-y-1">
              <p className="font-medium group-hover:underline">{r.title}</p>
              <p className="text-sm text-muted-foreground">{r.description}</p>
            </div>
            <ArrowRight className="size-4 self-end text-muted-foreground group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}
