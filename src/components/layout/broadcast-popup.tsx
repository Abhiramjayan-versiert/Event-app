"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Broadcast = { id: string; title: string; body: string; priority: string; published_at: string };

/**
 * Super Admin announcements: shown to everyone as a pop-up they must
 * acknowledge, whatever their notification settings. Checked when the app
 * opens, when it returns to the foreground, and every minute while open.
 */
export function BroadcastPopup() {
  const [queue, setQueue] = useState<Broadcast[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await createClient().rpc("my_unread_broadcasts");
    if (data) setQueue(data as Broadcast[]);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const current = queue[0];
  if (!current) return null;

  const acknowledge = async () => {
    setBusy(true);
    await createClient().rpc("ack_broadcast", { p_announcement: current.id });
    setQueue((q) => q.filter((b) => b.id !== current.id));
    setBusy(false);
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Megaphone className="size-4 text-lime-dark" /> Announcement from the Admin
            {current.priority !== "normal" ? <Badge variant={current.priority === "urgent" ? "destructive" : "warning"}>{current.priority}</Badge> : null}
          </div>
          <AlertDialogTitle>{current.title}</AlertDialogTitle>
          <AlertDialogDescription className="max-h-[50vh] overflow-y-auto whitespace-pre-line text-foreground">{current.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {queue.length > 1 ? <span className="mr-auto self-center text-xs text-muted-foreground">{queue.length - 1} more</span> : null}
          <Button onClick={acknowledge} loading={busy}>Got it</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
