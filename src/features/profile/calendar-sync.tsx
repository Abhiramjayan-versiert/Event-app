"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calendarTokenAction } from "./calendar-actions";

/** Subscribe-able personal calendar (events, schedule, my tasks). */
export function CalendarSync({ appUrl }: { appUrl: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const httpsUrl = token ? `${appUrl}/api/calendar/${token}.ics` : "";
  const webcal = httpsUrl.replace(/^https?:/, "webcal:");
  const load = (reset: boolean) =>
    start(async () => {
      const r = await calendarTokenAction(reset);
      if (!r.ok) return void toast.error(r.error);
      setToken(r.data!.token);
      if (r.message) toast.success(r.message);
    });

  if (!token) {
    return (
      <Button variant="outline" onClick={() => load(false)} loading={pending}>
        <CalendarPlus /> Get my calendar link
      </Button>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input readOnly value={httpsUrl} aria-label="Calendar link" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(httpsUrl).then(() => toast.success("Link copied"))}>
          <Copy />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">Add to Google Calendar</a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={webcal}>Apple / Outlook calendar</a>
        </Button>
        <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={pending}>
          <RefreshCw /> Reset link
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Anyone with this link can see your event schedule and assigned tasks, so keep it private. Reset it if it leaks.
        Calendars refresh every few hours.
      </p>
    </div>
  );
}
