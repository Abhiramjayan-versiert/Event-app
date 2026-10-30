import {
  AlarmClock, Ban, CheckCircle2, CircleDollarSign, ClipboardCheck, Clock, HandCoins, ListTodo, PiggyBank, Receipt,
  TrendingDown, UsersRound, Wallet, XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import type { EventDashboard } from "@/features/dashboard/types";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarsChart, ChartPanel, TrendChart } from "@/components/charts/charts";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { formatCurrency, formatNumber, formatRelative, titleCase } from "@/lib/utils";

const LIVE_TABLES = ["activity_log", "registrations", "financial_transactions", "expense_requests", "tasks"];

export default async function EventDashboardPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_dashboard", { p_event: eventId });
  if (error || !data) return <ErrorState title="Could not load the event dashboard" message={error?.message} />;
  const d = data as unknown as EventDashboard;
  const cur = event.currency;
  const money = (v: number) => formatCurrency(v, cur);
  const f = d.finance;
  const r = d.registrations;
  const taskPct = d.tasks.total ? (100 * d.tasks.completed) / d.tasks.total : 0;
  const budgetPct = f && f.total_budget ? (100 * f.approved_expenses_total) / f.total_budget : 0;

  return (
    <div className="space-y-8">
      <RealtimeRefresh eventId={eventId} tables={LIVE_TABLES} />

      {r ? (
        <section aria-label="Registrations" className="space-y-3">
          <h2 className="text-sm font-semibold">Registrations</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total" value={formatNumber(r.total)} icon={UsersRound} highlight />
            <StatCard label="Confirmed" value={formatNumber(r.confirmed)} icon={CheckCircle2} />
            <StatCard label="Pending" value={formatNumber(r.pending)} icon={Clock} />
            <StatCard label="Failed payments" value={formatNumber(r.failed_payments)} icon={XCircle} />
            <StatCard label="Cancelled" value={formatNumber(r.cancelled)} icon={Ban} />
          </div>
        </section>
      ) : null}

      {f ? (
        <section aria-label="Finance" className="space-y-3">
          <h2 className="text-sm font-semibold">Finance</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Registration income" value={money(f.registration_income)} hint="Verified payments" icon={Receipt} />
            <StatCard label="Sponsorship committed" value={money(f.sponsorship_committed)} hint={`${money(f.outstanding_sponsorship)} outstanding`} icon={HandCoins} />
            <StatCard label="Sponsorship received" value={money(f.sponsorship_income)} icon={HandCoins} />
            <StatCard label="Other income" value={money(f.other_income)} icon={CircleDollarSign} />
            <StatCard label="Total budget" value={money(f.total_budget)} hint={`${money(f.allocated_budget)} allocated to departments`} icon={PiggyBank} />
            <StatCard label="Approved expenses" value={money(f.approved_expenses_total)} hint={`${f.pending_expense_count} pending approval · ${money(f.pending_expense_amount)}`} icon={ClipboardCheck} />
            <StatCard label="Expenditure paid" value={money(f.expenditure_paid)} hint={`${money(f.approved_unpaid)} approved, unpaid`} icon={TrendingDown} />
            <StatCard label="Cash balance" value={money(f.net_cash_position)} hint="Verified income − refunds − paid" icon={Wallet} highlight />
          </div>
        </section>
      ) : null}

      <section aria-label="Tasks" className="space-y-3">
        <h2 className="text-sm font-semibold">Work</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Pending tasks" value={formatNumber(d.tasks.pending)} icon={ListTodo} />
          <StatCard label="Completed tasks" value={formatNumber(d.tasks.completed)} icon={CheckCircle2} />
          <StatCard label="Overdue tasks" value={formatNumber(d.tasks.overdue)} icon={AlarmClock} />
          <StatCard label="Team" value={formatNumber(d.members)} hint={`${d.departments} active departments`} icon={UsersRound} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {r ? (
          <ChartPanel title="Daily registration growth" empty={r.daily.every((p) => p.registrations === 0)}>
            <TrendChart data={r.daily} series={[{ key: "registrations", label: "Registrations" }]} />
          </ChartPanel>
        ) : null}
        {d.finance_charts ? (
          <>
            <ChartPanel title="Registration revenue trend" description="Verified registration income per day" empty={d.finance_charts.registration_revenue.every((p) => !p.amount)}>
              <TrendChart kind="currency" currency={cur} data={d.finance_charts.registration_revenue} series={[{ key: "amount", label: "Revenue" }]} />
            </ChartPanel>
            <ChartPanel title="Income vs expenditure" empty={d.finance_charts.income_vs_expenditure.every((p) => !p.income && !p.expenditure)}>
              <TrendChart kind="currency" currency={cur} data={d.finance_charts.income_vs_expenditure} series={[{ key: "income", label: "Income" }, { key: "expenditure", label: "Expenditure", color: "ink" }]} />
            </ChartPanel>
            <ChartPanel title="Department budget usage" description="Allocated vs approved spend" empty={d.finance_charts.department_budgets.length === 0} emptyText="No department budgets allocated yet.">
              <BarsChart kind="currency" currency={cur} layout="horizontal-bars" data={d.finance_charts.department_budgets} xKey="department" series={[{ key: "allocated", label: "Allocated", color: "ink" }, { key: "approved", label: "Approved" }]} />
            </ChartPanel>
            <ChartPanel title="Sponsorship collection" description="Agreed vs received by pipeline stage" empty={d.finance_charts.sponsorship_stages.length === 0} emptyText="No sponsorship deals yet.">
              <BarsChart kind="currency" currency={cur} data={d.finance_charts.sponsorship_stages.map((s) => ({ ...s, stage: titleCase(s.stage) }))} xKey="stage" series={[{ key: "agreed", label: "Agreed", color: "ink" }, { key: "received", label: "Received" }]} />
            </ChartPanel>
          </>
        ) : null}
        {r ? (
          <>
            <ChartPanel title="Registrations by category" empty={r.by_category.length === 0}>
              <BarsChart layout="horizontal-bars" data={r.by_category.map((c) => ({ ...c, category: titleCase(c.category) }))} xKey="category" series={[{ key: "count", label: "Registrations" }]} />
            </ChartPanel>
            <ChartPanel title="Registration payment status" empty={r.by_payment_status.length === 0}>
              <BarsChart data={r.by_payment_status.map((s) => ({ ...s, status: titleCase(s.status) }))} xKey="status" series={[{ key: "count", label: "Registrations" }]} />
            </ChartPanel>
          </>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Progress</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <Meter label="Task completion" value={taskPct} detail={`${d.tasks.completed} of ${d.tasks.total} tasks`} />
            {f ? (
              <Meter
                label="Budget utilisation"
                value={budgetPct}
                detail={`${money(f.approved_expenses_total)} approved of ${money(f.total_budget)}`}
                tone={budgetPct >= 100 ? "destructive" : budgetPct >= 75 ? "warning" : "lime"}
              />
            ) : null}
            {f && f.sponsorship_committed > 0 ? (
              <Meter label="Sponsorship collected" value={(100 * f.sponsorship_income) / f.sponsorship_committed} detail={`${money(f.sponsorship_income)} of ${money(f.sponsorship_committed)}`} />
            ) : null}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
          <CardContent>
            {d.activity.length === 0 ? (
              <EmptyState title="No activity yet" description="Registrations, payments, approvals and task updates appear here in real time." />
            ) : (
              <ol className="divide-y">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{a.summary}</p>
                      <p className="text-xs text-muted-foreground">{titleCase(a.activity_type.split(".")[0])}{a.actor ? ` · ${a.actor}` : ""}</p>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.created_at}>{formatRelative(a.created_at)}</time>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Meter({ label, value, detail, tone = "lime" }: { label: string; value: number; detail: string; tone?: "lime" | "warning" | "destructive" }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular font-semibold">{Math.round(value)}%</span>
      </div>
      <Progress value={value} tone={tone} />
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
