import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleDollarSign, ClipboardCheck, HandCoins, PiggyBank, Receipt, RotateCcw, TrendingDown, Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can, departmentIdsWith } from "@/lib/permissions";
import type { FinanceSummary } from "@/features/dashboard/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/error-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RealtimeRefresh } from "@/components/dashboard/realtime-refresh";
import { BudgetRevisionDialog, ExpenseRequestDialog, RecordIncomeDialog } from "@/features/finance/finance-dialogs";
import {
  BudgetPanel, ExpensesTable, LedgerTable, RevisionsList, type AllocationRow, type ExpenseRow, type LedgerRow, type RevisionRow,
} from "@/features/finance/finance-tables";
import { cn, formatCurrency } from "@/lib/utils";

export const metadata = { title: "Finance" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "ledger", label: "Ledger" },
  { key: "expenses", label: "Expenses" },
  { key: "budget", label: "Budget" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type DeptOverview = { id: string; name: string; status: string; budget: { allocated: number; approved: number; paid: number } | null };

export default async function FinancePage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { eventId } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === tabParam)?.key ?? "overview";
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "finance.view") && !can(permissions, "budgets.manage")) notFound();
  const cur = event.currency;
  const supabase = await createClient();

  const [summaryRes, ledgerRes, expenseRes, deptRes, revisionRes, budgetRes, settingsRes, vendorRes] = await Promise.all([
    supabase.rpc("event_financial_summary", { p_event: eventId }),
    supabase
      .from("financial_transactions")
      .select("id, txn_number, kind, direction, category, amount, occurred_on, description, payment_method, payment_reference, status, expense_request_id, department:departments(name), recorder:profiles!financial_transactions_recorded_by_fkey(full_name), verifier:profiles!financial_transactions_verified_by_fkey(full_name)")
      .eq("event_id", eventId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("expense_requests")
      .select("id, request_number, title, category, requested_amount, approved_amount, paid_amount, status, created_at, required_by, department:departments(name), submitter:profiles!expense_requests_submitted_by_fkey(full_name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    supabase.rpc("event_departments_overview", { p_event: eventId }),
    supabase
      .from("budget_revisions")
      .select("id, previous_amount, requested_amount, reason, status, created_at, decision_note, department:departments(name), requester:profiles!budget_revisions_requested_by_fkey(full_name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    supabase.from("budgets").select("total_amount").eq("event_id", eventId).maybeSingle(),
    supabase.from("event_settings").select("approval_limits").eq("event_id", eventId).maybeSingle(),
    supabase.from("vendors").select("id, name").eq("event_id", eventId).eq("status", "active").order("name"),
  ]);
  if (summaryRes.error) return <ErrorState title="Could not load finances" message={summaryRes.error.message} />;

  const f = summaryRes.data as unknown as FinanceSummary;
  const n = (v: unknown) => Number(v ?? 0);
  const ledger: LedgerRow[] = (ledgerRes.data ?? []).map((t) => ({
    id: t.id, txn_number: t.txn_number, kind: t.kind, direction: t.direction, category: t.category, amount: n(t.amount),
    occurred_on: t.occurred_on, description: t.description, payment_method: t.payment_method, payment_reference: t.payment_reference,
    status: t.status, department: t.department?.name ?? null, recorded_by: t.recorder?.full_name ?? null, verified_by: t.verifier?.full_name ?? null,
    expense_request_id: t.expense_request_id,
  }));
  const expenses: ExpenseRow[] = (expenseRes.data ?? []).map((e) => ({
    id: e.id, request_number: e.request_number, title: e.title, department: e.department?.name ?? "—", category: e.category,
    requested_amount: n(e.requested_amount), approved_amount: e.approved_amount === null ? null : n(e.approved_amount), paid_amount: n(e.paid_amount),
    status: e.status, submitted_by: e.submitter?.full_name ?? null, created_at: e.created_at, required_by: e.required_by,
  }));
  const depts = ((deptRes.data as unknown as DeptOverview[]) ?? []).filter((d) => d.status === "active");
  const pendingByDept = new Map<string, number>();
  for (const e of expenseRes.data ?? []) {
    if (["submitted", "under_review", "forwarded", "changes_requested"].includes(e.status)) {
      pendingByDept.set(e.department?.name ?? "", (pendingByDept.get(e.department?.name ?? "") ?? 0) + n(e.requested_amount));
    }
  }
  const allocations: AllocationRow[] = depts.map((d) => ({
    id: d.id, name: d.name, allocated: n(d.budget?.allocated), approved: n(d.budget?.approved), paid: n(d.budget?.paid), pending: pendingByDept.get(d.name) ?? 0,
  }));
  const revisions: RevisionRow[] = (revisionRes.data ?? []).map((r) => ({
    id: r.id, department: r.department?.name ?? "Total event budget", previous_amount: n(r.previous_amount), requested_amount: n(r.requested_amount),
    reason: r.reason, status: r.status, requested_by: r.requester?.full_name ?? null, created_at: r.created_at, decision_note: r.decision_note,
  }));

  const submitDepts = can(permissions, "expenses.submit")
    ? depts.map((d) => ({ id: d.id, name: d.name }))
    : depts.filter((d) => departmentIdsWith(permissions, "expenses.submit_department").includes(d.id)).map((d) => ({ id: d.id, name: d.name }));
  const limit = n((settingsRes.data?.approval_limits as Record<string, unknown> | null)?.requires_final_approval_above ?? 10000);
  const awaiting = expenses.filter((e) => ["submitted", "under_review", "forwarded"].includes(e.status));
  const money = (v: number) => formatCurrency(v, cur);

  return (
    <div className="space-y-6">
      <RealtimeRefresh eventId={eventId} tables={["financial_transactions", "expense_requests"]} />
      <PageHeader
        title="Finance"
        description="Every verified rupee in and out of the event. Pending entries and commitments are never counted as cash."
        actions={
          <>
            {submitDepts.length ? (
              <ExpenseRequestDialog eventId={eventId} currency={cur} departments={submitDepts} vendors={vendorRes.data ?? []} trigger={<Button variant="outline">New expense request</Button>} />
            ) : null}
            {can(permissions, "finance.manage") ? <RecordIncomeDialog eventId={eventId} currency={cur} /> : null}
          </>
        }
      />

      <nav className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1" aria-label="Finance sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/events/${eventId}/finance${t.key === "overview" ? "" : `?tab=${t.key}`}`}
            className={cn("whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium", tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
            {t.key === "expenses" && awaiting.length ? <span className="ml-1.5 rounded bg-ink px-1.5 text-[10px] text-lime">{awaiting.length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total income received" value={money(f.total_income_received)} hint="Verified only" icon={CircleDollarSign} highlight />
            <StatCard label="Registration collections" value={money(f.registration_income)} icon={Receipt} />
            <StatCard label="Sponsorship collections" value={money(f.sponsorship_income)} hint={`${money(f.outstanding_sponsorship)} outstanding`} icon={HandCoins} />
            <StatCard label="Other income" value={money(f.other_income)} icon={CircleDollarSign} />
            <StatCard label="Expenditure paid" value={money(f.expenditure_paid)} icon={TrendingDown} />
            <StatCard label="Approved, unpaid" value={money(f.approved_unpaid)} hint="Liabilities" icon={ClipboardCheck} />
            <StatCard label="Pending requests" value={money(f.pending_expense_amount)} hint={`${f.pending_expense_count} awaiting decision`} icon={ClipboardCheck} />
            <StatCard label="Net cash position" value={money(f.net_cash_position)} hint={`Refunds paid: ${money(f.refunds_paid)}`} icon={Wallet} highlight />
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><PiggyBank className="size-4" /> Budget</CardTitle>
                <CardDescription>{money(f.total_budget)} total · {money(f.allocated_budget)} allocated · {money(f.approved_expenses_total)} approved</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {allocations.filter((a) => a.allocated > 0 || a.approved > 0).length === 0 ? (
                  <p className="text-muted-foreground">No department budgets yet. Allocate them in the Budget tab.</p>
                ) : (
                  allocations.filter((a) => a.allocated > 0 || a.approved > 0).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-3">
                      <span className="truncate">{a.name}</span>
                      <span className={cn("tabular", a.approved > a.allocated && "text-destructive")}>{money(a.approved)} / {money(a.allocated)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><RotateCcw className="size-4" /> Awaiting decision</CardTitle>
                <CardDescription>Expense requests submitted, under review or forwarded.</CardDescription>
              </CardHeader>
              <CardContent>
                {awaiting.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is waiting for a decision.</p>
                ) : (
                  <ul className="divide-y">
                    {awaiting.slice(0, 8).map((e) => (
                      <li key={e.id}>
                        <Link href={`/events/${eventId}/finance/expenses/${e.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-80">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{e.title}</span>
                            <span className="text-xs text-muted-foreground">{e.request_number} · {e.department}</span>
                          </span>
                          <span className="tabular font-medium">{money(e.requested_amount)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "ledger" ? <LedgerTable eventId={eventId} rows={ledger} currency={cur} canManage={can(permissions, "finance.manage")} /> : null}

      {tab === "expenses" ? <ExpensesTable eventId={eventId} rows={expenses} currency={cur} /> : null}

      {tab === "budget" ? (
        <div className="space-y-6">
          <BudgetPanel eventId={eventId} currency={cur} total={n(budgetRes.data?.total_amount)} limit={limit} rows={allocations} canManage={can(permissions, "budgets.manage")} />
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Budget revision requests</h2>
              <BudgetRevisionDialog
                eventId={eventId}
                departments={depts.map((d) => ({ id: d.id, name: d.name }))}
                currentAmounts={{ event: n(budgetRes.data?.total_amount), ...Object.fromEntries(allocations.map((a) => [a.id, a.allocated])) }}
                trigger={<Button variant="outline" size="sm">Request revision</Button>}
              />
            </div>
            <RevisionsList eventId={eventId} rows={revisions} currency={cur} canDecide={can(permissions, "budgets.manage")} />
          </section>
        </div>
      ) : null}
    </div>
  );
}
