import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getAssignablePeople } from "@/features/departments/queries";
import { JudgingWorkspace, type Sheet, type BoardRow } from "@/features/judging/judging-ui";

export const metadata = { title: "Judging" };

export default async function CompetitionJudgingPage({ params }: { params: Promise<{ eventId: string; competitionId: string }> }) {
  const { eventId, competitionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(competitionId)) notFound();
  const { event } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("judging_sheet", { p_competition: competitionId });
  if (error || !data) notFound();
  const sheet = data as unknown as Sheet;
  if (sheet.competition.event_id !== eventId) notFound();
  const [board, people] = sheet.can_manage
    ? await Promise.all([supabase.rpc("competition_leaderboard", { p_competition: competitionId }), getAssignablePeople()])
    : [null, []];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link href={`/events/${eventId}/judging`} className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Judging · {event.name}</Link>}
        title={sheet.competition.name}
        description={`${sheet.entrants.length} confirmed entrant${sheet.entrants.length === 1 ? "" : "s"} · ${sheet.criteria.length} criteria · ${sheet.judges.length} judge${sheet.judges.length === 1 ? "" : "s"}`}
        actions={sheet.competition.results_published_at ? <Badge variant="lime">Results published</Badge> : null}
      />
      <JudgingWorkspace eventId={eventId} sheet={sheet} board={(board?.data as unknown as BoardRow[] | null) ?? []} people={people} />
    </div>
  );
}
