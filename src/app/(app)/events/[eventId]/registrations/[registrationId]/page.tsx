import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { Crumb } from "@/components/layout/shell-context";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RegistrationActions } from "@/features/registrations/registrations-ui";
import { formatCurrency, formatDateTime, titleCase } from "@/lib/utils";

export const metadata = { title: "Registration" };

export default async function RegistrationPage({ params }: { params: Promise<{ eventId: string; registrationId: string }> }) {
  const { eventId, registrationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(registrationId)) notFound();
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "registrations.view")) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("registrations")
    .select("*, items:registration_items(id, item_name, category, quantity, unit_price, amount), payments(id, provider, provider_order_id, provider_payment_id, amount, status, method, verified_via, verified_at, created_at)")
    .eq("id", registrationId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (!r) notFound();
  const cur = event.currency;
  const n = (v: unknown) => Number(v ?? 0);
  const team = (r.team_members as { name?: string; email?: string; phone?: string }[]) ?? [];
  const custom = Object.entries((r.custom_fields as Record<string, unknown>) ?? {});

  return (
    <div className="space-y-6">
      <Crumb id={r.id} label={r.registration_number} />
      <PageHeader
        eyebrow={<span className="font-mono">{r.registration_number}</span>}
        title={<span className="flex flex-wrap items-center gap-2">{r.participant_name} <StatusBadge status={r.status} /> <StatusBadge status={r.payment_status} />{r.is_test ? <Badge variant="warning">Test</Badge> : null}</span>}
        description={`${titleCase(r.category)} · ${titleCase(r.source)} · registered ${formatDateTime(r.created_at)}`}
      />
      <RegistrationActions
        eventId={eventId}
        regId={r.id}
        status={r.status}
        paymentStatus={r.payment_status}
        balance={Math.max(n(r.payable_amount) - n(r.amount_paid), 0)}
        refundable={n(r.amount_paid) - n(r.amount_refunded)}
        currency={cur}
        canManage={can(permissions, "registrations.manage")}
        canRefund={can(permissions, "finance.manage")}
        isTest={r.is_test}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Participant</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Email" value={r.email} />
            <Row label="Phone" value={r.phone} />
            <Row label="College" value={r.participant_college} />
            <Row label="Course" value={r.course} />
            <Row label="Academic year" value={r.academic_year} />
            <Row label="External ref." value={r.external_reference} />
            {r.cancellation_reason ? <Row label="Cancellation" value={r.cancellation_reason} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Amount" value={formatCurrency(r.amount, cur)} />
            <Row label="Discount" value={formatCurrency(r.discount, cur)} />
            <Row label="Payable" value={formatCurrency(r.payable_amount, cur)} />
            <Row label="Paid" value={formatCurrency(r.amount_paid, cur)} />
            <Row label="Refunded" value={formatCurrency(r.amount_refunded, cur)} />
            <Row label="Gateway" value={r.payment_gateway} />
            <Row label="Reference" value={r.payment_reference} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{r.registration_type === "team" ? `Team · ${r.team_name ?? ""}` : "Registration"}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(r.items ?? []).map((i) => (
              <div key={i.id} className="flex justify-between gap-2"><span>{i.item_name} × {i.quantity}</span><span className="tabular">{formatCurrency(i.amount, cur)}</span></div>
            ))}
            {team.length ? (
              <div className="pt-2">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Team members</p>
                <ul className="space-y-1">{team.map((m, i) => <li key={i}>{m.name}{m.email ? <span className="text-muted-foreground"> · {m.email}</span> : null}</li>)}</ul>
              </div>
            ) : null}
            {custom.length ? (
              <div className="pt-2">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional fields</p>
                {custom.map(([k, v]) => <Row key={k} label={titleCase(k)} value={String(v ?? "—")} />)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Gateway payments</CardTitle></CardHeader>
        <CardContent>
          {(r.payments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No gateway payment orders.</p>
          ) : (
            <ul className="divide-y text-sm">
              {r.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span className="font-mono text-xs">{p.provider} · {p.provider_order_id}{p.provider_payment_id ? ` · ${p.provider_payment_id}` : ""}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatCurrency(p.amount, cur)}</span>
                    <StatusBadge status={p.status} />
                    {p.verified_via ? <span className="text-xs text-muted-foreground">verified via {p.verified_via}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value || "—"}</span>
    </div>
  );
}
