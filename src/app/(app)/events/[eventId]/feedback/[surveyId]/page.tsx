import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { publicEnv } from "@/lib/env";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SurveyEditor, SurveyResultsView, SurveyShare } from "@/features/surveys/survey-ui";
import type { Question, SurveyInput, SurveyResults } from "@/features/surveys/types";

export const metadata = { title: "Survey" };

export default async function SurveyPage({ params }: { params: Promise<{ eventId: string; surveyId: string }> }) {
  const { eventId, surveyId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(surveyId)) notFound();
  const { event, permissions } = await getEventContext(eventId);
  if (!(can(permissions, "event.manage") || can(permissions, "registrations.manage"))) notFound();
  const supabase = await createClient();
  const { data: s } = await supabase.from("surveys").select("*").eq("id", surveyId).eq("event_id", eventId).maybeSingle();
  if (!s) notFound();
  const { data: results } = await supabase.rpc("survey_results", { p_survey: surveyId });
  const initial: SurveyInput = { title: s.title, intro: s.intro ?? "", audience: s.audience as SurveyInput["audience"], status: s.status as SurveyInput["status"], questions: s.questions as unknown as Question[] };
  const r = results as unknown as SurveyResults;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link href={`/events/${eventId}/feedback`} className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Feedback · {event.name}</Link>}
        title={s.title}
        description={`${r?.responses ?? 0} response${r?.responses === 1 ? "" : "s"}`}
      />
      <Card>
        <CardHeader><CardTitle>Share</CardTitle></CardHeader>
        <CardContent><SurveyShare eventId={eventId} surveyId={surveyId} link={`${publicEnv.appUrl}/s/${s.public_token}`} audience={s.audience} open={s.status === "open"} /></CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-3"><h2 className="text-lg font-semibold">Results</h2>{r ? <SurveyResultsView results={r} /> : null}</section>
        <Card><CardHeader><CardTitle>Edit survey</CardTitle></CardHeader><CardContent><SurveyEditor eventId={eventId} surveyId={surveyId} initial={initial} /></CardContent></Card>
      </div>
    </div>
  );
}
