import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SurveyEditor } from "@/features/surveys/survey-ui";

export const metadata = { title: "Feedback" };

export default async function FeedbackPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  const canManage = can(permissions, "event.manage") || can(permissions, "registrations.manage");
  const supabase = await createClient();
  const { data: surveys } = await supabase.from("surveys").select("id, title, status, audience, created_at").eq("event_id", eventId).order("created_at", { ascending: false });
  const counts = canManage && surveys?.length
    ? (await supabase.from("survey_responses").select("survey_id").in("survey_id", surveys.map((s) => s.id))).data ?? []
    : [];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={event.name} title="Feedback" description="Surveys for participants and guests, with results and a recommendation score." />
      {(surveys ?? []).length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {surveys!.map((s) => (
            <Link key={s.id} href={`/events/${eventId}/feedback/${s.id}`} className="space-y-1 rounded-lg border bg-card p-4 hover:border-primary">
              <div className="flex items-center justify-between gap-2"><p className="font-medium">{s.title}</p><Badge variant={s.status === "open" ? "lime" : "muted"}>{s.status}</Badge></div>
              <p className="text-xs text-muted-foreground">{s.audience === "participants" ? "Participants" : "Anyone with the link"}{canManage ? ` · ${counts.filter((c) => c.survey_id === s.id).length} responses` : ""}</p>
            </Link>
          ))}
        </div>
      ) : <p className="text-sm text-muted-foreground">No surveys yet.</p>}
      {canManage ? (
        <Card>
          <CardHeader><CardTitle>New survey</CardTitle></CardHeader>
          <CardContent><SurveyEditor eventId={eventId} surveyId={null} /></CardContent>
        </Card>
      ) : null}
    </div>
  );
}
