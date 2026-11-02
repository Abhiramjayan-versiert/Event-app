"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Trophy } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { publishResultsAction, saveJudgingSetupAction, submitScoresAction, unpublishResultsAction } from "./actions";

export type Sheet = {
  competition: { id: string; name: string; code: string; event_id: string; results_published_at: string | null };
  can_manage: boolean;
  is_judge: boolean;
  criteria: { id: string; name: string; max_score: number; weight: number }[];
  judges: { user_id: string; name: string; email: string }[];
  entrants: { registration_id: string; registration_number: string; name: string; college: string | null; checked_in: boolean }[];
  my_scores: { registration_id: string; criterion_id: string; score: number; comment: string | null }[];
};
export type BoardRow = {
  registration_id: string; registration_number: string; name: string; college: string | null; checked_in: boolean;
  total: number | null; judges_scored: number; judges_total: number; position: number | null; title: string | null;
};

const TITLES = ["Winner", "Runner-up", "Second runner-up"];

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      onOk?.();
      router.refresh();
    });
  return { pending, run };
}

export function JudgingWorkspace({ eventId, sheet, board, people }: { eventId: string; sheet: Sheet; board: BoardRow[]; people: { id: string; name: string; email: string }[] }) {
  const tabs = [
    ...(sheet.is_judge ? [{ key: "score", label: "Score entrants" }] : []),
    ...(sheet.can_manage ? [{ key: "board", label: "Leaderboard & results" }, { key: "setup", label: "Setup" }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.key ?? "score");
  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <nav className="flex gap-1 border-b" aria-label="Judging sections">
          {tabs.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === t.key ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </nav>
      )}
      {tab === "score" && sheet.is_judge && <ScoreSheet eventId={eventId} sheet={sheet} />}
      {tab === "board" && sheet.can_manage && <Leaderboard eventId={eventId} sheet={sheet} board={board} />}
      {tab === "setup" && sheet.can_manage && <Setup eventId={eventId} sheet={sheet} people={people} />}
    </div>
  );
}

function ScoreSheet({ eventId, sheet }: { eventId: string; sheet: Sheet }) {
  const locked = Boolean(sheet.competition.results_published_at);
  const scored = new Set(sheet.my_scores.map((s) => s.registration_id));
  const [current, setCurrent] = useState<string | null>(sheet.entrants.find((e) => !scored.has(e.registration_id))?.registration_id ?? sheet.entrants[0]?.registration_id ?? null);
  if (!sheet.criteria.length) return <p className="text-sm text-muted-foreground">The organisers haven't set the scoring criteria yet.</p>;
  if (!sheet.entrants.length) return <p className="text-sm text-muted-foreground">No confirmed entrants yet.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border p-2">
        {sheet.entrants.map((e) => (
          <li key={e.registration_id}>
            <button type="button" onClick={() => setCurrent(e.registration_id)}
              className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm", current === e.registration_id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              <span className="min-w-0 truncate">{e.name}</span>
              {scored.has(e.registration_id) ? <Badge variant="muted">scored</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      {current ? <ScoreForm key={current} eventId={eventId} sheet={sheet} registrationId={current} locked={locked} /> : null}
    </div>
  );
}

function ScoreForm({ eventId, sheet, registrationId, locked }: { eventId: string; sheet: Sheet; registrationId: string; locked: boolean }) {
  const entrant = sheet.entrants.find((e) => e.registration_id === registrationId)!;
  const mine = sheet.my_scores.filter((s) => s.registration_id === registrationId);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(sheet.criteria.map((c) => [c.id, mine.find((s) => s.criterion_id === c.id)?.score?.toString() ?? ""])));
  const [comment, setComment] = useState(mine[0]?.comment ?? "");
  const { pending, run } = useRun();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entrant.name}</CardTitle>
        <CardDescription>{[entrant.registration_number, entrant.college, entrant.checked_in ? "checked in" : "not checked in"].filter(Boolean).join(" · ")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const scores = sheet.criteria.map((c) => ({ criterion_id: c.id, score: values[c.id] === "" ? null : Number(values[c.id]) }));
          run(() => submitScoresAction(eventId, sheet.competition.id, registrationId, scores, comment));
        }}>
          {sheet.criteria.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4">
              <Label htmlFor={`s-${c.id}`} className="flex-1">{c.name} <span className="text-muted-foreground">(out of {Number(c.max_score)})</span></Label>
              <Input id={`s-${c.id}`} type="number" inputMode="decimal" min={0} max={Number(c.max_score)} step="0.5" className="w-24 text-right"
                value={values[c.id]} disabled={locked} onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="s-comment">Comment (optional)</Label>
            <Textarea id="s-comment" rows={2} maxLength={1000} value={comment} disabled={locked} onChange={(e) => setComment(e.target.value)} />
          </div>
          {locked ? <p className="text-sm text-muted-foreground">Results are published; scores are locked.</p> : <Button type="submit" loading={pending}>Save scores</Button>}
        </form>
      </CardContent>
    </Card>
  );
}

