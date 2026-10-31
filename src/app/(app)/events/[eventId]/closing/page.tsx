import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canAnywhere } from "@/lib/permissions";
import type { FinanceSummary } from "@/features/dashboard/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ErrorState } from "@/components/shared/error-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClosingActions } from "@/features/closing/closing-actions";
import { reportsFor } from "@/features/reports/definitions";
import { cn, formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";

export const metadata = { title: "Event closing" };

type Closure = {
  finance: FinanceSummary;
  registrations: { total: number; confirmed: number; cancelled: number; pending_payment: number };
  pending_transactions: number;
  open_expense_requests: number;
  unpaid_approved: number;
  unfinished_tasks: number;
  pending_deliverables: number;
  pending_sponsorship_payments: number;
  departments: { name: string; progress_pct: number; tasks: number; completed: number; allocated: number; spent: number }[];
  closed_at: string | null;
  closing_note: string | null;
};

function Check({ ok, blocking, title, detail, href }: { ok: boolean; blocking: boolean; title: string; detail: string; href?: string }) {
  const Icon = ok ? CheckCircle2 : blocking ? CircleAlert : CircleDashed;
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className={cn("mt-0.5 size-5 shrink-0", ok ? "text-lime-dark" : blocking ? "text-destructive" : "text-amber-500")} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {!ok && href ? <Link href={href} className="shrink-0 text-sm font-medium underline-offset-4 hover:underline">Review</Link> : null}
    </li>
  );
}

