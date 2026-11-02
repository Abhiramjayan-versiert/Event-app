import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { Crumb } from "@/components/layout/shell-context";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEventPeople } from "@/features/departments/queries";
import { DealDialog, DeliverableDialog, DeliverableStatus, SponsorshipPaymentDialog, StageSelect } from "@/features/sponsorship/sponsorship-ui";
import { PaymentReview } from "@/features/sponsorship/payment-review";
import { DocumentsPanel } from "@/features/documents/documents-panel";
import { SPONSOR_STAGES } from "@/lib/validations/sponsorship";
import { formatCurrency, formatDate, titleCase } from "@/lib/utils";

export const metadata = { title: "Sponsorship deal" };

export default async function DealPage({ params }: { params: Promise<{ eventId: string; dealId: string }> }) {
  const { eventId, dealId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(dealId)) notFound();
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "sponsors.view")) notFound();
  const supabase = await createClient();
  const { data: d } = await supabase
    .from("sponsorship_deals")
    .select("*, sponsor:sponsors(*), package:sponsorship_packages(name, amount), owner:profiles!sponsorship_deals_owner_id_fkey(full_name)")
    .eq("id", dealId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!d || !d.sponsor) notFound();
  const [payments, deliverables, packages, people] = await Promise.all([
    supabase.from("sponsorship_payments").select("id, amount, paid_on, payment_method, reference, status, notes").eq("deal_id", dealId).order("paid_on", { ascending: false }),
    supabase.from("sponsorship_deliverables").select("id, deliverable_type, description, due_date, status, owner:profiles!sponsorship_deliverables_owner_id_fkey(full_name)").eq("deal_id", dealId).order("due_date"),
    supabase.from("sponsorship_packages").select("id, name, amount").eq("event_id", eventId).eq("is_active", true).order("tier_order"),
    getEventPeople(eventId),
  ]);
  const cur = event.currency;
  const n = (v: unknown) => Number(v ?? 0);
  const agreed = n(d.agreed_amount);
  const received = n(d.received_amount);
  const canManage = can(permissions, "sponsors.manage");
  const s = d.sponsor;
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name || p.email }));

  return (
    <div className="space-y-6">
      <Crumb id={d.id} label={s.company_name} />
      <PageHeader
        eyebrow="Sponsorship deal"
        title={<span className="flex flex-wrap items-center gap-2">{s.company_name} <StatusBadge status={d.stage} /></span>}
        description={`${d.package?.name ?? "No package"} · owner ${d.owner?.full_name ?? "unassigned"}${d.confirmed_at ? ` · confirmed ${formatDate(d.confirmed_at)}` : ""}`}
        actions={
          canManage ? (
            <>
              <div className="w-full sm:w-48"><StageSelect eventId={eventId} dealId={d.id} stage={d.stage} /></div>
              <DealDialog
                eventId={eventId}
                dealId={d.id}
                currency={cur}
                packages={(packages.data ?? []).map((p) => ({ id: p.id, name: p.name, amount: n(p.amount) }))}
                people={peopleOpts}
                defaults={{
                  sponsor_id: d.sponsor_id, package_id: d.package_id ?? "", stage: (SPONSOR_STAGES as readonly string[]).includes(d.stage) ? d.stage : "lead_identified",
                  proposed_amount: n(d.proposed_amount), agreed_amount: agreed, expected_payment_date: d.expected_payment_date ?? "", owner_id: d.owner_id ?? "", notes: d.notes ?? "",
                }}
                trigger={<Button variant="outline"><Pencil /> Edit deal</Button>}
              />
            </>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Money</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <Row label="Proposed" value={formatCurrency(d.proposed_amount, cur)} />
            <Row label="Agreed" value={formatCurrency(agreed, cur)} />
            <Row label="Received (verified)" value={formatCurrency(received, cur)} />
            <Row label="Outstanding" value={formatCurrency(Math.max(agreed - received, 0), cur)} />
            {agreed > 0 ? <Progress value={(100 * received) / agreed} /> : null}
            <Row label="Expected by" value={d.expected_payment_date ? formatDate(d.expected_payment_date) : "—"} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Sponsor</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Contact" value={[s.contact_person, s.designation].filter(Boolean).join(", ") || "—"} />
            <Row label="Email" value={s.email ?? "—"} />
            <Row label="Phone" value={s.phone ?? "—"} />
            <Row label="Website" value={s.website ?? "—"} />
            <Row label="Category" value={s.category ?? "—"} />
            <Row label="Brand" value={s.brand_name ?? "—"} />
            {d.notes ? <p className="whitespace-pre-wrap text-muted-foreground sm:col-span-2">{d.notes}</p> : null}
          </CardContent>
        </Card>
      </div>
      <DocumentsPanel
        eventId={eventId}
        related={{ table: "sponsorship_deals", id: d.id }}
        title="Proposals, agreements & receipts"
        canUpload={canManage}
        defaultCategory="sponsor_agreement"
        defaultVisibility="event"
        revalidate={`/events/${eventId}/sponsorship/deals/${d.id}`}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Payments</CardTitle>{canManage || can(permissions, "finance.manage") ? <SponsorshipPaymentDialog eventId={eventId} dealId={d.id} outstanding={Math.max(agreed - received, 0)} currency={cur} /> : null}</CardHeader>
          <CardContent>
            {(payments.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : (
              <ul className="divide-y">
                {payments.data!.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span><span className="tabular font-medium">{formatCurrency(p.amount, cur)}</span> <span className="text-xs text-muted-foreground">· {formatDate(p.paid_on)} · {p.payment_method}{p.reference ? ` · ${p.reference}` : ""}</span></span>
                    <span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.status === "pending" && can(permissions, "finance.manage") ? <PaymentReview eventId={eventId} paymentId={p.id} /> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Deliverables</CardTitle>{canManage ? <DeliverableDialog eventId={eventId} dealId={d.id} people={peopleOpts} /> : null}</CardHeader>
          <CardContent>
            {(deliverables.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No deliverables yet.</p> : (
              <ul className="divide-y">
                {deliverables.data!.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span><span className="font-medium">{titleCase(x.deliverable_type)}</span><span className="text-xs text-muted-foreground">{x.description ? ` · ${x.description}` : ""}{x.due_date ? ` · due ${formatDate(x.due_date)}` : ""}{x.owner?.full_name ? ` · ${x.owner.full_name}` : ""}</span></span>
                    <DeliverableStatus eventId={eventId} id={x.id} status={x.status} disabled={!canManage} />
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

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>;
}
