import Link from "next/link";
import { z } from "zod";
import {
  AlertTriangle, Building2, CalendarCheck2, CalendarClock, CalendarDays, CircleDollarSign, HandCoins, Radio, Receipt,
  TrendingDown, Users, UsersRound, Wallet,
} from "lucide-react";
import { requireAccess } from "@/lib/auth/session";
import { canSeeGlobalDashboard } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { Constants } from "@/lib/database.types";
import type { GlobalDashboard } from "@/features/dashboard/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState } from "@/components/shared/error-state";
import { FilterBar } from "@/components/dashboard/filters";
import { BarsChart, ChartPanel, TrendChart } from "@/components/charts/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MyWorkspace } from "./my-workspace";
import { AnnouncementsCard } from "@/features/announcements/announcements-card";
import { cn, formatCurrency, formatDate, formatDateRange, formatNumber, formatRelative, titleCase } from "@/lib/utils";

export const metadata = { title: "Overview" };

const filterSchema = z.object({
  college: z.string().uuid().optional().catch(undefined),
  event: z.string().uuid().optional().catch(undefined),
  status: z.enum(Constants.public.Enums.event_status).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess();
  if (!canSeeGlobalDashboard(access)) return <MyWorkspace access={access} />;

  const filters = filterSchema.parse(await searchParams);
  const supabase = await createClient();
  const [{ data, error }, colleges, events] = await Promise.all([
    supabase.rpc("global_dashboard", {
      p_college: filters.college,
      p_event: filters.event,
      p_status: filters.status,
      p_from: filters.from,
      p_to: filters.to,
    }),
    supabase.from("colleges").select("id, name").order("name"),
    supabase.from("events").select("id, name, college_id").order("starts_on", { ascending: false }).limit(500),
  ]);

  if (error || !data) return <ErrorState title="Could not load the dashboard" message={error?.message} />;
  const d = data as unknown as GlobalDashboard;
  const f = d.finance;
  const eventOptions = (events.data ?? []).filter((e) => !filters.college || e.college_id === filters.college);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={access.is_super_admin ? "Super Admin" : "College Admin"}
        title="Command centre"
        description={`${d.scope.college_count} college${d.scope.college_count === 1 ? "" : "s"} · ${d.scope.event_count} event${d.scope.event_count === 1 ? "" : "s"} · charts show ${formatDate(d.scope.from)} – ${formatDate(d.scope.to)}`}
        actions={
          access.is_super_admin ? (
            <>
              <Button variant="outline" asChild><Link href="/colleges/new">New college</Link></Button>
              <Button asChild><Link href="/events/new">New event</Link></Button>
            </>
          ) : (
            <Button asChild><Link href="/events/new">New event</Link></Button>
          )
        }
      />

      <FilterBar
        filters={[
          { type: "select", name: "college", label: "College", options: (colleges.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
          { type: "select", name: "event", label: "Event", options: eventOptions.map((e) => ({ value: e.id, label: e.name })) },
          { type: "select", name: "status", label: "Event status", options: Constants.public.Enums.event_status.map((s) => ({ value: s, label: titleCase(s) })) },
          { type: "date", name: "from", label: "From" },
          { type: "date", name: "to", label: "To" },
        ]}
      />

      <section aria-label="Platform" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Colleges" value={formatNumber(d.cards.total_colleges)} hint={`${d.cards.active_colleges} active`} icon={Building2} />
        <StatCard label="Events" value={formatNumber(d.cards.total_events)} hint={`${d.cards.completed_events} completed`} icon={CalendarDays} />
        <StatCard label="Upcoming events" value={formatNumber(d.cards.upcoming_events)} icon={CalendarClock} />
        <StatCard label="Live events" value={formatNumber(d.cards.live_events)} icon={Radio} highlight={d.cards.live_events > 0} />
        <StatCard label="Registered participants" value={formatNumber(d.cards.total_participants)} hint="Excludes cancelled" icon={UsersRound} />
        <StatCard label="Users" value={formatNumber(d.cards.total_users)} icon={Users} />
        <StatCard label="Registration revenue" value={formatCurrency(f.registration_income)} hint="Verified payments only" icon={Receipt} />
        <StatCard label="Sponsorship committed" value={formatCurrency(f.sponsorship_committed)} hint={`${formatCurrency(f.outstanding_sponsorship)} outstanding`} icon={HandCoins} />
      </section>

      <section aria-label="Finance" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total income received" value={formatCurrency(f.total_income_received)} hint="Registrations + sponsorship + other, verified" icon={CircleDollarSign} highlight />
        <StatCard label="Sponsorship collected" value={formatCurrency(f.sponsorship_income)} icon={HandCoins} />
        <StatCard label="Expenditure paid" value={formatCurrency(f.expenditure_paid)} hint={`${formatCurrency(f.approved_unpaid)} approved, unpaid`} icon={TrendingDown} />
        <StatCard label="Net cash position" value={formatCurrency(f.net_cash_position)} hint="Income − refunds − expenditure paid" icon={Wallet} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="Registration trend" description="New registrations per day across all selected events" empty={d.registration_trend.every((p) => p.registrations === 0)}>
          <TrendChart data={d.registration_trend} series={[{ key: "registrations", label: "Registrations" }, { key: "confirmed", label: "Confirmed", color: "ink" }]} />
        </ChartPanel>
        <ChartPanel title="Income vs expenditure" description="Verified ledger entries per day" empty={d.income_vs_expenditure.every((p) => !p.income && !p.expenditure)}>
          <TrendChart kind="currency" data={d.income_vs_expenditure} series={[{ key: "income", label: "Income" }, { key: "expenditure", label: "Expenditure", color: "ink" }]} />
        </ChartPanel>
        <ChartPanel title="Revenue by college" description="Verified income and expenditure in the period" empty={d.revenue_by_college.every((c) => !c.income && !c.expenditure)}>
          <BarsChart kind="currency" layout="horizontal-bars" data={d.revenue_by_college} xKey="college" series={[{ key: "income", label: "Income" }, { key: "expenditure", label: "Expenditure", color: "ink" }]} />
        </ChartPanel>
        <ChartPanel title="Event revenue comparison" description="Top events by verified income" empty={d.revenue_by_event.every((e) => !e.income)}>
          <BarsChart kind="currency" layout="horizontal-bars" data={d.revenue_by_event} xKey="event" series={[{ key: "registration_income", label: "Registrations" }, { key: "sponsorship_income", label: "Sponsorship", color: "ink" }]} />
        </ChartPanel>
        <ChartPanel title="Sponsorship performance" description="Committed vs received per event" empty={d.sponsorship_by_event.length === 0} emptyText="No sponsorship deals yet.">
          <BarsChart kind="currency" layout="horizontal-bars" data={d.sponsorship_by_event} xKey="event" series={[{ key: "committed", label: "Committed", color: "ink" }, { key: "received", label: "Received" }]} />
        </ChartPanel>
        <ChartPanel title="Events by college" description="Event count per college" empty={d.events_by_college.every((c) => c.total === 0)}>
          <BarsChart layout="horizontal-bars" data={d.events_by_college} xKey="college" series={[{ key: "total", label: "Events" }]} />
        </ChartPanel>
        <ChartPanel title="Department performance" description="Completed vs total tasks, by department name" empty={d.department_performance.length === 0} emptyText="No tasks created yet.">
          <BarsChart layout="horizontal-bars" data={d.department_performance} xKey="department" series={[{ key: "total", label: "Total tasks", color: "ink" }, { key: "completed", label: "Completed" }]} />
        </ChartPanel>
        <ChartPanel title="Event activity" description="Recorded activities per day" empty={d.activity_trend.every((p) => p.activities === 0)}>
          <TrendChart data={d.activity_trend} series={[{ key: "activities", label: "Activities" }]} />
        </ChartPanel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <ListCard title="Important alerts" empty="No alerts. Everything is on track.">
          {d.alerts.map((a, i) => (
            <Link key={i} href={`/events/${a.event_id}`} className="flex items-start gap-3 py-2.5 hover:opacity-80">
              <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", a.level === "warning" ? "text-warning" : "text-destructive")} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.title}</p>
                <p className="truncate text-xs text-muted-foreground">{a.detail}</p>
              </div>
            </Link>
          ))}
        </ListCard>
        <ListCard title="Live events" empty="No events are live right now.">
          {d.live_events.map((e) => <EventRow key={e.id} e={e} />)}
        </ListCard>
        <ListCard title="Upcoming events" empty="No upcoming events.">
          {d.upcoming_events.map((e) => <EventRow key={e.id} e={e} />)}
        </ListCard>
        <ListCard title="Pending financial approvals" empty="No expense requests are waiting.">
          {d.pending_approvals.map((x) => (
            <Link key={x.id} href={`/events/${x.event_id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{x.title}</p>
                <p className="truncate text-xs text-muted-foreground">{x.request_number} · {x.department} · {x.event}</p>
              </div>
              <span className="tabular text-sm font-medium">{formatCurrency(x.requested_amount)}</span>
            </Link>
          ))}
        </ListCard>
        <ListCard title="Latest registrations" empty="No registrations yet.">
          {d.latest_registrations.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.participant_name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.registration_number} · {r.event} · {formatRelative(r.created_at)}</p>
              </div>
              <StatusBadge status={r.payment_status} />
            </div>
          ))}
        </ListCard>
        <ListCard title="Latest transactions" empty="No transactions recorded yet.">
          {d.latest_transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{titleCase(t.category)}</p>
                <p className="truncate text-xs text-muted-foreground">{t.txn_number} · {t.event} · {formatDate(t.occurred_on)}</p>
              </div>
              <div className="text-right">
                <p className={cn("tabular text-sm font-medium", t.direction === "in" && "text-success-foreground dark:text-success")}>
                  {t.direction === "in" ? "+" : "−"}{formatCurrency(t.amount)}
                </p>
                <StatusBadge status={t.status} />
              </div>
            </div>
          ))}
        </ListCard>
        <ListCard title="Recently added colleges" empty="No colleges yet.">
          {d.recent_colleges.map((c) => (
            <Link key={c.id} href={`/colleges/${c.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.code}{c.city ? ` · ${c.city}` : ""}</p>
              </div>
              <StatusBadge status={c.status} />
            </Link>
          ))}
        </ListCard>
        <ListCard title="Recently created events" empty="No events yet.">
          {d.recent_events.map((e) => <EventRow key={e.id} e={e} />)}
        </ListCard>
        {d.scope.is_super_admin ? (
          <ListCard title="Recently added users" empty="No users yet.">
            {d.recent_users.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.full_name || u.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <span className="text-xs text-muted-foreground">{formatRelative(u.created_at)}</span>
              </div>
            ))}
          </ListCard>
        ) : null}
      </section>

      <AnnouncementsCard userId={access.user_id} />

      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
        <CardContent>
          {d.recent_activity.length === 0 ? (
            <EmptyState icon={CalendarCheck2} title="No activity yet" description="Activity from all events you oversee appears here." />
          ) : (
            <ol className="divide-y">
              {d.recent_activity.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{a.summary}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.event}{a.actor ? ` · ${a.actor}` : ""}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.created_at}>{formatRelative(a.created_at)}</time>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ListCard({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {children.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : <div className="divide-y">{children}</div>}
      </CardContent>
    </Card>
  );
}

function EventRow({ e }: { e: { id: string; name: string; college_name: string; status: string; starts_on: string; ends_on: string } }) {
  return (
    <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{e.name}</p>
        <p className="truncate text-xs text-muted-foreground">{e.college_name} · {formatDateRange(e.starts_on, e.ends_on)}</p>
      </div>
      <StatusBadge status={e.status} />
    </Link>
  );
}