export default async function EventClosingPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "event.close") && !can(permissions, "finance.view")) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_closure_status", { p_event: eventId });
  if (error) return <ErrorState title="Could not load the closing status" message={error.message} />;
  const s = data as unknown as Closure;
  const f = s.finance;
  const cur = event.currency;
  const n = (v: unknown) => Number(v ?? 0);
  const closed = Boolean(s.closed_at);
  const completed = event.status === "completed" || event.status === "archived";
  const blockers = n(s.pending_transactions) + n(s.open_expense_requests) + n(s.pending_sponsorship_payments);

  let closedBy: string | null = null;
  if (event.financially_closed_by) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", event.financially_closed_by).maybeSingle();
    closedBy = p?.full_name ?? null;
  }
  const base = `/events/${eventId}`;
  const reports = reportsFor(permissions);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event.name}
        title="Event closing & final settlement"
        description="Review the final figures, resolve pending items and close the event's finances. Records are never deleted; archived events stay available for reports and audit."
        actions={
          <ClosingActions
            eventId={eventId}
            status={event.status}
            closed={closed}
            ready={blockers === 0}
            canClose={can(permissions, "event.close")}
            canManage={can(permissions, "event.manage")}
            isSuperAdmin={access.is_super_admin}
          />
        }
      />

      <Card className={cn(closed && "border-primary")}>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          {closed ? <Lock className="size-5 text-lime-dark" /> : <CircleDashed className="size-5 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {closed ? `Finances closed ${formatDateTime(s.closed_at)}${closedBy ? ` by ${closedBy}` : ""}` : "Finances are open"}
            </p>
            {s.closing_note ? <p className="whitespace-pre-line text-sm text-muted-foreground">{s.closing_note}</p> : null}
          </div>
          <StatusBadge status={event.status} />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Remaining cash position" value={formatCurrency(f.net_cash_position, cur)} highlight />
        <StatCard label="Registrations" value={formatNumber(s.registrations.total)} hint={`${formatNumber(s.registrations.confirmed)} confirmed · ${formatNumber(s.registrations.cancelled)} cancelled`} />
        <StatCard label="Registration income" value={formatCurrency(f.registration_income, cur)} />
        <StatCard label="Sponsorship received" value={formatCurrency(f.sponsorship_income, cur)} hint={`Committed ${formatCurrency(f.sponsorship_committed, cur)}`} />
        <StatCard label="Outstanding sponsorship" value={formatCurrency(f.outstanding_sponsorship, cur)} />
        <StatCard label="Other income" value={formatCurrency(f.other_income, cur)} />
        <StatCard label="Refunds paid" value={formatCurrency(f.refunds_paid, cur)} />
        <StatCard label="Expenditure paid" value={formatCurrency(f.expenditure_paid, cur)} />
        <StatCard label="Approved, unpaid" value={formatCurrency(f.approved_unpaid, cur)} hint={`${formatNumber(s.unpaid_approved)} request(s)`} />
        <StatCard label="Pending financial requests" value={formatNumber(f.pending_expense_count)} hint={formatCurrency(f.pending_expense_amount, cur)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Closing checklist</CardTitle>
            <CardDescription>Red items block closing. Amber items are warnings to review.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              <Check ok={completed} blocking title="Event marked completed" detail={completed ? "The event has finished." : `Current status: ${event.status.replace(/_/g, " ")}.`} href={`${base}/settings`} />
              <Check ok={n(s.pending_transactions) === 0} blocking title="All transactions verified" detail={`${formatNumber(s.pending_transactions)} unverified ledger entr${n(s.pending_transactions) === 1 ? "y" : "ies"}.`} href={`${base}/finance?tab=ledger`} />
              <Check ok={n(s.open_expense_requests) === 0} blocking title="No open expense requests" detail={`${formatNumber(s.open_expense_requests)} draft, submitted or under-review request(s).`} href={`${base}/finance?tab=expenses`} />
              <Check ok={n(s.pending_sponsorship_payments) === 0} blocking title="Sponsorship payments verified" detail={`${formatNumber(s.pending_sponsorship_payments)} payment(s) awaiting verification.`} href={`${base}/sponsorship`} />
              <Check ok={n(s.unpaid_approved) === 0} blocking={false} title="Approved expenses paid" detail={`${formatCurrency(f.approved_unpaid, cur)} approved but not yet paid.`} href={`${base}/finance?tab=expenses`} />
              <Check ok={n(s.registrations.pending_payment) === 0} blocking={false} title="Registration payments settled" detail={`${formatNumber(s.registrations.pending_payment)} registration(s) still awaiting payment.`} href={`${base}/registrations`} />
              <Check ok={n(s.unfinished_tasks) === 0} blocking={false} title="Tasks finished" detail={`${formatNumber(s.unfinished_tasks)} task(s) not completed.`} href={`${base}/tasks`} />
              <Check ok={n(s.pending_deliverables) === 0} blocking={false} title="Sponsor deliverables fulfilled" detail={`${formatNumber(s.pending_deliverables)} deliverable(s) pending.`} href={`${base}/sponsorship`} />
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department performance</CardTitle>
            <CardDescription>Task completion and spending per department.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {s.departments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active departments.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Department</TableHead>
                    <TableHead>Tasks</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Spent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.departments.map((d) => {
                    const pct = n(d.tasks) ? Math.round((n(d.completed) / n(d.tasks)) * 100) : 0;
                    return (
                      <TableRow key={d.name}>
                        <TableCell className="font-medium">{d.name}</TableCell>
                        <TableCell className="min-w-36">
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5" />
                            <span className="tabular text-xs text-muted-foreground">{n(d.completed)}/{n(d.tasks)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="tabular text-right">{formatCurrency(d.allocated, cur)}</TableCell>
                        <TableCell className={cn("tabular text-right", n(d.allocated) > 0 && n(d.spent) > n(d.allocated) && "text-destructive")}>{formatCurrency(d.spent, cur)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {reports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Final reports</CardTitle>
            <CardDescription>
              {canAnywhere(permissions, "reports.export") ? "Open a report to export it as CSV, Excel or PDF for your records." : "Open a report to review it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {reports.map((r) => (
              <Link key={r.key} href={`${base}/reports/${r.key}`} className="rounded-md border px-3 py-1.5 text-sm hover:border-primary">
                {r.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
