"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { emailSurveyInvitesAction, saveSurveyAction, submitSurveyAction } from "./actions";
import { TEMPLATE_QUESTIONS, type Question, type QuestionType, type SurveyInput, type SurveyResults } from "./types";

const TYPE_LABEL: Record<QuestionType, string> = { rating: "Rating 1–5", nps: "Recommend 0–10", choice: "Multiple choice", text: "Written answer" };

export function SurveyEditor({ eventId, surveyId, initial }: { eventId: string; surveyId: string | null; initial?: SurveyInput }) {
  const router = useRouter();
  const [v, setV] = useState<SurveyInput>(initial ?? { title: "Event feedback", intro: "", audience: "participants", status: "draft", questions: TEMPLATE_QUESTIONS });
  const [pending, start] = useTransition();
  const setQ = (i: number, q: Partial<Question>) => setV((s) => ({ ...s, questions: s.questions.map((x, j) => (j === i ? { ...x, ...q } : x)) }));
  const move = (i: number, d: -1 | 1) => setV((s) => {
    const qs = [...s.questions];
    const j = i + d;
    if (j < 0 || j >= qs.length) return s;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    return { ...s, questions: qs };
  });
  const save = () => start(async () => {
    const r = await saveSurveyAction(eventId, surveyId, v);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Saved");
    if (!surveyId) router.push(`/events/${eventId}/feedback/${r.data!.id}`);
    else router.refresh();
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="sv-title">Title</Label><Input id="sv-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="sv-intro">Intro (optional)</Label><Textarea id="sv-intro" rows={2} value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="sv-aud">Who answers</Label>
          <NativeSelect id="sv-aud" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value as SurveyInput["audience"] })}>
            <option value="participants">Participants (personal emailed link, one answer each)</option>
            <option value="anyone">Anyone with the link</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5"><Label htmlFor="sv-status">Status</Label>
          <NativeSelect id="sv-status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as SurveyInput["status"] })}>
            <option value="draft">Draft (not visible)</option><option value="open">Open for responses</option><option value="closed">Closed</option>
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-3">
        {v.questions.map((q, i) => (
          <div key={q.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input className="w-full min-w-0 flex-1 sm:min-w-56" value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} aria-label={`Question ${i + 1}`} />
              <NativeSelect className="w-full sm:w-44" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QuestionType, options: e.target.value === "choice" ? (q.options ?? ["Option 1", "Option 2"]) : undefined })} aria-label="Type">
                {Object.entries(TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
              <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={Boolean(q.required)} onCheckedChange={(c) => setQ(i, { required: c === true })} /> Required</label>
              <Button variant="ghost" size="icon-sm" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="Remove question" disabled={v.questions.length === 1} onClick={() => setV((s) => ({ ...s, questions: s.questions.filter((_, j) => j !== i) }))}><Trash2 /></Button>
            </div>
            {q.type === "choice" ? (
              <Input value={(q.options ?? []).join(", ")} onChange={(e) => setQ(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} placeholder="Options, separated by commas" aria-label="Options" />
            ) : null}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setV((s) => ({ ...s, questions: [...s.questions, { id: `q${Date.now().toString(36)}`, type: "text", label: "" }] }))}><Plus /> Add question</Button>
      </div>
      <Button onClick={save} loading={pending}>{surveyId ? "Save survey" : "Create survey"}</Button>
    </div>
  );
}

export function SurveyShare({ eventId, surveyId, link, audience, open }: { eventId: string; surveyId: string; link: string; audience: string; open: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {audience === "anyone" ? (
        <div className="flex gap-2">
          <Input readOnly value={link} aria-label="Survey link" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Link copied"))}><Copy /></Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">Each confirmed participant gets a personal link by email, so everyone answers only once.</p>}
      <Button variant="outline" size="sm" disabled={!open || pending} onClick={() => start(async () => {
        const r = await emailSurveyInvitesAction(eventId, surveyId);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message ?? "Sent");
        router.refresh();
      })}><Mail /> Email participants who haven&apos;t been invited</Button>
      {!open ? <p className="text-xs text-muted-foreground">Set the status to Open to invite people.</p> : null}
    </div>
  );
}

