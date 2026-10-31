"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/utils";
import { cloneEventAction } from "./actions";

/** "Copy this event" for a new edition (next year's fest). */
export function CloneEventDialog({ eventId, name, startsOn, endsOn }: { eventId: string; name: string; startsOn: string; endsOn: string }) {
  const router = useRouter();
  const nextYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
  const suggested = /\d{4}/.test(name) ? name.replace(/\d{4}/, (y) => String(Number(y) + 1)) : `${name} ${Number(startsOn.slice(0, 4)) + 1}`;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: suggested, slug: slugify(suggested), starts_on: nextYear(startsOn), ends_on: nextYear(endsOn), include_team: false });
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Copy /> Copy as new event</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {name}</DialogTitle>
          <DialogDescription>
            Creates a new event with the same departments, sponsorship packages, competitions, venues, schedule, task checklist,
            settings and budget split, shifted to the new dates. Registrations, money and documents are never copied.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await cloneEventAction(eventId, v);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Event copied");
              setOpen(false);
              router.push(`/events/${r.data!.id}/settings`);
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="c-name">New event name</Label>
            <Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, slug: slugify(e.target.value) })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-slug">URL slug</Label>
            <Input id="c-slug" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="c-start">Starts</Label>
              <Input id="c-start" type="date" value={v.starts_on} onChange={(e) => setV({ ...v, starts_on: e.target.value })} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-end">Ends</Label>
              <Input id="c-end" type="date" value={v.ends_on} onChange={(e) => setV({ ...v, ends_on: e.target.value })} required />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={v.include_team} onCheckedChange={(c) => setV({ ...v, include_team: c === true })} className="mt-0.5" />
            <span>Also copy the team (event roles and department appointments). Leave off if a new batch takes over.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Create copy</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
