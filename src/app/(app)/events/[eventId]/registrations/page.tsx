import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CheckCircle2, CircleDollarSign, Clock, Pencil, Plus, UsersRound, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarsChart, ChartPanel, TrendChart } from "@/components/charts/charts";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { CompetitionDialog, OfflineRegistrationDialog, RegistrationsTable, type RegistrationRow } from "@/features/registrations/registrations-ui";
import { cn, formatCurrency, formatNumber, titleCase } from "@/lib/utils";

export const metadata = { title: "Registrations" };

type Dashboard = {
  total: number; confirmed: number; pending_payments: number; failed_payments: number; cancelled: number; test: number; participants: number;
  collected: number; average_value: number;
  by_category: { category: string; count: number; collected: number }[];
  by_payment_status: { status: string; count: number }[];
  by_college: { college: string; count: number }[];
  daily: { date: string; registrations: number }[];
};

const TABS = [{ key: "dashboard", label: "Dashboard" }, { key: "participants", label: "Participants" }, { key: "competitions", label: "Competitions" }] as const;

export default async function RegistrationsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { eventId } = await params;
  const { tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t.key === tabParam)?.key ?? "dashboard";
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "registrations.view")) notFound();
  const supabase = await createClient();
  const cur = event.currency;

  const [dash, regs, comps] = await Promise.all([
    supabase.rpc("registration_dashboard", { p_event: eventId }),
    tab === "participants"
      ? supabase.from("registrations").select("id, registration_number, participant_name, email, phone, participant_college, category, registration_type, team_name, source, status, payment_status, payable_amount, amount_paid, created_at, is_test").eq("event_id", eventId).order("created_at", { ascending: false }).limit(5000)
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("event_competitions").select("*").eq("event_id", eventId).order("name"),
  ]);
  if (dash.error) return <ErrorState title="Could not load registrations" message={dash.error.message} />;
  const d = dash.data as unknown as Dashboard;
  const competitions = comps.data ?? [];
  const canManage = can(permissions, "registrations.manage");
  const rows: RegistrationRow[] = (regs.data ?? []).map((r) => ({ ...r, payable_amount: Number(r.payable_amount), amount_paid: Number(r.amount_paid) }));

  return (
    <div className="space-y-6">
      <RealtimeRefresh eventId={eventId} tables={["registrations"]} />
      <PageHeader
        title="Registrations"
        description="Participants from the event website and the registration desk. Only verified gateway callbacks mark online payments as paid."
        actions={canManage ? <OfflineRegistrationDialog eventId={eventId} currency={cur} competitions={competitions.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, fee: Number(c.fee), category: c.category, registration_type: c.registration_type }))} /> : null}
      />
      <nav className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/events/${eventId}/registrations${t.key === "dashboard" ? "" : `?tab=${t.key}`}`} className={cn("whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "dashboard" ? (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total registrations" value={formatNumber(d.total)} hint={`${formatNumber(d.participants)} participants incl. team members`} icon={UsersRound} highlight />
            <StatCard label="Confirmed" value={formatNumber(d.confirmed)} icon={CheckCircle2} />
            <StatCard label="Pending payments" value={formatNumber(d.pending_payments)} icon={Clock} />
            <StatCard label="Failed payments" value={formatNumber(d.failed_payments)} icon={XCircle} />
            <StatCard label="Cancelled" value={formatNumber(d.cancelled)} icon={Ban} />
            <StatCard label="Total collected" value={formatCurrency(d.collected, cur)} hint="Paid minus refunds" icon={CircleDollarSign} />
            <StatCard label="Average registration value" value={formatCurrency(d.average_value, cur)} icon={CircleDollarSign} />
            <StatCard label="Test registrations" value={formatNumber(d.test)} hint="From sandbox API keys" />
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel title="Daily registrations" empty={d.daily.every((x) => x.registrations === 0)}>
              <TrendChart data={d.daily} series={[{ key: "registrations", label: "Registrations" }]} />
            </ChartPanel>
            <ChartPanel title="Registrations by category" empty={d.by_category.length === 0}>
              <BarsChart layout="horizontal-bars" data={d.by_category.map((c) => ({ ...c, category: titleCase(c.category) }))} xKey="category" series={[{ key: "count", label: "Registrations" }]} />
            </ChartPanel>
            <ChartPanel title="Participants by college" description="Top 15 colleges" empty={d.by_college.length === 0}>
              <BarsChart layout="horizontal-bars" data={d.by_college} xKey="college" series={[{ key: "count", label: "Registrations" }]} />
            </ChartPanel>
            <ChartPanel title="Payment status" empty={d.by_payment_status.length === 0}>
              <BarsChart data={d.by_payment_status.map((s) => ({ ...s, status: titleCase(s.status) }))} xKey="status" series={[{ key: "count", label: "Registrations" }]} />
            </ChartPanel>
          </div>
        </div>
      ) : null}

      {tab === "participants" ? <RegistrationsTable eventId={eventId} rows={rows} currency={cur} canExport={can(permissions, "registrations.export")} /> : null}

      {tab === "competitions" ? (
        <div className="space-y-4">
          {can(permissions, "event.manage") ? (
            <div className="flex justify-end">
              <CompetitionDialog eventId={eventId} trigger={<Button><Plus /> New competition</Button>} />
            </div>
          ) : null}
          {competitions.length === 0 ? (
            <EmptyState title="No competitions yet" description="Add the competitions and registration categories participants can register for. The public website reads this list through the API." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {competitions.map((c) => (
                <div key={c.id} className="space-y-3 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                    </div>
                    <Badge variant={c.is_active ? "success" : "muted"}>{c.is_active ? "Open" : "Closed"}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Fee</span><span className="tabular text-right">{formatCurrency(c.fee, cur)}</span>
                    <span className="text-muted-foreground">Category</span><span className="text-right">{titleCase(c.category)}</span>
                    <span className="text-muted-foreground">Type</span><span className="text-right">{c.registration_type === "team" ? `Team (${c.team_min}–${c.team_max})` : "Individual"}</span>
                    <span className="text-muted-foreground">Capacity</span><span className="text-right">{c.capacity ?? "Unlimited"}</span>
                  </div>
                  {can(permissions, "event.manage") ? (
                    <CompetitionDialog
                      eventId={eventId}
                      competitionId={c.id}
                      defaults={{
                        name: c.name, code: c.code, category: c.category, description: c.description ?? "", fee: Number(c.fee), registration_type: c.registration_type,
                        team_min: c.team_min, team_max: c.team_max, capacity: c.capacity, venue: c.venue ?? "", rules_url: c.rules_url ?? "", is_active: c.is_active,
                      }}
                      trigger={<Button variant="outline" size="sm" className="w-full"><Pencil /> Edit</Button>}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
