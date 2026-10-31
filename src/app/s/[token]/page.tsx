import { notFound } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { PublicSurveyForm } from "@/features/surveys/survey-ui";
import type { Question } from "@/features/surveys/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Feedback", robots: { index: false, follow: false } };

type PublicSurvey = {
  id: string; title: string; intro: string | null; audience: string; questions: Question[]; status: string;
  event: { name: string; college: string }; respondent: { name: string; answered: boolean } | null;
};

export default async function PublicSurveyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ t?: string }> }) {
  const { token } = await params;
  const { t } = await searchParams;
  if (!/^[0-9a-f]{24}$/.test(token)) notFound();
  const ticket = t && /^[0-9a-f]{16}$/i.test(t) ? t : null;
  const { data } = await createAdminClient().rpc("public_survey", { p_token: token, p_ticket: (ticket ?? null) as unknown as string });
  const s = data as PublicSurvey | null;
  if (!s) notFound();
  const blocked =
    s.status !== "open" ? "This survey is closed. Thank you!"
    : s.audience === "participants" && !s.respondent ? "Please open the personal link from your email to answer."
    : s.respondent?.answered ? "You have already answered this survey. Thank you!" : null;
  return (
    <main className="mx-auto min-h-screen max-w-xl space-y-6 px-4 py-10">
      <Logo />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{s.event.college} · {s.event.name}</p>
        <h1 className="text-2xl font-bold">{s.title}</h1>
        {s.intro ? <p className="whitespace-pre-line text-muted-foreground">{s.intro}</p> : null}
        {s.respondent && !blocked ? <p className="text-sm">Hi {s.respondent.name}!</p> : null}
      </div>
      {blocked ? <p className="rounded-md border bg-card p-4">{blocked}</p> : <PublicSurveyForm token={token} ticket={ticket} questions={s.questions} defaultName="" />}
    </main>
  );
}
