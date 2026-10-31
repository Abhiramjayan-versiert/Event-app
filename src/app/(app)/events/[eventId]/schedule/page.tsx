import { format, parseISO } from "date-fns";
import { Clock, MapPin, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can, canAnywhere } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { DeleteRecordButton, RecordDialog } from "@/features/records/record-dialog";
import { getOptionSets } from "@/features/records/options";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Schedule" };

const STATUS_VARIANT: Record<string, "lime" | "success" | "warning" | "destructive" | "outline"> = {
  scheduled: "outline", in_progress: "lime", completed: "success", delayed: "warning", cancelled: "destructive",
};

export default async function SchedulePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  const canManage = can(permissions, "operations.manage");
  const canAdd = canManage || canAnywhere(permissions, "operations.update");
  const supabase = await createClient();
  const [items, options] = await Promise.all([
    supabase.from("event_schedules").select("*, venue:venues(name), department:departments(name), competition:event_competitions(name)").eq("event_id", eventId).order("starts_at"),
    getOptionSets(eventId),
  ]);
  const tz = event.timezone || "Asia/Kolkata";
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const groups = new Map<string, NonNullable<typeof items.data>>();
  for (const i of items.data ?? []) groups.set(dayKey(i.starts_at), [...(groups.get(dayKey(i.starts_at)) ?? []), i]);

  return (
    <div className="space-y-6">
      <RealtimeRefresh eventId={eventId} tables={["event_schedules"]} />
      <PageHeader
        title="Event-day master schedule"
        description={`Every session, competition and logistics slot with time, place, team and live status. Times in ${tz}.`}
        actions={canAdd ? <RecordDialog kind="schedule_item" eventId={eventId} options={options} trigger={<Button><Plus /> Schedule item</Button>} /> : null}
      />
      {groups.size === 0 ? (
        <EmptyState icon={Clock} title="Nothing scheduled yet" description="Add sessions, competitions, ceremonies and logistics slots. Items marked public are shared with the event website." />
      ) : (
        [...groups.entries()].map(([day, list]) => (
          <section key={day} className="space-y-2">
            <h2 className="sticky top-14 z-10 bg-background/95 py-2 text-sm font-semibold backdrop-blur">{format(parseISO(day), "EEEE, d MMMM yyyy")}</h2>
            <ol className="divide-y rounded-lg border bg-card">
              {list.map((i) => (
                <li key={i.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                  <div className="w-36 shrink-0 font-mono text-sm tabular">{time(i.starts_at)}{i.ends_at ? ` – ${time(i.ends_at)}` : ""}</div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {i.title}
                      <Badge variant={STATUS_VARIANT[i.status] ?? "outline"}>{titleCase(i.status)}</Badge>
                      <Badge variant="muted">{titleCase(i.item_type)}</Badge>
                      {i.is_public ? <Badge variant="lime">Public</Badge> : null}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {i.venue?.name || i.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{i.venue?.name ?? i.location}</span> : null}
                      {i.department?.name ? <span>{i.department.name}</span> : null}
                      {i.assigned_team ? <span>Team: {i.assigned_team}</span> : null}
                      {i.competition?.name ? <span>Competition: {i.competition.name}</span> : null}
                    </p>
                    {i.description ? <p className="text-sm text-muted-foreground">{i.description}</p> : null}
                  </div>
                  {canAdd ? (
                    <div className="flex gap-1">
                      <RecordDialog kind="schedule_item" eventId={eventId} id={i.id} defaults={i} options={options} trigger={<Button variant="ghost" size="sm"><Pencil /> Update</Button>} />
                      {canManage ? <DeleteRecordButton kind="schedule_item" eventId={eventId} id={i.id} label={i.title} /> : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}
