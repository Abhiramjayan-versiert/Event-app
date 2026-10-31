import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { AccessSummary } from "@/lib/auth/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDateRange } from "@/lib/utils";
import { AnnouncementsCard } from "@/features/announcements/announcements-card";

/** Home for users without college-level access: the events they are assigned to. */
export function MyWorkspace({ access }: { access: AccessSummary }) {
  const firstName = (access.full_name || access.email).split(/\s+/)[0];
  return (
    <div className="space-y-8">
      <PageHeader title={`Welcome, ${firstName}`} description="Your event assignments and roles." />
      <AnnouncementsCard userId={access.user_id} />
      {access.events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No assignments yet"
          description="An administrator has not assigned you to an event yet. You will see your events here as soon as they do."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {access.events.map((e) => (
            <Link key={e.id} href={`/events/${e.id}`} className="group flex flex-col gap-4 rounded-lg border bg-card p-5 transition-colors hover:border-primary">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold group-hover:underline">{e.name}</p>
                  <p className="truncate text-sm text-muted-foreground">{e.college_name}</p>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <p className="text-sm text-muted-foreground">{formatDateRange(e.starts_on, e.ends_on)}</p>
              <div className="flex flex-wrap gap-1.5">
                {e.roles.length === 0 ? (
                  <Badge variant="muted">College access</Badge>
                ) : (
                  e.roles.map((r, i) => (
                    <Badge key={i} variant={r.position === "head" || r.role_key === "event_admin" ? "lime" : "muted"}>
                      {r.role_name}
                      {r.department_name ? ` · ${r.department_name}` : ""}
                    </Badge>
                  ))
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
