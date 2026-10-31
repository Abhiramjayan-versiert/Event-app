import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canInDepartment } from "@/lib/permissions";
import { Crumb } from "@/components/layout/shell-context";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseActions } from "@/features/finance/expense-actions";
import { EXPENSE_CATEGORIES } from "@/lib/validations/finance";
import { formatCurrency, formatDate, formatDateTime, titleCase } from "@/lib/utils";

export const metadata = { title: "Expense request" };

export default async function ExpensePage({ params }: { params: Promise<{ eventId: string; expenseId: string }> }) {
  const { eventId, expenseId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) notFound();
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("expense_requests")
    .select("*, department:departments(id, name), vendor:vendors(name), submitter:profiles!expense_requests_submitted_by_fkey(full_name, email)")
    .eq("id", expenseId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!e) notFound();

  const [history, payments, settings] = await Promise.all([
    supabase.from("expense_approvals").select("id, action, from_status, to_status, amount, comment, created_at, actor:profiles!expense_approvals_actor_id_fkey(full_name)").eq("expense_request_id", expenseId).order("created_at"),
    supabase.from("financial_transactions").select("id, txn_number, amount, occurred_on, payment_method, payment_reference, status, kind").eq("expense_request_id", expenseId).order("created_at"),
    supabase.from("event_settings").select("approval_limits").eq("event_id", eventId).maybeSingle(),
  ]);

  const cur = event.currency;
  const limit = Number((settings.data?.approval_limits as Record<string, unknown> | null)?.requires_final_approval_above ?? 10000);
  const deptId = e.department?.id ?? e.department_id;
  const canSubmit = e.submitted_by === access.user_id || can(permissions, "expenses.submit") || canInDepartment(permissions, deptId, "expenses.submit_department");
  const n = (v: unknown) => Number(v ?? 0);

  return (
    <div className="space-y-6">
      <Crumb id={e.id} label={e.request_number} />
      <PageHeader
        eyebrow={<span className="font-mono">{e.request_number}</span>}
        title={<span className="flex flex-wrap items-center gap-3">{e.title} <StatusBadge status={e.status} /></span>}
        description={`${e.department?.name ?? ""} · ${titleCase(e.category)} · requested ${formatDate(e.request_date)}${e.required_by ? ` · needed by ${formatDate(e.required_by)}` : ""}`}
      />

      <ExpenseActions
        eventId={eventId}
        expenseId={e.id}
        status={e.status}
        currency={cur}
        requested={n(e.requested_amount)}
        approved={e.approved_amount === null ? null : n(e.approved_amount)}
        paid={n(e.paid_amount)}
        limit={limit}
        canEditOwn={e.submitted_by === access.user_id}
        canSubmit={canSubmit}
        canReview={can(permissions, "finance.review") || can(permissions, "finance.approve")}
        canFinalApprove={can(permissions, "finance.approve")}
        canManage={can(permissions, "finance.manage")}
        department={{ id: deptId, name: e.department?.name ?? "" }}
        draft={{
          department_id: deptId, title: e.title, requested_amount: n(e.requested_amount), description: e.description ?? "",
          required_by: e.required_by ?? "", vendor_id: e.vendor_id ?? "",
          category: (EXPENSE_CATEGORIES as readonly string[]).includes(e.category) ? (e.category as (typeof EXPENSE_CATEGORIES)[number]) : "miscellaneous",
        }}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Amounts</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <Line label="Requested" value={formatCurrency(e.requested_amount, cur)} />
            <Line label="Approved" value={e.approved_amount === null ? "—" : formatCurrency(e.approved_amount, cur)} />
            <Line label="Paid" value={formatCurrency(e.paid_amount, cur)} />
            <Line label="Outstanding" value={e.approved_amount === null ? "—" : formatCurrency(n(e.approved_amount) - n(e.paid_amount), cur)} strong />
            <p className="pt-2 text-xs text-muted-foreground">Final approval required above {formatCurrency(limit, cur)}.</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <Line label="Submitted by" value={e.submitter?.full_name || e.submitter?.email || "—"} />
            <Line label="Vendor" value={e.vendor?.name ?? "—"} />
            <Line label="Submitted at" value={e.submitted_at ? formatDateTime(e.submitted_at) : "Not submitted"} />
            {e.description ? <p className="whitespace-pre-wrap pt-2 text-muted-foreground">{e.description}</p> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Approval history</CardTitle></CardHeader>
          <CardContent>
            {(history.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No actions yet — this request is a draft.</p>
            ) : (
              <ol className="relative space-y-4 border-l pl-5">
                {history.data!.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <p className="text-sm font-medium">
                      {titleCase(h.action)}{h.amount !== null ? ` · ${formatCurrency(h.amount, cur)}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {h.actor?.full_name ?? "System"} · {formatDateTime(h.created_at)} · {h.from_status ? `${titleCase(h.from_status)} → ` : ""}{titleCase(h.to_status)}
                    </p>
                    {h.comment ? <p className="mt-1 rounded-md bg-muted px-2 py-1 text-sm">{h.comment}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
          <CardContent>
            {(payments.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded.</p>
            ) : (
              <ul className="divide-y">
                {payments.data!.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <p className="font-mono text-xs">{p.txn_number}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(p.occurred_on)} · {p.payment_method ?? "—"}{p.payment_reference ? ` · ${p.payment_reference}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular font-medium">{formatCurrency(p.amount, cur)}</p>
                      <StatusBadge status={p.status} />
                    </div>
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

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "tabular font-semibold" : "tabular"}>{value}</span>
    </div>
  );
}
