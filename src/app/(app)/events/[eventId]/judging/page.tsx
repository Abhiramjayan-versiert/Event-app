import Link from "next/link";
import { Gavel } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { canAnywhere } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Judging" };

export default async function JudgingIndexPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  const supabase = await createClient();
  const [{ data: comps }, { data: judges }, { data: criteria }] = await Promise.all([
    supabase.from("event_competitions").select("id, name, code, results_published_at, department_id").eq("event_id", eventId).eq("is_active", true).order("name"),
    supabase.from("competition_judges").select("competition_id, user_id").eq("event_id", eventId),
    supabase.from("judging_criteria").select("competition_id").eq("event_id", eventId),
  ]);
  const manager = canAnywhere(permissions, "judging.manage") || canAnywhere(permissions, "department.manage");
  const mine = new Set((judges ?? []).filter((j) => j.user_id === access.user_id).map((j) => j.competition_id));
  const list = (comps ?? []).filter((c) => manager || mine.has(c.id));
  const count = (rows: { competition_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.competition_id === id).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event.name}
        title="Judging"
        description={manager ? "Set criteria, appoint judges, follow the leaderboard and publish winners." : "Competitions you are judging."}
      />
      {list.length === 0 ? (
        <EmptyState
          icon={Gavel}
          title={manager ? "No competitions yet" : "You are not judging any competition"}
          description={manager ? "Add competitions under Registrations first." : "Organisers appoint judges from this page; you'll get a notification."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const nCrit = count(criteria, c.id);
            const nJudges = count(judges, c.id);
            const state = c.results_published_at ? { label: "Results published", v: "lime" as const }
              : nCrit && nJudges ? { label: "Scoring open", v: "outline" as const } : { label: "Needs setup", v: "muted" as const };
            return (
              <Link key={c.id} href={`/events/${eventId}/judging/${c.id}`} className="group space-y-2 rounded-lg border bg-card p-4 transition-colors hover:border-primary">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium group-hover:underline">{c.name}</p>
                  <Badge variant={state.v}>{state.label}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{c.code} · {nCrit} criteria · {nJudges} judge{nJudges === 1 ? "" : "s"}{mine.has(c.id) ? " · you judge this" : ""}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
