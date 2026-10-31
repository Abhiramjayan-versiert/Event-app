"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import {
  DELIVERABLE_TYPES, SPONSOR_STAGES, dealSchema, deliverableSchema, packageSchema, sponsorSchema, sponsorshipPaymentSchema,
  type DealInput, type PackageInput, type SponsorInput,
} from "@/lib/validations/sponsorship";
import { PAYMENT_METHODS } from "@/lib/validations/finance";
import {
  addDeliverableAction, recordSponsorshipPaymentAction, saveDealAction, savePackageAction, saveSponsorAction, setDealStageAction, setDeliverableStatusAction,
} from "@/features/sponsorship/actions";
import type { ActionResult } from "@/lib/actions";
import type { z } from "zod";
import { cn, formatCurrency, titleCase } from "@/lib/utils";

export type Person = { id: string; name: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionResult<unknown>>, ok?: (r: ActionResult<unknown>) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      ok?.(r);
      router.refresh();
    });
  return { pending, run, router };
}

export function SponsorDialog({ eventId, sponsorId, defaults, people, trigger }: { eventId: string; sponsorId?: string; defaults?: SponsorInput; people: Person[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pending, run, router } = useRun();
  const form = useForm<SponsorInput>({
    resolver: zodResolver(sponsorSchema),
    defaultValues: defaults ?? { company_name: "", brand_name: "", contact_person: "", designation: "", email: "", phone: "", address: "", website: "", category: "", assigned_to: "", notes: "" },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit((v) =>
    run(() => saveSponsorAction(eventId, sponsorId ?? null, v, !sponsorId), (r) => {
      setOpen(false);
      const dealId = r.ok ? (r.data as { dealId?: string } | undefined)?.dealId : undefined;
      if (dealId) router.push(`/events/${eventId}/sponsorship/deals/${dealId}`);
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{sponsorId ? "Edit sponsor" : "New sponsor lead"}</DialogTitle>
          <DialogDescription>{sponsorId ? "Company and contact details." : "Adds the company and opens a deal at “Lead identified”."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="s-co" label="Company name" error={e.company_name?.message} required><Input id="s-co" {...form.register("company_name")} /></FormField>
          <FormField id="s-brand" label="Brand name"><Input id="s-brand" {...form.register("brand_name")} /></FormField>
          <FormField id="s-contact" label="Contact person"><Input id="s-contact" {...form.register("contact_person")} /></FormField>
          <FormField id="s-desig" label="Designation"><Input id="s-desig" {...form.register("designation")} /></FormField>
          <FormField id="s-email" label="Email" error={e.email?.message}><Input id="s-email" type="email" {...form.register("email")} /></FormField>
          <FormField id="s-phone" label="Phone"><Input id="s-phone" type="tel" {...form.register("phone")} /></FormField>
          <FormField id="s-web" label="Website"><Input id="s-web" {...form.register("website")} /></FormField>
          <FormField id="s-cat" label="Category" hint="e.g. Banking, Food, EdTech"><Input id="s-cat" {...form.register("category")} /></FormField>
          <FormField id="s-addr" label="Address" className="sm:col-span-2"><Input id="s-addr" {...form.register("address")} /></FormField>
          <FormField id="s-owner" label="Assigned team member">
            <NativeSelect id="s-owner" {...form.register("assigned_to")}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="s-notes" label="Notes" className="sm:col-span-2"><Textarea id="s-notes" rows={2} {...form.register("notes")} /></FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DealDialog({ eventId, dealId, defaults, packages, people, currency, trigger }: {
  eventId: string; dealId: string; defaults: DealInput; packages: { id: string; name: string; amount: number }[]; people: Person[]; currency: string; trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const form = useForm<DealInput>({ resolver: zodResolver(dealSchema), defaultValues: defaults });
  const submit = form.handleSubmit((v) => run(() => saveDealAction(eventId, dealId, v), () => setOpen(false)));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Edit deal</DialogTitle><DialogDescription>Only “confirmed” and paid stages count as sponsorship commitments.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="d-pkg" label="Package">
            <NativeSelect id="d-pkg" {...form.register("package_id", { onChange: (ev) => { const p = packages.find((x) => x.id === ev.target.value); if (p && p.amount > 0 && !form.getValues("proposed_amount")) form.setValue("proposed_amount", p.amount); } })}>
              <option value="">No package</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.amount ? ` — ${formatCurrency(p.amount, currency)}` : ""}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="d-stage" label="Stage">
            <NativeSelect id="d-stage" {...form.register("stage")}>{SPONSOR_STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</NativeSelect>
          </FormField>
          <FormField id="d-prop" label="Proposed amount"><Input id="d-prop" type="number" min="0" step="0.01" {...form.register("proposed_amount", { valueAsNumber: true })} /></FormField>
          <FormField id="d-agreed" label="Agreed amount" hint="Set when the sponsor confirms."><Input id="d-agreed" type="number" min="0" step="0.01" {...form.register("agreed_amount", { valueAsNumber: true })} /></FormField>
          <FormField id="d-exp" label="Expected payment date"><Input id="d-exp" type="date" {...form.register("expected_payment_date")} /></FormField>
          <FormField id="d-owner" label="Owner">
            <NativeSelect id="d-owner" {...form.register("owner_id")}>
              <option value="">Unassigned</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="d-notes" label="Notes / proposal summary" className="sm:col-span-2"><Textarea id="d-notes" rows={3} {...form.register("notes")} /></FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save deal</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StageSelect({ eventId, dealId, stage, disabled }: { eventId: string; dealId: string; stage: string; disabled?: boolean }) {
  const { pending, run } = useRun();
  return (
    <NativeSelect
      aria-label="Stage"
      className="h-8 text-xs"
      value={stage}
      disabled={disabled || pending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => run(() => setDealStageAction(eventId, dealId, e.target.value))}
    >
      {SPONSOR_STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
    </NativeSelect>
  );
}

export type BoardDeal = { id: string; company: string; packageName: string | null; stage: string; agreed: number; proposed: number; received: number; owner: string | null };

const BOARD: { title: string; stages: string[] }[] = [
  { title: "Leads", stages: ["lead_identified", "contacted"] },
  { title: "In discussion", stages: ["meeting_scheduled", "proposal_sent", "negotiation"] },
  { title: "Confirmed", stages: ["confirmed", "partially_paid"] },
  { title: "Paid", stages: ["fully_paid"] },
  { title: "Closed", stages: ["rejected", "lost"] },
];

export function PipelineBoard({ eventId, deals, currency, canManage }: { eventId: string; deals: BoardDeal[]; currency: string; canManage: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {BOARD.map((col) => {
        const items = deals.filter((d) => col.stages.includes(d.stage));
        const total = items.reduce((s, d) => s + (d.agreed || d.proposed), 0);
        return (
          <section key={col.title} className="flex flex-col rounded-lg border bg-muted/40">
            <header className="flex items-center justify-between border-b px-3 py-2.5">
              <span className="text-sm font-semibold">{col.title} <span className="text-muted-foreground">({items.length})</span></span>
              <span className="tabular text-xs text-muted-foreground">{formatCurrency(total, currency, { compact: true })}</span>
            </header>
            <div className="flex flex-1 flex-col gap-2 p-2">
              {items.length === 0 ? <p className="p-3 text-center text-xs text-muted-foreground">No deals</p> : null}
              {items.map((d) => (
                <div key={d.id} className="space-y-2 rounded-md border bg-card p-3">
                  <Link href={`/events/${eventId}/sponsorship/deals/${d.id}`} className="block font-medium hover:underline">{d.company}</Link>
                  <p className="text-xs text-muted-foreground">{d.packageName ?? "No package"}{d.owner ? ` · ${d.owner}` : ""}</p>
                  <div className="flex justify-between text-xs">
                    <span>{d.agreed ? "Agreed" : "Proposed"}</span>
                    <span className="tabular font-medium">{formatCurrency(d.agreed || d.proposed, currency)}</span>
                  </div>
                  {d.agreed > 0 ? (
                    <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.min(100, (100 * d.received) / d.agreed)}%` }} /></div>
                  ) : null}
                  {canManage ? <StageSelect eventId={eventId} dealId={d.id} stage={d.stage} /> : null}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function PackageDialog({ eventId, packageId, defaults, trigger }: { eventId: string; packageId?: string; defaults?: PackageInput; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const form = useForm<PackageInput>({
    resolver: zodResolver(packageSchema),
    defaultValues: defaults ?? { name: "", tier_order: 50, amount: 0, description: "", benefits: "", max_slots: null, is_active: true },
  });
  const submit = form.handleSubmit((v) => run(() => savePackageAction(eventId, packageId ?? null, v), () => setOpen(false)));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{packageId ? "Edit package" : "Custom package"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="p-name" label="Name" error={form.formState.errors.name?.message} required className="sm:col-span-2"><Input id="p-name" {...form.register("name")} /></FormField>
          <FormField id="p-amount" label="Price"><Input id="p-amount" type="number" min="0" step="0.01" {...form.register("amount", { valueAsNumber: true })} /></FormField>
          <FormField id="p-slots" label="Max sponsors (optional)"><Input id="p-slots" type="number" min="1" {...form.register("max_slots", { setValueAs: (v) => (v === "" || v === null ? null : Number(v)) })} /></FormField>
          <FormField id="p-order" label="Display order"><Input id="p-order" type="number" min="0" {...form.register("tier_order", { valueAsNumber: true })} /></FormField>
          <div className="flex items-end gap-2 pb-2">
            <Controller control={form.control} name="is_active" render={({ field }) => <Switch id="p-active" checked={field.value} onCheckedChange={field.onChange} />} />
            <Label htmlFor="p-active">Offered</Label>
          </div>
          <FormField id="p-desc" label="Description" className="sm:col-span-2"><Input id="p-desc" {...form.register("description")} /></FormField>
          <FormField id="p-benefits" label="Benefits (one per line)" className="sm:col-span-2"><Textarea id="p-benefits" rows={4} {...form.register("benefits")} /></FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type PaymentForm = z.infer<typeof sponsorshipPaymentSchema>;
export function SponsorshipPaymentDialog({ eventId, dealId, outstanding, currency }: { eventId: string; dealId: string; outstanding: number; currency: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const form = useForm<PaymentForm>({
    resolver: zodResolver(sponsorshipPaymentSchema),
    defaultValues: { amount: outstanding > 0 ? outstanding : (undefined as unknown as number), paid_on: new Date().toISOString().slice(0, 10), payment_method: "Bank transfer", reference: "", notes: "" },
  });
  const submit = form.handleSubmit((v) => run(() => recordSponsorshipPaymentAction(eventId, dealId, v), () => setOpen(false)));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Record payment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record sponsorship payment</DialogTitle><DialogDescription>Outstanding: {formatCurrency(outstanding, currency)}. Finance verifies it before it counts as received.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="sp-amt" label="Amount" error={form.formState.errors.amount?.message} required><Input id="sp-amt" type="number" min="0" step="0.01" {...form.register("amount", { valueAsNumber: true })} /></FormField>
          <FormField id="sp-date" label="Received on" required><Input id="sp-date" type="date" {...form.register("paid_on")} /></FormField>
          <FormField id="sp-method" label="Method"><NativeSelect id="sp-method" {...form.register("payment_method")}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</NativeSelect></FormField>
          <FormField id="sp-ref" label="Reference / UTR"><Input id="sp-ref" {...form.register("reference")} /></FormField>
          <FormField id="sp-notes" label="Notes" className="sm:col-span-2"><Input id="sp-notes" {...form.register("notes")} /></FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeliverableForm = z.infer<typeof deliverableSchema>;
export function DeliverableDialog({ eventId, dealId, people }: { eventId: string; dealId: string; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  const form = useForm<DeliverableForm>({ resolver: zodResolver(deliverableSchema), defaultValues: { deliverable_type: "logo_placement", description: "", due_date: "", owner_id: "" } });
  const submit = form.handleSubmit((v) => run(() => addDeliverableAction(eventId, dealId, v), () => { setOpen(false); form.reset(); }));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Add deliverable</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add sponsor deliverable</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <FormField id="dl-type" label="Type"><NativeSelect id="dl-type" {...form.register("deliverable_type")}>{DELIVERABLE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</NativeSelect></FormField>
          <FormField id="dl-due" label="Due date"><Input id="dl-due" type="date" {...form.register("due_date")} /></FormField>
          <FormField id="dl-owner" label="Responsible" className="sm:col-span-2">
            <NativeSelect id="dl-owner" {...form.register("owner_id")}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
          </FormField>
          <FormField id="dl-desc" label="Details" className="sm:col-span-2"><Textarea id="dl-desc" rows={2} {...form.register("description")} /></FormField>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={pending}>Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeliverableStatus({ eventId, id, status, disabled }: { eventId: string; id: string; status: string; disabled?: boolean }) {
  const { pending, run } = useRun();
  return (
    <NativeSelect aria-label="Deliverable status" className={cn("h-8 w-36 text-xs", status === "completed" && "border-primary")} value={status} disabled={disabled || pending} onChange={(e) => run(() => setDeliverableStatusAction(eventId, id, e.target.value))}>
      {["pending", "in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
    </NativeSelect>
  );
}
