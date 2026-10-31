"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Lock, LockOpen, Flag } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setEventStatusAction } from "@/features/events/actions";
import { closeEventFinancesAction, reopenEventFinancesAction } from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Done");
      onOk?.();
      router.refresh();
    });
  return { pending, run };
}

function TextPrompt({
  trigger, title, description, label, placeholder, confirm, destructive, onSubmit,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  label: string;
  placeholder: string;
  confirm: string;
  destructive?: boolean;
  onSubmit: (text: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length < 3) return void toast.error("Please write at least a few words.");
            run(() => onSubmit(text.trim()), () => { setOpen(false); setText(""); });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="closing-text">{label}</Label>
            <Textarea id="closing-text" rows={4} maxLength={2000} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} loading={pending}>{confirm}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClosingActions({
  eventId, status, closed, ready, canClose, canManage, isSuperAdmin,
}: {
  eventId: string;
  status: string;
  closed: boolean;
  ready: boolean;
  canClose: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
}) {
  const { pending, run } = useRun();
  const completed = status === "completed" || status === "archived";
  return (
    <div className="flex flex-wrap gap-2">
      {canManage && !completed && (
        <Button variant="outline" loading={pending} onClick={() => run(() => setEventStatusAction(eventId, "completed"))}>
          <Flag /> Mark event completed
        </Button>
      )}
      {canClose && !closed && (
        <TextPrompt
          trigger={<Button disabled={!completed || !ready}><Lock /> Close finances</Button>}
          title="Close event finances"
          description="The current figures are frozen into the closing report and no new transactions, expense requests or sponsorship payments can be recorded. Only a Super Admin can reopen."
          label="Closing note"
          placeholder="e.g. Figures reviewed with the treasurer and faculty coordinator on 2 Nov; cash balance handed to the college office."
          confirm="Close finances"
          onSubmit={(note) => closeEventFinancesAction(eventId, note)}
        />
      )}
      {isSuperAdmin && closed && (
        <TextPrompt
          trigger={<Button variant="outline"><LockOpen /> Reopen finances</Button>}
          title="Reopen event finances"
          description="Reopening allows new transactions again. The reason is added to the closing note and the audit log."
          label="Reason"
          placeholder="e.g. Late vendor invoice must be recorded."
          confirm="Reopen"
          destructive
          onSubmit={(reason) => reopenEventFinancesAction(eventId, reason)}
        />
      )}
      {canManage && status === "completed" && (
        <Button variant="outline" loading={pending} onClick={() => run(() => setEventStatusAction(eventId, "archived"))}>
          <Archive /> Archive event
        </Button>
      )}
    </div>
  );
}