function Leaderboard({ eventId, sheet, board }: { eventId: string; sheet: Sheet; board: BoardRow[] }) {
  const published = Boolean(sheet.competition.results_published_at);
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(board.map((b, i) => [b.registration_id, b.title ?? (i < 3 && (b.total ?? 0) > 0 ? TITLES[i] : "")])),
  );
  const { pending, run } = useRun();
  const winners = useMemo(() => board.filter((b) => picks[b.registration_id]).map((b, i) => ({ registration_id: b.registration_id, position: i + 1, title: picks[b.registration_id] })), [board, picks]);
  if (!board.length) return <p className="text-sm text-muted-foreground">Set up criteria and wait for confirmed entrants to see the leaderboard.</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Score = weighted average of all judges, as a percentage. Pick the winners and publish; scores lock and results appear on the public event page and certificates.</p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Entrant</TableHead><TableHead className="text-right">Score</TableHead><TableHead>Judged</TableHead><TableHead>Award</TableHead></TableRow></TableHeader>
          <TableBody>
            {board.map((b, i) => (
              <TableRow key={b.registration_id}>
                <TableCell className="tabular">{i + 1}</TableCell>
                <TableCell><p className="font-medium">{b.name}</p><p className="text-xs text-muted-foreground">{b.registration_number}{b.college ? ` · ${b.college}` : ""}</p></TableCell>
                <TableCell className="tabular text-right font-semibold">{b.total === null ? "—" : `${Number(b.total).toFixed(1)}%`}</TableCell>
                <TableCell className={cn("tabular text-sm", b.judges_scored < b.judges_total && "text-amber-600")}>{b.judges_scored}/{b.judges_total}</TableCell>
                <TableCell>
                  <NativeSelect className="h-8 w-44 text-xs" value={picks[b.registration_id] ?? ""} disabled={published}
                    onChange={(e) => setPicks((p) => ({ ...p, [b.registration_id]: e.target.value }))} aria-label={`Award for ${b.name}`}>
                    <option value="">—</option>
                    {[...TITLES, "Special mention", "Best performance"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {published ? (
        <Button variant="outline" loading={pending} onClick={() => run(() => unpublishResultsAction(eventId, sheet.competition.id))}>Unpublish results</Button>
      ) : (
        <Button loading={pending} disabled={!winners.length} onClick={() => {
          if (!confirm(`Publish ${winners.length} award(s) for ${sheet.competition.name}? Scores will lock.`)) return;
          run(() => publishResultsAction(eventId, sheet.competition.id, winners));
        }}><Trophy /> Publish results</Button>
      )}
    </div>
  );
}

function Setup({ eventId, sheet, people }: { eventId: string; sheet: Sheet; people: { id: string; name: string; email: string }[] }) {
  const locked = Boolean(sheet.competition.results_published_at);
  const [criteria, setCriteria] = useState(sheet.criteria.length
    ? sheet.criteria.map((c) => ({ id: c.id, name: c.name, max_score: String(c.max_score), weight: String(c.weight) }))
    : [{ id: "", name: "Content", max_score: "10", weight: "1" }, { id: "", name: "Presentation", max_score: "10", weight: "1" }]);
  const [judges, setJudges] = useState<string[]>(sheet.judges.map((j) => j.user_id));
  const [pick, setPick] = useState("");
  const { pending, run } = useRun();
  const known = new Map([...people.map((p) => [p.id, p] as const), ...sheet.judges.map((j) => [j.user_id, { id: j.user_id, name: j.name, email: j.email }] as const)]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Criteria</CardTitle><CardDescription>Each criterion has a maximum score and a weight (how much it counts).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {criteria.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_4.5rem_auto] items-end gap-2 max-sm:grid-cols-[1fr_1fr_auto] max-sm:[&>*:first-child]:col-span-3">
              <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={c.name} disabled={locked} onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></div>
              <div className="space-y-1"><Label className="text-xs">Max</Label><Input type="number" min={1} value={c.max_score} disabled={locked} onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? { ...x, max_score: e.target.value } : x)))} /></div>
              <div className="space-y-1"><Label className="text-xs">Weight</Label><Input type="number" min={0.5} step="0.5" value={c.weight} disabled={locked} onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))} /></div>
              <Button variant="ghost" size="icon" aria-label="Remove criterion" disabled={locked || criteria.length === 1} onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={locked} onClick={() => setCriteria((cs) => [...cs, { id: "", name: "", max_score: "10", weight: "1" }])}><Plus /> Add criterion</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Judges</CardTitle><CardDescription>Judges must have access to this event (for an outside judge, add them to the event as a Viewer first).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {judges.length === 0 ? <p className="text-sm text-muted-foreground">No judges yet.</p> : (
            <ul className="divide-y text-sm">
              {judges.map((id) => (
                <li key={id} className="flex items-center justify-between py-2">
                  <span>{known.get(id)?.name || known.get(id)?.email || "User"}</span>
                  <Button variant="ghost" size="sm" disabled={locked} onClick={() => setJudges((js) => js.filter((x) => x !== id))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add judge" disabled={locked}>
              <option value="">Choose a person…</option>
              {people.filter((p) => !judges.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name || p.email} — {p.email}</option>)}
            </NativeSelect>
            <Button variant="outline" disabled={!pick || locked} onClick={() => { setJudges((js) => [...js, pick]); setPick(""); }}>Add</Button>
          </div>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <Button loading={pending} disabled={locked} onClick={() => run(() => saveJudgingSetupAction(eventId, sheet.competition.id,
          criteria.map((c) => ({ id: c.id, name: c.name, max_score: Number(c.max_score), weight: Number(c.weight) })), judges))}>
          Save setup
        </Button>
        {locked ? <span className="ml-3 text-sm text-muted-foreground">Unpublish results to change the setup.</span> : null}
      </div>
    </div>
  );
}
