"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, MapPin, Trash2, UserPlus, X } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { assignDutyAction, markDutyAction, removeShiftAction, saveShiftAction, unassignDutyAction } from "./actions";

export type Assignment = { id: string; user_id: string; name: string; status: "assigned" | "present" | "absent" };
export type Shift = {
  id: string; title: string; location: string | null; department_id: string | null; department: string | null;
  starts_at: string; ends_at: string; needed: number; notes: string | null; assignments: Assignment[]; canManage: boolean;
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Saved");
    onOk?.();
    router.refresh();
  });
  return { pending, run };
}

const time = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const day = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });

const localInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ShiftDialog({ eventId, departments, shift, trigger }: { eventId: string; departments: { id: string; name: string }[]; shift?: Shift; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    title: shift?.title ?? "", location: shift?.location ?? "", department_id: shift?.department_id ?? "",
    starts_at: localInput(shift?.starts_at), ends_at: localInput(shift?.ends_at), needed: String(shift?.needed ?? 2), notes: shift?.notes ?? "",
  });
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{shift ? "Edit shift" : "New shift"}</DialogTitle></DialogHeader>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          if (!v.starts_at || !v.ends_at) return void toast.error("Choose start and end times.");
          run(() => saveShiftAction(eventId, shift?.id ?? null, {
            ...v, needed: Number(v.needed), starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
          }), () => setOpen(false));
        }}>
          <div className="space-y-1.5"><Label htmlFor="sh-title">Duty</Label><Input id="sh-title" placeholder="Registration desk" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="sh-loc">Place</Label><Input id="sh-loc" placeholder="Main gate" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="sh-dept">Department</Label>
              <NativeSelect id="sh-dept" value={v.department_id} onChange={(e) => setV({ ...v, department_id: e.target.value })}>
                <option value="">Event-wide</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5"><Label htmlFor="sh-start">Starts</Label><Input id="sh-start" type="datetime-local" value={v.starts_at} onChange={(e) => setV({ ...v, starts_at: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label htmlFor="sh-end">Ends</Label><Input id="sh-end" type="datetime-local" value={v.ends_at} onChange={(e) => setV({ ...v, ends_at: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label htmlFor="sh-need">People needed</Label><Input id="sh-need" type="number" min={1} max={500} value={v.needed} onChange={(e) => setV({ ...v, needed: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="sh-notes">Notes</Label><Input id="sh-notes" placeholder="Bring ID card; report to the lead" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></div>
          <DialogFooter><Button type="submit" loading={pending}>Save shift</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MyDuties({ eventId, duties, tz }: { eventId: string; duties: { assignment: Assignment; shift: Shift }[]; tz: string }) {
  const { pending, run } = useRun();
  if (!duties.length) return null;
  const now = Date.now();
  return (
    <div className="space-y-2 rounded-lg border border-primary/60 bg-card p-4">
      <p className="font-semibold">My duties</p>
      <ul className="space-y-2">
        {duties.map(({ assignment: a, shift: s }) => {
          const open = now >= new Date(s.starts_at).getTime() - 30 * 60000 && now <= new Date(s.ends_at).getTime();
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="font-medium">{s.title}</span> · {day(s.starts_at, tz)}, {time(s.starts_at, tz)}–{time(s.ends_at, tz)}{s.location ? ` · ${s.location}` : ""}</span>
              {a.status === "present" ? <Badge variant="lime">Checked in</Badge>
                : a.status === "absent" ? <Badge variant="destructive">Marked absent</Badge>
                : open ? <Button size="sm" disabled={pending} onClick={() => run(() => markDutyAction(eventId, a.id, "present"))}><Check /> I&apos;m here</Button>
                : <Badge variant="muted">Upcoming</Badge>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ShiftCard({ eventId, shift, people, departments, tz }: { eventId: string; shift: Shift; people: { id: string; name: string; email: string }[]; departments: { id: string; name: string }[]; tz: string }) {
  const [pick, setPick] = useState("");
  const { pending, run } = useRun();
  const filled = shift.assignments.length;
  const assigned = new Set(shift.assignments.map((a) => a.user_id));
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{shift.title}</p>
          <p className="text-xs text-muted-foreground">
            {time(shift.starts_at, tz)}–{time(shift.ends_at, tz)}{shift.location ? <> · <MapPin className="inline size-3" /> {shift.location}</> : null}{shift.department ? ` · ${shift.department}` : ""}
          </p>
          {shift.notes ? <p className="mt-1 text-xs">{shift.notes}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <Badge variant={filled >= shift.needed ? "lime" : "outline"}>{filled}/{shift.needed}</Badge>
          {shift.canManage ? (
            <>
              <ShiftDialog eventId={eventId} departments={departments} shift={shift} trigger={<Button variant="ghost" size="sm">Edit</Button>} />
              <Button variant="ghost" size="icon" aria-label="Remove shift" disabled={pending} onClick={() => { if (confirm(`Remove the ${shift.title} shift?`)) run(() => removeShiftAction(eventId, shift.id)); }}><Trash2 /></Button>
            </>
          ) : null}
        </div>
      </div>
      {shift.assignments.length ? (
        <ul className="divide-y text-sm">
          {shift.assignments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className={cn(a.status === "absent" && "text-muted-foreground line-through")}>{a.name}</span>
              <div className="flex items-center gap-1">
                {a.status === "present" ? <Badge variant="lime">Present</Badge> : a.status === "absent" ? <Badge variant="destructive">Absent</Badge> : null}
                {shift.canManage ? (
                  <>
                    <Button variant="ghost" size="icon-sm" aria-label={`Mark ${a.name} present`} disabled={pending} onClick={() => run(() => markDutyAction(eventId, a.id, "present"))}><Check /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Mark ${a.name} absent`} disabled={pending} onClick={() => run(() => markDutyAction(eventId, a.id, "absent"))}><X /></Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a.name}`} disabled={pending} onClick={() => run(() => unassignDutyAction(eventId, a.id))}><Trash2 /></Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">Nobody assigned yet.</p>}
      {shift.canManage ? (
        <div className="flex gap-2">
          <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add a person" className="h-8 text-xs">
            <option value="">Add a person…</option>
            {people.filter((p) => !assigned.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={!pick || pending} onClick={() => run(() => assignDutyAction(eventId, shift.id, pick), () => setPick(""))}><UserPlus /> Assign</Button>
        </div>
      ) : null}
    </div>
  );
}

