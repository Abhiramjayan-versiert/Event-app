"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Check, Undo2, X } from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { PromptActionButton } from "@/features/finance/finance-dialogs";
import {
  decideRevisionAction, reverseTransactionAction, setAllocationAction, setApprovalLimitAction, setEventBudgetAction, setTransactionStatusAction,
} from "@/features/finance/actions";
import { cn, formatCurrency, formatDate, titleCase } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/validations/finance";

export type LedgerRow = {
  id: string;
  txn_number: string;
  kind: string;
  direction: "in" | "out";
  category: string;
  amount: number;
  occurred_on: string;
  description: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  status: string;
  department: string | null;
  recorded_by: string | null;
  verified_by: string | null;
  expense_request_id: string | null;
};

export function LedgerTable({ eventId, rows, currency, canManage }: { eventId: string; rows: LedgerRow[]; currency: string; canManage: boolean }) {
  const columns: ColumnDef<LedgerRow, unknown>[] = [
    { accessorKey: "txn_number", header: "Txn", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
    { accessorKey: "occurred_on", header: "Date", cell: ({ getValue }) => formatDate(getValue<string>()) },
    { accessorKey: "kind", header: "Type", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
    { accessorKey: "category", header: "Category", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
    {
      id: "description",
      header: "Details",
      accessorFn: (r) => [r.description, r.payment_reference, r.department].filter(Boolean).join(" · "),
      cell: ({ row }) => (
        <div className="max-w-xs">
          {row.original.expense_request_id ? (
            <Link href={`/events/${eventId}/finance/expenses/${row.original.expense_request_id}`} className="truncate hover:underline">{row.original.description ?? "—"}</Link>
          ) : (
            <p className="truncate">{row.original.description ?? "—"}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">
            {[row.original.payment_method, row.original.payment_reference, row.original.department].filter(Boolean).join(" · ")}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className={cn("tabular font-medium", row.original.kind === "reversal" && "text-muted-foreground line-through decoration-transparent", row.original.direction === "in" ? "text-success-foreground dark:text-success" : "")}>
          {row.original.direction === "in" ? "+" : "−"}{formatCurrency(row.original.amount, currency)}
        </span>
      ),
    },
    { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: "recorded_by", header: "Recorded by", cell: ({ getValue }) => getValue<string | null>() ?? "System" },
    {
      id: "actions",
      header: "",
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        if (!canManage) return null;
        if (r.status === "pending") {
          return (
            <div className="flex gap-1">
              <ConfirmButton variant="ghost" size="icon-sm" aria-label="Verify" title="Verify this transaction?" description="Confirm the money was actually received. Verified entries count in all totals and can only be reversed later." confirmLabel="Verify" action={() => setTransactionStatusAction(eventId, r.id, "verified")}><Check /></ConfirmButton>
              <ConfirmButton variant="ghost" size="icon-sm" destructive aria-label="Reject" title="Reject this transaction?" description="Rejected entries never count in totals. This cannot be undone." confirmLabel="Reject" action={() => setTransactionStatusAction(eventId, r.id, "rejected")}><X /></ConfirmButton>
            </div>
          );
        }
        if (r.status === "verified" && r.kind !== "reversal") {
          return (
            <PromptActionButton
              variant="ghost"
              size="sm"
              label={<><Undo2 /> Reverse</>}
              title={`Reverse ${r.txn_number}?`}
              description="A reversal entry is added and the original stops counting in totals. Nothing is deleted."
              commentLabel="Reason"
              commentRequired
              confirmLabel="Reverse"
              onSubmit={(_, reason) => reverseTransactionAction(eventId, r.id, reason)}
            />
          );
        }
        return null;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={25}
      searchPlaceholder="Search transactions, references, departments…"
      filters={[
        { columnId: "kind", title: "Types", options: ["income", "expense", "refund", "reversal", "adjustment"].map((v) => ({ value: v, label: titleCase(v) })) },
        { columnId: "status", title: "Statuses", options: ["pending", "verified", "rejected", "reversed"].map((v) => ({ value: v, label: titleCase(v) })) },
      ]}
      exportConfig={{
        filename: "ledger",
        columns: [
          { key: "txn_number", header: "Transaction" }, { key: "occurred_on", header: "Date" }, { key: "kind", header: "Type" },
          { key: "direction", header: "Direction" }, { key: "category", header: "Category" }, { key: "amount", header: "Amount" },
          { key: "payment_method", header: "Method" }, { key: "payment_reference", header: "Reference" }, { key: "description", header: "Description" },
          { key: "department", header: "Department" }, { key: "status", header: "Status" }, { key: "recorded_by", header: "Recorded by" },
          { key: "verified_by", header: "Verified by" },
        ],
      }}
      emptyTitle="No transactions yet"
      emptyDescription="Verified income, expense payments, refunds and reversals appear here in order."
    />
  );
}

export type ExpenseRow = {
  id: string;
  request_number: string;
  title: string;
  department: string;
  category: string;
  requested_amount: number;
  approved_amount: number | null;
  paid_amount: number;
  status: string;
  submitted_by: string | null;
  created_at: string;
  required_by: string | null;
};

export function ExpensesTable({ eventId, rows, currency, toolbar }: { eventId: string; rows: ExpenseRow[]; currency: string; toolbar?: React.ReactNode }) {
  const router = useRouter();
  const departments = [...new Set(rows.map((r) => r.department))].sort();
  const columns: ColumnDef<ExpenseRow, unknown>[] = [
    { accessorKey: "request_number", header: "Request", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span> },
    {
      accessorKey: "title",
      header: "Title",
      enableHiding: false,
      cell: ({ row }) => <Link href={`/events/${eventId}/finance/expenses/${row.original.id}`} className="font-medium hover:underline">{row.original.title}</Link>,
    },
    { accessorKey: "department", header: "Department", filterFn: "equals" },
    { accessorKey: "category", header: "Category", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
    { accessorKey: "requested_amount", header: "Requested", cell: ({ getValue }) => <span className="tabular">{formatCurrency(getValue<number>(), currency)}</span> },
    { accessorKey: "approved_amount", header: "Approved", cell: ({ getValue }) => <span className="tabular">{getValue<number | null>() === null ? "—" : formatCurrency(getValue<number>(), currency)}</span> },
    { accessorKey: "paid_amount", header: "Paid", cell: ({ getValue }) => <span className="tabular">{formatCurrency(getValue<number>(), currency)}</span> },
    { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: "submitted_by", header: "Submitted by" },
    { accessorKey: "created_at", header: "Created", cell: ({ getValue }) => formatDate(getValue<string>()) },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      searchPlaceholder="Search requests…"
      onRowClick={(r) => router.push(`/events/${eventId}/finance/expenses/${r.id}`)}
      toolbar={toolbar}
      filters={[
        {
          columnId: "status",
          title: "Statuses",
          options: ["draft", "submitted", "under_review", "changes_requested", "forwarded", "approved", "partially_paid", "paid", "rejected", "cancelled"].map((v) => ({ value: v, label: titleCase(v) })),
        },
        ...(departments.length > 1 ? [{ columnId: "department", title: "Departments", options: departments.map((d) => ({ value: d, label: d })) }] : []),
        { columnId: "category", title: "Categories", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) })) },
      ]}
      exportConfig={{
        filename: "expense-requests",
        columns: [
          { key: "request_number", header: "Request" }, { key: "title", header: "Title" }, { key: "department", header: "Department" },
          { key: "category", header: "Category" }, { key: "requested_amount", header: "Requested" }, { key: "approved_amount", header: "Approved" },
          { key: "paid_amount", header: "Paid" }, { key: "status", header: "Status" }, { key: "submitted_by", header: "Submitted by" },
          { key: "created_at", header: "Created" }, { key: "required_by", header: "Required by" },
        ],
      }}
      emptyTitle="No expense requests"
      emptyDescription="Department heads submit expense requests; finance reviews and pays them."
    />
  );
}

export type AllocationRow = { id: string; name: string; allocated: number; approved: number; paid: number; pending: number };

export function BudgetPanel({
  eventId, currency, total, limit, rows, canManage,
}: { eventId: string; currency: string; total: number; limit: number; rows: AllocationRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [totalValue, setTotalValue] = useState(String(total));
  const [limitValue, setLimitValue] = useState(String(limit));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.id, String(r.allocated)])));
  const allocatedSum = rows.reduce((s, r) => s + Number(values[r.id] || 0), 0);

  const save = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total event budget</p>
          {canManage ? (
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} aria-label="Total budget" />
              <Button disabled={pending || Number(totalValue) === total} onClick={() => save(() => setEventBudgetAction(eventId, Number(totalValue)))}>Save</Button>
            </div>
          ) : (
            <p className="tabular text-2xl font-semibold">{formatCurrency(total, currency)}</p>
          )}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Allocated to departments</p>
          <p className={cn("tabular text-2xl font-semibold", allocatedSum > total && "text-destructive")}>{formatCurrency(allocatedSum, currency)}</p>
          <p className="text-xs text-muted-foreground">
            {allocatedSum > total ? `Over-allocated by ${formatCurrency(allocatedSum - total, currency)}` : `${formatCurrency(total - allocatedSum, currency)} unallocated`}
          </p>
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Final approval required above</p>
          {canManage ? (
            <div className="flex gap-2">
              <Input type="number" min="0" step="1" value={limitValue} onChange={(e) => setLimitValue(e.target.value)} aria-label="Approval limit" />
              <Button variant="outline" disabled={pending || Number(limitValue) === limit} onClick={() => save(() => setApprovalLimitAction(eventId, Number(limitValue)))}>Save</Button>
            </div>
          ) : (
            <p className="tabular text-2xl font-semibold">{formatCurrency(limit, currency)}</p>
          )}
          <p className="text-xs text-muted-foreground">Finance heads approve up to this amount; above it, holders of final approval decide.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5 font-medium">Department</th>
              <th className="px-3 py-2.5 font-medium">Allocated</th>
              <th className="px-3 py-2.5 font-medium">Approved</th>
              <th className="px-3 py-2.5 font-medium">Paid</th>
              <th className="px-3 py-2.5 font-medium">Pending requests</th>
              <th className="px-3 py-2.5 font-medium">Available</th>
              <th className="w-40 px-3 py-2.5 font-medium">Usage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const allocated = Number(values[r.id] || 0);
              const pct = allocated ? (100 * r.approved) / allocated : r.approved > 0 ? 100 : 0;
              const dirty = Number(values[r.id] || 0) !== r.allocated;
              return (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <div className="flex items-center gap-1">
                        <Input className="h-8 w-32" type="number" min="0" step="0.01" value={values[r.id]} onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))} aria-label={`${r.name} allocation`} />
                        {dirty ? <Button size="sm" disabled={pending} onClick={() => save(() => setAllocationAction(eventId, r.id, allocated))}>Save</Button> : null}
                      </div>
                    ) : (
                      <span className="tabular">{formatCurrency(r.allocated, currency)}</span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2">{formatCurrency(r.approved, currency)}</td>
                  <td className="tabular px-3 py-2">{formatCurrency(r.paid, currency)}</td>
                  <td className="tabular px-3 py-2">{formatCurrency(r.pending, currency)}</td>
                  <td className={cn("tabular px-3 py-2", allocated - r.approved < 0 && "text-destructive")}>{formatCurrency(allocated - r.approved, currency)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Progress value={pct} tone={pct >= 100 ? "destructive" : pct >= 75 ? "warning" : "lime"} />
                      <span className="tabular w-10 text-right text-xs">{Math.round(pct)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type RevisionRow = {
  id: string;
  department: string;
  previous_amount: number;
  requested_amount: number;
  reason: string;
  status: string;
  requested_by: string | null;
  created_at: string;
  decision_note: string | null;
};

export function RevisionsList({ eventId, rows, currency, canDecide }: { eventId: string; rows: RevisionRow[]; currency: string; canDecide: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No budget revision requests.</p>;
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">
              {r.department}: <span className="tabular">{formatCurrency(r.previous_amount, currency)} → {formatCurrency(r.requested_amount, currency)}</span>
            </p>
            <p className="text-sm text-muted-foreground">{r.reason}</p>
            <p className="text-xs text-muted-foreground">{r.requested_by ?? "—"} · {formatDate(r.created_at)}{r.decision_note ? ` · Note: ${r.decision_note}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status === "pending" ? "pending" : r.status} />
            {canDecide && r.status === "pending" ? (
              <>
                <PromptActionButton label="Approve" variant="default" title="Approve revision?" description="The new amount is applied immediately." commentLabel="Note (optional)" confirmLabel="Approve" onSubmit={(_, note) => decideRevisionAction(eventId, r.id, true, note)} />
                <PromptActionButton label="Reject" variant="outline" title="Reject revision?" commentLabel="Reason" commentRequired confirmLabel="Reject" onSubmit={(_, note) => decideRevisionAction(eventId, r.id, false, note)} />
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
