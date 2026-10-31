"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Megaphone, Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { markNotificationsReadAction, postAnnouncementAction, removeAnnouncementAction } from "@/features/announcements/actions";
import { formatRelative } from "@/lib/utils";

export type Audience = { label: string; value: string; target: { scope: "global" } | { scope: "college"; college_id: string } | { scope: "event"; event_id: string } };

export function ComposeAnnouncement({ audiences }: { audiences: Audience[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState({ audience: audiences[0]?.value ?? "", title: "", body: "", priority: "normal" as "normal" | "important" | "urgent", pinned: false });
  if (audiences.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Megaphone /> New announcement</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New announcement</DialogTitle></DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const aud = audiences.find((a) => a.value === v.audience);
            if (!aud) return;
            startTransition(async () => {
              const r = await postAnnouncementAction(aud.target, { title: v.title, body: v.body, priority: v.priority, pinned: v.pinned });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Published");
              setOpen(false);
              setV((x) => ({ ...x, title: "", body: "", pinned: false }));
              router.refresh();
            });
          }}
        >
          <FormField id="an-aud" label="Audience">
            <NativeSelect id="an-aud" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })}>
              {audiences.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="an-t" label="Title" required><Input id="an-t" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} minLength={2} maxLength={150} required /></FormField>
          <FormField id="an-b" label="Message" required><Textarea id="an-b" rows={4} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} minLength={2} maxLength={5000} required /></FormField>
          <div className="flex flex-wrap items-center gap-4">
            <NativeSelect aria-label="Priority" className="h-8 w-36" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value as typeof v.priority })}>
              <option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option>
            </NativeSelect>
            <div className="flex items-center gap-2"><Switch id="an-pin2" checked={v.pinned} onCheckedChange={(c) => setV({ ...v, pinned: c })} /><Label htmlFor="an-pin2">Pin to top</Label></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Publish</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type AnnouncementItem = { id: string; title: string; body: string; priority: string; pinned: boolean; published_at: string; author: string; audience: string; mine: boolean };

export function AnnouncementFeed({ items, path }: { items: AnnouncementItem[]; path: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No announcements yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {a.pinned ? <Pin className="size-3.5 text-lime-dark" /> : null}
              <p className="font-semibold">{a.title}</p>
              {a.priority !== "normal" ? <Badge variant={a.priority === "urgent" ? "destructive" : "warning"}>{a.priority}</Badge> : null}
              <Badge variant="muted">{a.audience}</Badge>
            </div>
            {a.mine ? (
              <ConfirmButton variant="ghost" size="icon-sm" destructive aria-label="Delete" title="Delete announcement?" description="It disappears for everyone." confirmLabel="Delete" action={() => removeAnnouncementAction(a.id, path)}>
                <Trash2 />
              </ConfirmButton>
            ) : null}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">{a.author} · {formatRelative(a.published_at)}</p>
        </li>
      ))}
    </ul>
  );
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="outline" disabled={disabled} loading={pending} onClick={() => startTransition(async () => { const r = await markNotificationsReadAction("all"); if (!r.ok) toast.error(r.error); router.refresh(); })}>
      Mark all as read
    </Button>
  );
}
