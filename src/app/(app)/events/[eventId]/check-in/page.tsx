import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { CheckInScanner } from "@/features/checkin/scanner";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Check-in" };

type Overview = { confirmed: number; checked_in: number; recent: { id: string; registration_number: string; participant_name: string; checked_in_at: string; checked_in_by: string | null }[] };

export default async function CheckInPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkin_overview", { p_event: eventId });
  if (error) notFound();
  const o = data as unknown as Overview;
  const pct = o.confirmed ? Math.round((o.checked_in / o.confirmed) * 100) : 0;
  return (
    <div className="space-y-6">
      <RealtimeRefresh eventId={eventId} tables={["registrations"]} />
      <PageHeader eyebrow={event.name} title="Gate check-in" description="Scan participants' ticket QR codes. Each ticket can enter once." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Checked in" value={formatNumber(o.checked_in)} highlight />
        <StatCard label="Confirmed registrations" value={formatNumber(o.confirmed)} />
        <StatCard label="Arrived" value={`${pct}%`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <CheckInScanner eventId={eventId} />
        <Card>
          <CardHeader><CardTitle>Latest check-ins</CardTitle></CardHeader>
          <CardContent>
            {o.recent.length === 0 ? <p className="text-sm text-muted-foreground">Nobody has checked in yet.</p> : (
              <ul className="divide-y text-sm">
                {o.recent.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-2">
                    <span className="min-w-0 truncate"><span className="font-medium">{r.participant_name}</span> <span className="text-muted-foreground">{r.registration_number}</span></span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(r.checked_in_at).toLocaleTimeString("en-IN", { timeZone: event.timezone, timeStyle: "short" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
