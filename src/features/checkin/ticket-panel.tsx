"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Mail, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emailTicketAction, undoCheckInAction } from "./actions";

/** Ticket link, email and check-in controls on a registration. */
export function TicketPanel({
  eventId, registrationId, ticketCode, checkedInAt, canManage, canCheckIn,
}: { eventId: string; registrationId: string; ticketCode: string; checkedInAt: string | null; canManage: boolean; canCheckIn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => ReturnType<typeof emailTicketAction>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Done");
      router.refresh();
    });
  return (
    <div className="space-y-3 text-sm">
      <p>Ticket code <span className="font-mono font-semibold tracking-wider">{ticketCode}</span></p>
      <p>{checkedInAt ? `Checked in ${new Date(checkedInAt).toLocaleString()}` : "Not checked in yet"}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={`/t/${ticketCode.toLowerCase()}`} target="_blank" rel="noreferrer"><ExternalLink /> Open ticket</a>
        </Button>
        {canManage ? <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => emailTicketAction(eventId, registrationId))}><Mail /> Email ticket</Button> : null}
        {canCheckIn && checkedInAt ? <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => undoCheckInAction(eventId, registrationId))}><Undo2 /> Undo check-in</Button> : null}
      </div>
    </div>
  );
}