export function SurveyResultsView({ results }: { results: SurveyResults }) {
  if (!results.responses) return <p className="text-sm text-muted-foreground">No responses yet.</p>;
  return (
    <div className="space-y-4">
      {results.questions.map((q) => (
        <Card key={q.id}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{q.label}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {q.type === "rating" || q.type === "nps" ? (
              <>
                <p><span className="text-2xl font-semibold">{q.result.average ?? "—"}</span> <span className="text-muted-foreground">average · {q.result.count} answers{q.type === "nps" && q.result.nps !== null && q.result.nps !== undefined ? ` · recommendation score ${q.result.nps}` : ""}</span></p>
                <Bars dist={q.result.distribution ?? {}} keys={q.type === "rating" ? ["1", "2", "3", "4", "5"] : Array.from({ length: 11 }, (_, i) => String(i))} />
              </>
            ) : q.type === "choice" ? (
              <Bars dist={q.result.distribution ?? {}} keys={q.options ?? Object.keys(q.result.distribution ?? {})} wide />
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {(q.result.answers ?? []).map((a, i) => <li key={i} className="rounded-md bg-muted/50 px-3 py-2">{a}</li>)}
                {!q.result.answers?.length ? <li className="text-muted-foreground">No written answers.</li> : null}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Bars({ dist, keys, wide }: { dist: Record<string, number>; keys: string[]; wide?: boolean }) {
  const max = Math.max(1, ...keys.map((k) => dist[k] ?? 0));
  return (
    <div className="space-y-1">
      {keys.map((k) => (
        <div key={k} className="flex items-center gap-2 text-xs">
          <span className={cn("shrink-0 text-right text-muted-foreground", wide ? "w-28 truncate" : "w-6")}>{k}</span>
          <div className="h-3 flex-1 rounded bg-muted"><div className="h-3 rounded bg-primary" style={{ width: `${((dist[k] ?? 0) / max) * 100}%` }} /></div>
          <span className="w-6 tabular">{dist[k] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

/** Public answer form. */
export function PublicSurveyForm({ token, ticket, questions, defaultName }: { token: string; ticket: string | null; questions: Question[]; defaultName: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [name, setName] = useState(defaultName);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <p className="rounded-md bg-lime/20 p-4 font-medium">Thank you for your feedback! 🎉</p>;
  return (
    <form className="space-y-6" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await submitSurveyAction(token, ticket, name, answers);
        if (!r.ok) return void toast.error(r.error);
        setDone(true);
      });
    }}>
      {!ticket ? <div className="space-y-1.5"><Label htmlFor="ps-name">Your name (optional)</Label><Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} /></div> : null}
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="font-medium">{q.label}{q.required ? <span className="text-destructive"> *</span> : null}</legend>
          {q.type === "rating" || q.type === "nps" ? (
            <div className="flex flex-wrap gap-1.5">
              {(q.type === "rating" ? [1, 2, 3, 4, 5] : Array.from({ length: 11 }, (_, i) => i)).map((n) => (
                <button key={n} type="button" aria-pressed={answers[q.id] === String(n)} onClick={() => setAnswers((a) => ({ ...a, [q.id]: String(n) }))}
                  className={cn("size-10 rounded-md border text-sm font-medium transition-colors", answers[q.id] === String(n) ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary")}>
                  {n}
                </button>
              ))}
              {q.type === "nps" ? <p className="w-full text-xs text-muted-foreground">0 = not at all likely · 10 = extremely likely</p> : null}
            </div>
          ) : q.type === "choice" ? (
            <div className="space-y-1.5">
              {(q.options ?? []).map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={q.id} value={o} checked={answers[q.id] === o} onChange={() => setAnswers((a) => ({ ...a, [q.id]: o }))} className="accent-[var(--primary)]" /> {o}
                </label>
              ))}
            </div>
          ) : (
            <Textarea rows={3} maxLength={2000} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} aria-label={q.label} />
          )}
        </fieldset>
      ))}
      <Button type="submit" className="w-full" loading={pending}>Submit feedback</Button>
    </form>
  );
}
