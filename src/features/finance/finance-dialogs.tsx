"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import {
  EXPENSE_CATEGORIES, MANUAL_INCOME_CATEGORIES, PAYMENT_METHODS, expenseSchema, incomeSchema, paymentSchema, revisionSchema,
  type ExpenseInput, type IncomeInput, type PaymentInput, type RevisionInput,
} from "@/lib/validations/finance";
import {
  createExpenseAction, recordExpensePaymentAction, recordIncomeAction, requestBudgetRevisionAction, updateExpenseDraftAction,
} from "@/features/finance/actions";
import type { ActionResult } from "@/lib/actions";
import { titleCase } from "@/lib/utils";

const today = () => new Date().toISOString().slice(0, 10);

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, onOk?: (r: ActionResult<unknown>) => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message ?? "Saved");
      onOk?.(result);
      router.refresh();
    });
  return { pending, run };
}

export function RecordIncomeDialog({ eventId, currency }: { eventId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const form = useForm<IncomeInput>({
    resolver: zodResolver(incomeSchema),
    defaultValues: { category: "offline_registration", amount: undefined as unknown as number, occurred_on: today(), payment_method: "UPI", payment_reference: "", description: "", notes: "", verified: true },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit((v) => run(() => recordIncomeAction(eventId, v), () => { setOpen(false); form.reset(); }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Record income</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record income</DialogTitle>
          <DialogDescription>Online registration payments and sponsorship payments are booked automatically by their own workflows.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="i-cat" label="Category" error={errors.category?.message}>
            <NativeSelect id="i-cat" {...form.register("category")}>
              {MANUAL_INCOME_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="i-amount" label={`Amount (${currency})`} error={errors.amount?.message} required>
            <Input id="i-amount" type="number" step="0.01" min="0" {...form.register("amount", { valueAsNumber: true })} />
          </FormField>
          <FormField id="i-date" label="Received on" error={errors.occurred_on?.message} required>
            <Input id="i-date" type="date" {...form.register("occurred_on")} />
          </FormField>
          <FormField id="i-method" label="Payment method">
            <NativeSelect id="i-method" {...form.register("payment_method")}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="i-ref" label="Reference / UTR" error={errors.payment_reference?.message} className="sm:col-span-2">
            <Input id="i-ref" {...form.register("payment_reference")} />
          </FormField>
          <FormField id="i-desc" label="Description" error={errors.description?.message} className="sm:col-span-2">
            <Input id="i-desc" placeholder="e.g. Food stall booking — Block A" {...form.register("description")} />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
            <Label htmlFor="i-verified">Money already received and checked (mark verified)</Label>
            <Controller control={form.control} name="verified" render={({ field }) => <Switch id="i-verified" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExpenseRequestDialog({
  eventId, currency, departments, vendors = [], trigger, expenseId, defaults,
}: {
  eventId: string;
  currency: string;
  departments: { id: string; name: string }[];
  vendors?: { id: string; name: string }[];
  trigger: React.ReactNode;
  expenseId?: string;
  defaults?: Partial<ExpenseInput>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const form = useForm<ExpenseInput>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      department_id: departments.length === 1 ? departments[0].id : "", title: "", category: "miscellaneous",
      requested_amount: undefined as unknown as number, vendor_id: "", description: "", required_by: "", submit: true, ...defaults,
    },
  });
  const { errors } = form.formState;
  const submitWith = (submit: boolean) =>
    form.handleSubmit((v) =>
      run(
        () => (expenseId ? updateExpenseDraftAction(eventId, expenseId, { ...v, submit }) : createExpenseAction(eventId, { ...v, submit })),
        (r) => {
          setOpen(false);
          const id = expenseId ?? (r.ok ? (r.data as { id: string } | undefined)?.id : undefined);
          if (id && !expenseId) router.push(`/events/${eventId}/finance/expenses/${id}`);
        },
      ),
    );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{expenseId ? "Edit expense request" : "New expense request"}</DialogTitle>
          <DialogDescription>Finance reviews submitted requests. Amounts above the approval limit need final approval.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(e) => e.preventDefault()}>
          <FormField id="e-dept" label="Department" error={errors.department_id?.message} required>
            <NativeSelect id="e-dept" disabled={Boolean(expenseId)} {...form.register("department_id")}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="e-cat" label="Category">
            <NativeSelect id="e-cat" {...form.register("category")}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="e-title" label="Title" error={errors.title?.message} required className="sm:col-span-2">
            <Input id="e-title" placeholder="e.g. Sound system rental" {...form.register("title")} />
          </FormField>
          <FormField id="e-amount" label={`Amount (${currency})`} error={errors.requested_amount?.message} required>
            <Input id="e-amount" type="number" step="0.01" min="0" {...form.register("requested_amount", { valueAsNumber: true })} />
          </FormField>
          <FormField id="e-req" label="Payment needed by" error={errors.required_by?.message}>
            <Input id="e-req" type="date" {...form.register("required_by")} />
          </FormField>
          {vendors.length ? (
            <FormField id="e-vendor" label="Vendor" className="sm:col-span-2">
              <NativeSelect id="e-vendor" {...form.register("vendor_id")}>
                <option value="">None</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField id="e-desc" label="Description / justification" error={errors.description?.message} className="sm:col-span-2">
            <Textarea id="e-desc" rows={3} {...form.register("description")} />
          </FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" disabled={pending} onClick={submitWith(false)}>Save draft</Button>
            <Button type="button" loading={pending} onClick={submitWith(true)}>Submit for review</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Generic confirm-with-input dialog for workflow steps (approve with amount, reject with reason …). */
export function PromptActionButton({
  label, title, description, amountLabel, defaultAmount, maxAmount, commentLabel, commentRequired, confirmLabel, onSubmit, variant = "outline", size = "sm",
}: {
  label: React.ReactNode;
  title: string;
  description?: string;
  amountLabel?: string;
  defaultAmount?: number;
  maxAmount?: number;
  commentLabel?: string;
  commentRequired?: boolean;
  confirmLabel?: string;
  onSubmit: (amount: number | null, comment: string) => Promise<ActionResult<unknown>>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount?.toString() ?? "");
  const [comment, setComment] = useState("");
  const { pending, run } = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = amountLabel ? Number(amount) : null;
    if (amountLabel && (!n || n <= 0 || (maxAmount !== undefined && n > maxAmount))) return void toast.error(`Enter an amount between 0 and ${maxAmount ?? "∞"}.`);
    if (commentRequired && !comment.trim()) return void toast.error("Please add a comment.");
    run(() => onSubmit(n, comment.trim()), () => { setOpen(false); setComment(""); });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={variant} size={size}>{label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {amountLabel ? (
            <FormField id="p-amount" label={amountLabel} required>
              <Input id="p-amount" type="number" step="0.01" min="0" max={maxAmount} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </FormField>
          ) : null}
          {commentLabel ? (
            <FormField id="p-comment" label={commentLabel} required={commentRequired}>
              <Textarea id="p-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending} variant={variant === "destructive" ? "destructive" : "default"}>{confirmLabel ?? "Confirm"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RecordPaymentDialog({ eventId, expenseId, outstanding, currency }: { eventId: string; expenseId: string; outstanding: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const form = useForm<PaymentInput>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { amount: outstanding, paid_on: today(), method: "UPI", reference: "", notes: "" },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit((v) => run(() => recordExpensePaymentAction(eventId, expenseId, v), () => setOpen(false)));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Record payment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Outstanding approved amount: {outstanding.toLocaleString("en-IN")} {currency}. Partial payments are allowed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="pay-amount" label="Amount paid" error={errors.amount?.message} required>
            <Input id="pay-amount" type="number" step="0.01" min="0" max={outstanding} {...form.register("amount", { valueAsNumber: true })} />
          </FormField>
          <FormField id="pay-date" label="Paid on" error={errors.paid_on?.message} required>
            <Input id="pay-date" type="date" {...form.register("paid_on")} />
          </FormField>
          <FormField id="pay-method" label="Method">
            <NativeSelect id="pay-method" {...form.register("method")}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="pay-ref" label="Reference / UTR" error={errors.reference?.message}>
            <Input id="pay-ref" {...form.register("reference")} />
          </FormField>
          <FormField id="pay-notes" label="Notes" className="sm:col-span-2">
            <Textarea id="pay-notes" rows={2} {...form.register("notes")} />
          </FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Record payment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetRevisionDialog({
  eventId, departments, currentAmounts, trigger, fixedDepartmentId,
}: {
  eventId: string;
  departments: { id: string; name: string }[];
  currentAmounts: Record<string, number>;
  trigger: React.ReactNode;
  fixedDepartmentId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  const form = useForm<RevisionInput>({
    resolver: zodResolver(revisionSchema),
    defaultValues: { department_id: fixedDepartmentId ?? "", requested_amount: undefined as unknown as number, reason: "" },
  });
  const dept = form.watch("department_id");
  const { errors } = form.formState;
  const submit = form.handleSubmit((v) => run(() => requestBudgetRevisionAction(eventId, v), () => { setOpen(false); form.reset(); }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request budget revision</DialogTitle>
          <DialogDescription>Current: {(currentAmounts[dept || "event"] ?? 0).toLocaleString("en-IN")}. Budget managers will be notified.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!fixedDepartmentId ? (
            <FormField id="r-dept" label="Budget">
              <NativeSelect id="r-dept" {...form.register("department_id")}>
                <option value="">Total event budget</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </NativeSelect>
            </FormField>
          ) : null}
          <FormField id="r-amount" label="Requested new amount" error={errors.requested_amount?.message} required>
            <Input id="r-amount" type="number" step="0.01" min="0" {...form.register("requested_amount", { valueAsNumber: true })} />
          </FormField>
          <FormField id="r-reason" label="Reason" error={errors.reason?.message} required>
            <Textarea id="r-reason" rows={3} {...form.register("reason")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
