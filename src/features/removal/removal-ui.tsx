"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Eraser, RotateCcw, Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/actions";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/forms/confirm-button";
import {
  cancelCompetitionAction, cancelEventAction, clearRemovalLogAction, deleteCompetitionAction, restoreCompetitionAction, restoreEventAction,
} from "@/features/removal/actions";

/** Button → dialog asking for a reason → runs the action. */
function ReasonDialog({
  trigger, title, description, confirmLabel, required, onConfirm, variant = "destructive", size,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  required: boolean;
  onConfirm: (reason: string) => Promise<ActionResult>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const ok = !required || reason.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(""); }}>
      <DialogTrigger asChild><Button variant={variant} size={size}>{trigger}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok) return;
            start(async () => {
              const r = await onConfirm(reason);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message ?? "Done");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="removal-reason">Reason{required ? "" : " (optional)"}</Label>
            <Textarea id="removal-reason" value={reason} maxLength={500} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Venue unavailable" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Back</Button>
            <Button type="submit" variant="destructive" loading={pending} disabled={!ok}>{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CancelEventButton({ eventId, name, isSuperAdmin }: { eventId: string; name: string; isSuperAdmin: boolean }) {
  return (
    <ReasonDialog
      trigger={<><Ban /> Cancel event</>}
      title={`Cancel ${name}?`}
      description="Registrations close, the public page shows the event as cancelled and every record is kept. You can restore it later."
      confirmLabel="Cancel event"
      required={!isSuperAdmin}
      onConfirm={(r) => cancelEventAction(eventId, r)}
    />
  );
}

export function RestoreEventButton({ eventId }: { eventId: string }) {
  return (
    <ConfirmButton
      variant="outline"
      title="Restore this event?"
      description="The event returns to Planning status. Open registrations again from the Lifecycle status when ready."
      confirmLabel="Restore event"
      action={() => restoreEventAction(eventId)}
    >
      <RotateCcw /> Restore event
    </ConfirmButton>
  );
}

export function CompetitionRemoval({ eventId, competitionId, name, cancelled }: { eventId: string; competitionId: string; name: string; cancelled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {cancelled ? (
        <ConfirmButton variant="outline" size="sm" title={`Restore ${name}?`} description="The competition opens for registration again." confirmLabel="Restore"
          action={() => restoreCompetitionAction(eventId, competitionId)}>
          <RotateCcw /> Restore
        </ConfirmButton>
      ) : (
        <ReasonDialog
          variant="outline" size="sm"
          trigger={<><Ban /> Cancel</>}
          title={`Cancel ${name}?`}
          description="The competition closes for registration and is hidden from the public page. Existing registrations are kept."
          confirmLabel="Cancel competition"
          required={false}
          onConfirm={(r) => cancelCompetitionAction(eventId, competitionId, r)}
        />
      )}
      <ReasonDialog
        variant="ghost" size="sm"
        trigger={<><Trash2 /> Delete</>}
        title={`Delete ${name}?`}
        description="Permanently removes the competition. Competitions that people registered for cannot be deleted — cancel them instead."
        confirmLabel="Delete competition"
        required={false}
        onConfirm={(r) => deleteCompetitionAction(eventId, competitionId, r)}
      />
    </div>
  );
}

export function ClearRemovalLogButton({ count }: { count: number }) {
  return (
    <ConfirmButton
      variant="outline" size="sm"
      title="Clear this list?"
      description={`Removes ${count} item${count === 1 ? "" : "s"} from your dashboard and resets the count to zero. The activity log still keeps the history.`}
      confirmLabel="Clear list"
      action={clearRemovalLogAction}
    >
      <Eraser /> Clear
    </ConfirmButton>
  );
}
