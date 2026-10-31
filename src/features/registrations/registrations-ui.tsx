"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { DataTable } from "@/components/tables/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { FormField } from "@/components/shared/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { PromptActionButton } from "@/features/finance/finance-dialogs";
import {
  createOfflineRegistrationAction, recordOfflinePaymentAction, recordRefundAction, saveCompetitionAction, setRegistrationStatusAction,
} from "@/features/registrations/actions";
import { competitionSchema, offlineRegistrationSchema, type CompetitionInput, type OfflineRegistrationInput } from "@/lib/validations/registration";
import { PAYMENT_METHODS } from "@/lib/validations/finance";
import { formatCurrency, formatDate, titleCase } from "@/lib/utils";

export type CompetitionOption = { id: string; name: string; fee: number; category: string; registration_type: string };

export function OfflineRegistrationDialog({ eventId, currency, competitions }: { eventId: string; currency: string; competitions: CompetitionOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<OfflineRegistrationInput>({
    resolver: zodResolver(offlineRegistrationSchema),
    defaultValues: {
      participant_name: "", email: "", phone: "", participant_college: "", course: "", academic_year: "", competition_id: "",
      registration_type: "individual", team_name: "", team_members: "", discount: 0, paid_now: true, payment_method: "Cash", payment_reference: "",
    },
  });
  const { errors } = form.formState;
  const comp = competitions.find((c) => c.id === form.watch("competition_id"));
  const type = form.watch("registration_type");
  const submit = form.handleSubmit((v) =>
    startTransition(async () => {
      const r = await createOfflineRegistrationAction(eventId, v);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Added");
      setOpen(false);
      form.reset();
      router.push(`/events/${eventId}/registrations/${(r.data as { id: string }).id}`);
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button disabled={competitions.length === 0} title={competitions.length === 0 ? "Add a competition first" : undefined}><Plus /> Offline registration</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add offline registration</DialogTitle>
          <DialogDescription>For walk-ins and desk registrations. The fee comes from the selected competition.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="or-name" label="Participant name" error={errors.participant_name?.message} required><Input id="or-name" {...form.register("participant_name")} /></FormField>
          <FormField id="or-email" label="Email" error={errors.email?.message} required><Input id="or-email" type="email" {...form.register("email")} /></FormField>
          <FormField id="or-phone" label="Phone" error={errors.phone?.message}><Input id="or-phone" type="tel" {...form.register("phone")} /></FormField>
          <FormField id="or-college" label="College" error={errors.participant_college?.message}><Input id="or-college" {...form.register("participant_college")} /></FormField>
          <FormField id="or-course" label="Department / course"><Input id="or-course" {...form.register("course")} /></FormField>
          <FormField id="or-year" label="Academic year"><Input id="or-year" {...form.register("academic_year")} /></FormField>
          <FormField id="or-comp" label="Competition" error={errors.competition_id?.message} required>
            <NativeSelect id="or-comp" {...form.register("competition_id")}>
              <option value="">Select…</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name} — {formatCurrency(c.fee, currency)}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="or-type" label="Type">
            <NativeSelect id="or-type" {...form.register("registration_type")}>
              <option value="individual">Individual</option>
              <option value="team">Team</option>
            </NativeSelect>
          </FormField>
          {type === "team" ? (
            <>
              <FormField id="or-team" label="Team name" error={errors.team_name?.message} required><Input id="or-team" {...form.register("team_name")} /></FormField>
              <FormField id="or-members" label="Other members (one per line)"><Textarea id="or-members" rows={3} {...form.register("team_members")} /></FormField>
            </>
          ) : null}
          <FormField id="or-discount" label={`Discount (${currency})`} error={errors.discount?.message}>
            <Input id="or-discount" type="number" min="0" step="0.01" {...form.register("discount", { valueAsNumber: true })} />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <Label htmlFor="or-paid">Paid now ({formatCurrency(Math.max((comp?.fee ?? 0) - (form.watch("discount") || 0), 0), currency)})</Label>
            <Controller control={form.control} name="paid_now" render={({ field }) => <Switch id="or-paid" checked={field.value} onCheckedChange={field.onChange} />} />
          </div>
          {form.watch("paid_now") ? (
            <>
              <FormField id="or-method" label="Payment method">
                <NativeSelect id="or-method" {...form.register("payment_method")}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</NativeSelect>
              </FormField>
              <FormField id="or-ref" label="Reference / receipt no."><Input id="or-ref" {...form.register("payment_reference")} /></FormField>
            </>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Add registration</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CompetitionDialog({ eventId, competitionId, defaults, trigger }: { eventId: string; competitionId?: string; defaults?: CompetitionInput; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<CompetitionInput>({
    resolver: zodResolver(competitionSchema),
    defaultValues: defaults ?? { name: "", code: "", category: "general", description: "", fee: 0, registration_type: "individual", team_min: 1, team_max: 1, capacity: null, venue: "", rules_url: "", is_active: true },
  });
  const { errors } = form.formState;
  const submit = form.handleSubmit((v) =>
    startTransition(async () => {
      const r = await saveCompetitionAction(eventId, competitionId ?? null, v);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{competitionId ? "Edit competition" : "New competition"}</DialogTitle>
          <DialogDescription>The public website registers participants by competition code. Fees are always taken from here.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="c-name" label="Name" error={errors.name?.message} required><Input id="c-name" {...form.register("name")} /></FormField>
          <FormField id="c-code" label="Code" error={errors.code?.message} hint="e.g. HACK, DANCE-SOLO" required><Input id="c-code" className="uppercase" {...form.register("code")} /></FormField>
          <FormField id="c-cat" label="Category" error={errors.category?.message} required><Input id="c-cat" {...form.register("category")} /></FormField>
          <FormField id="c-fee" label="Fee" error={errors.fee?.message}><Input id="c-fee" type="number" min="0" step="0.01" {...form.register("fee", { valueAsNumber: true })} /></FormField>
          <FormField id="c-type" label="Type">
            <NativeSelect id="c-type" {...form.register("registration_type")}><option value="individual">Individual</option><option value="team">Team</option></NativeSelect>
          </FormField>
          <FormField id="c-cap" label="Capacity (optional)">
            <Input id="c-cap" type="number" min="1" {...form.register("capacity", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} />
          </FormField>
          {form.watch("registration_type") === "team" ? (
            <>
              <FormField id="c-min" label="Min team size" error={errors.team_min?.message}><Input id="c-min" type="number" min="1" {...form.register("team_min", { valueAsNumber: true })} /></FormField>
              <FormField id="c-max" label="Max team size" error={errors.team_max?.message}><Input id="c-max" type="number" min="1" {...form.register("team_max", { valueAsNumber: true })} /></FormField>
            </>
          ) : null}
          <FormField id="c-venue" label="Venue"><Input id="c-venue" {...form.register("venue")} /></FormField>
          <FormField id="c-rules" label="Rules URL"><Input id="c-rules" {...form.register("rules_url")} /></FormField>
          <FormField id="c-desc" label="Description" className="sm:col-span-2"><Textarea id="c-desc" rows={2} {...form.register("description")} /></FormField>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Controller control={form.control} name="is_active" render={({ field }) => <Switch id="c-active" checked={field.value} onCheckedChange={field.onChange} />} />
            <Label htmlFor="c-active">Open for registration</Label>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export type RegistrationRow = {
  id: string;
  registration_number: string;
  participant_name: string;
  email: string;
  phone: string | null;
  participant_college: string | null;
  category: string;
  registration_type: string;
  team_name: string | null;
  source: string;
  status: string;
  payment_status: string;
  payable_amount: number;
  amount_paid: number;
  created_at: string;
  is_test: boolean;
};

export function RegistrationsTable({ eventId, rows, currency, canExport }: { eventId: string; rows: RegistrationRow[]; currency: string; canExport: boolean }) {
  const router = useRouter();
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  const colleges = [...new Set(rows.map((r) => r.participant_college ?? "").filter(Boolean))].sort();
  const columns: ColumnDef<RegistrationRow, unknown>[] = [
    { accessorKey: "registration_number", header: "Reg. no", cell: ({ row }) => <span className="font-mono text-xs">{row.original.registration_number}{row.original.is_test ? <Badge variant="warning" className="ml-1">Test</Badge> : null}</span> },
    {
      accessorKey: "participant_name",
      header: "Participant",
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-0">
          <Link href={`/events/${eventId}/registrations/${row.original.id}`} className="font-medium hover:underline">{row.original.participant_name}</Link>
          <p className="truncate text-xs text-muted-foreground">{row.original.email}{row.original.phone ? ` · ${row.original.phone}` : ""}</p>
        </div>
      ),
    },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "phone", header: "Phone" },
    { accessorKey: "participant_college", header: "College", filterFn: "equals", cell: ({ getValue }) => getValue<string | null>() ?? "—" },
    { accessorKey: "category", header: "Category", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
    { accessorKey: "team_name", header: "Team", cell: ({ getValue }) => getValue<string | null>() ?? "—" },
    { accessorKey: "source", header: "Source", filterFn: "equals", cell: ({ getValue }) => titleCase(getValue<string>()) },
    { accessorKey: "payable_amount", header: "Amount", cell: ({ row }) => <span className="tabular">{formatCurrency(row.original.payable_amount, currency)}</span> },
    { accessorKey: "payment_status", header: "Payment", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: "status", header: "Status", filterFn: "equals", cell: ({ getValue }) => <StatusBadge status={getValue<string>()} /> },
    { accessorKey: "created_at", header: "Registered", cell: ({ getValue }) => formatDate(getValue<string>()) },
  ];
  return (
    <DataTable
      columns={columns}
      data={rows}
      pageSize={25}
      onRowClick={(r) => router.push(`/events/${eventId}/registrations/${r.id}`)}
      searchPlaceholder="Search name, email, phone or registration number…"
      filters={[
        { columnId: "payment_status", title: "Payment statuses", options: ["not_required", "pending", "paid", "failed", "refunded", "partially_refunded", "cancelled"].map((v) => ({ value: v, label: titleCase(v) })) },
        { columnId: "status", title: "Statuses", options: ["pending", "confirmed", "waitlisted", "cancelled"].map((v) => ({ value: v, label: titleCase(v) })) },
        ...(categories.length > 1 ? [{ columnId: "category", title: "Categories", options: categories.map((c) => ({ value: c, label: titleCase(c) })) }] : []),
        ...(colleges.length > 1 ? [{ columnId: "participant_college", title: "Colleges", options: colleges.map((c) => ({ value: c, label: c })) }] : []),
        { columnId: "source", title: "Sources", options: ["website", "api", "offline", "manual"].map((v) => ({ value: v, label: titleCase(v) })) },
      ]}
      exportConfig={
        canExport
          ? {
              filename: "registrations",
              columns: [
                { key: "registration_number", header: "Registration" }, { key: "participant_name", header: "Name" }, { key: "email", header: "Email" },
                { key: "phone", header: "Phone" }, { key: "participant_college", header: "College" }, { key: "category", header: "Category" },
                { key: "registration_type", header: "Type" }, { key: "team_name", header: "Team" }, { key: "source", header: "Source" },
                { key: "payable_amount", header: "Amount" }, { key: "amount_paid", header: "Paid" }, { key: "payment_status", header: "Payment" },
                { key: "status", header: "Status" }, { key: "created_at", header: "Registered at" },
              ],
            }
          : undefined
      }
      emptyTitle="No registrations yet"
      emptyDescription="Registrations from the event website and the registration desk appear here in real time."
    />
  );
}

export function RegistrationActions({
  eventId, regId, status, paymentStatus, balance, refundable, currency, canManage, canRefund, isTest,
}: {
  eventId: string; regId: string; status: string; paymentStatus: string; balance: number; refundable: number; currency: string;
  canManage: boolean; canRefund: boolean; isTest: boolean;
}) {
  const [method, setMethod] = useState<string>("Cash");
  const items: React.ReactNode[] = [];
  if (canManage && status !== "cancelled") {
    if (status !== "confirmed") {
      items.push(<ConfirmButton key="confirm" size="sm" title="Confirm registration?" description="Use this after verifying the participant's details." confirmLabel="Confirm" action={() => setRegistrationStatusAction(eventId, regId, "confirmed")}>Confirm</ConfirmButton>);
    }
    if (status === "pending") {
      items.push(<ConfirmButton key="wait" variant="outline" size="sm" title="Move to waitlist?" description="The participant stays registered but unconfirmed." confirmLabel="Waitlist" action={() => setRegistrationStatusAction(eventId, regId, "waitlisted")}>Waitlist</ConfirmButton>);
    }
    if (balance > 0 && !isTest) {
      items.push(
        <div key="pay" className="flex items-center gap-1">
          <NativeSelect aria-label="Payment method" className="h-8 w-36" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </NativeSelect>
          <PromptActionButton
            label="Record payment"
            variant="default"
            title="Record offline payment"
            description={`Balance due: ${formatCurrency(balance, currency)} via ${method}. Finance verifies it in the ledger.`}
            amountLabel="Amount received"
            defaultAmount={balance}
            maxAmount={balance}
            commentLabel="Reference / receipt no. (optional)"
            confirmLabel="Record"
            onSubmit={(amount, ref) => recordOfflinePaymentAction(eventId, regId, amount ?? 0, method, ref)}
          />
        </div>,
      );
    }
    items.push(
      <PromptActionButton key="cancel" variant="destructive" label="Cancel registration" title="Cancel registration" description={paymentStatus === "paid" ? "Any refund is recorded separately by finance." : undefined} commentLabel="Reason" commentRequired confirmLabel="Cancel registration" onSubmit={(_, reason) => setRegistrationStatusAction(eventId, regId, "cancelled", reason)} />,
    );
  }
  if (canRefund && refundable > 0 && !isTest) {
    items.push(
      <PromptActionButton
        key="refund"
        label="Record refund"
        title="Record approved refund"
        description={`Refundable: ${formatCurrency(refundable, currency)}. The refund is booked in the ledger via ${method}.`}
        amountLabel="Refund amount"
        defaultAmount={refundable}
        maxAmount={refundable}
        commentLabel="Reason / approval reference"
        commentRequired
        confirmLabel="Record refund"
        onSubmit={(amount, reason) => recordRefundAction(eventId, regId, amount ?? 0, method, reason)}
      />,
    );
  }
  return items.length ? <div className="flex flex-wrap items-center gap-2">{items}</div> : null;
}
