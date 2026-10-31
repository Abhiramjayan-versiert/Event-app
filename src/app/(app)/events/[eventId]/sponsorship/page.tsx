import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, Handshake, HandCoins, Pencil, Plus, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEventPeople } from "@/features/departments/queries";
import { DeliverableStatus, PackageDialog, PipelineBoard, SponsorDialog, type BoardDeal } from "@/features/sponsorship/sponsorship-ui";
import { PaymentReview } from "@/features/sponsorship/payment-review";
import { cn, formatCurrency, formatDate, titleCase } from "@/lib/utils";

export const metadata = { title: "Sponsorship" };
const TABS = ["pipeline", "sponsors", "packages", "payments", "deliverables"] as const;

export default async function SponsorshipPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { eventId } = await params;
  const { tab: t } = await searchParams;
  const tab = TABS.find((x) => x === t) ?? "pipeline";
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "sponsors.view")) notFound();
  const supabase = await createClient();
  const cur = event.currency;
  const canManage = can(permissions, "sponsors.manage");

  const [deals, sponsors, packages, payments, deliverables, people] = await Promise.all([
    supabase.from("sponsorship_deals").select("id, stage, proposed_amount, agreed_amount, received_amount, sponsor:sponsors(company_name), package:sponsorship_packages(name), owner:profiles!sponsorship_deals_owner_id_fkey(full_name)").eq("event_id", eventId).order("updated_at", { ascending: false }),
    supabase.from("sponsors").select("*, assignee:profiles!sponsors_assigned_to_fkey(full_name), deals:sponsorship_deals(id, stage, agreed_amount)").eq("event_id", eventId).order("company_name"),
    supabase.from("sponsorship_packages").select("*").eq("event_id", eventId).order("tier_order"),
    supabase.from("sponsorship_payments").select("id, amount, paid_on, payment_method, reference, status, deal_id, sponsor:sponsors(company_name), recorder:profiles!sponsorship_payments_recorded_by_fkey(full_name)").eq("event_id", eventId).order("created_at", { ascending: false }),
    supabase.from("sponsorship_deliverables").select("id, deliverable_type, description, due_date, status, deal_id, deal:sponsorship_deals(sponsor:sponsors(company_name)), owner:profiles!sponsorship_deliverables_owner_id_fkey(full_name)").eq("event_id", eventId).order("due_date", { ascending: true, nullsFirst: false }),
    getEventPeople(eventId),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const board: BoardDeal[] = (deals.data ?? []).map((d) => ({
    id: d.id, company: d.sponsor?.company_name ?? "—", packageName: d.package?.name ?? null, stage: d.stage,
    agreed: n(d.agreed_amount), proposed: n(d.proposed_amount), received: n(d.received_amount), owner: d.owner?.full_name ?? null,
  }));
  const committedDeals = board.filter((d) => ["confirmed", "partially_paid", "fully_paid"].includes(d.stage));
  const committed = committedDeals.reduce((s, d) => s + d.agreed, 0);
  const received = committedDeals.reduce((s, d) => s + d.received, 0);
  const pipelineValue = board.filter((d) => !["rejected", "lost", "confirmed", "partially_paid", "fully_paid"].includes(d.stage)).reduce((s, d) => s + d.proposed, 0);
  const pendingPayments = (payments.data ?? []).filter((p) => p.status === "pending");
  const delivs = deliverables.data ?? [];
  const peopleOpts = people.map((p) => ({ id: p.id, name: p.name || p.email }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sponsorship"
        description="Sponsor CRM: pipeline, packages, payments and deliverables. Commitments never count as money received."
        actions={canManage ? <SponsorDialog eventId={eventId} people={peopleOpts} trigger={<Button><Plus /> New sponsor lead</Button>} /> : null}
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Committed" value={formatCurrency(committed, cur)} hint={`${committedDeals.length} confirmed sponsors`} icon={Handshake} highlight />
        <StatCard label="Received (verified)" value={formatCurrency(received, cur)} icon={HandCoins} />
        <StatCard label="Outstanding" value={formatCurrency(Math.max(committed - received, 0), cur)} hint={`${pendingPayments.length} payment(s) awaiting verification`} icon={CircleDollarSign} />
        <StatCard label="Open pipeline" value={formatCurrency(pipelineValue, cur)} hint="Proposed value of open deals" icon={Target} />
      </section>
      <nav className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
        {TABS.map((x) => (
          <Link key={x} href={`/events/${eventId}/sponsorship${x === "pipeline" ? "" : `?tab=${x}`}`} className={cn("whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium", tab === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
            {titleCase(x)}{x === "payments" && pendingPayments.length ? <span className="ml-1.5 rounded bg-ink px-1.5 text-[10px] text-lime">{pendingPayments.length}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "pipeline" ? (board.length ? <PipelineBoard eventId={eventId} deals={board} currency={cur} canManage={canManage} /> : <EmptyState title="No sponsors yet" description="Add a sponsor lead to start the pipeline." />) : null}

      {tab === "sponsors" ? (
        (sponsors.data ?? []).length === 0 ? <EmptyState title="No sponsors yet" /> : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-3 py-2.5">Company</th><th className="px-3">Contact</th><th className="px-3">Category</th><th className="px-3">Assigned</th><th className="px-3">Deal</th><th className="px-3" /></tr></thead>
              <tbody>
                {sponsors.data!.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-3 py-2.5"><p className="font-medium">{s.company_name}</p>{s.brand_name ? <p className="text-xs text-muted-foreground">{s.brand_name}</p> : null}</td>
                    <td className="px-3"><p>{s.contact_person ?? "—"}{s.designation ? <span className="text-muted-foreground"> · {s.designation}</span> : null}</p><p className="text-xs text-muted-foreground">{[s.email, s.phone].filter(Boolean).join(" · ")}</p></td>
                    <td className="px-3">{s.category ?? "—"}</td>
                    <td className="px-3">{s.assignee?.full_name ?? "—"}</td>
                    <td className="px-3">{s.deals?.[0] ? <Link href={`/events/${eventId}/sponsorship/deals/${s.deals[0].id}`}><StatusBadge status={s.deals[0].stage} /></Link> : "—"}</td>
                    <td className="px-3 text-right">
                      {canManage ? (
                        <SponsorDialog
                          eventId={eventId}
                          sponsorId={s.id}
                          people={peopleOpts}
                          defaults={{ company_name: s.company_name, brand_name: s.brand_name ?? "", contact_person: s.contact_person ?? "", designation: s.designation ?? "", email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", website: s.website ?? "", category: s.category ?? "", assigned_to: s.assigned_to ?? "", notes: s.notes ?? "" }}
                          trigger={<Button variant="ghost" size="sm"><Pencil /> Edit</Button>}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "packages" ? (
        <div className="space-y-4">
          {canManage ? <div className="flex justify-end"><PackageDialog eventId={eventId} trigger={<Button variant="outline"><Plus /> Custom package</Button>} /></div> : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(packages.data ?? []).map((p) => {
              const benefits = Array.isArray(p.benefits) ? (p.benefits as string[]) : [];
              const taken = board.filter((d) => d.packageName === p.name && ["confirmed", "partially_paid", "fully_paid"].includes(d.stage)).length;
              return (
                <div key={p.id} className={cn("space-y-3 rounded-lg border bg-card p-4", !p.is_active && "opacity-60")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <Badge variant={p.is_custom ? "lime" : "muted"}>{p.is_custom ? "Custom" : `Tier ${p.tier_order}`}</Badge>
                  </div>
                  <p className="tabular text-xl font-semibold">{n(p.amount) ? formatCurrency(p.amount, cur) : "Price on request"}</p>
                  <p className="text-xs text-muted-foreground">{taken} confirmed{p.max_slots ? ` of ${p.max_slots} slots` : ""}</p>
                  {benefits.length ? <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground">{benefits.map((b) => <li key={b}>{b}</li>)}</ul> : null}
                  {canManage ? (
                    <PackageDialog
                      eventId={eventId}
                      packageId={p.id}
                      defaults={{ name: p.name, tier_order: p.tier_order, amount: n(p.amount), description: p.description ?? "", benefits: benefits.join("\n"), max_slots: p.max_slots, is_active: p.is_active }}
                      trigger={<Button variant="outline" size="sm" className="w-full"><Pencil /> Edit</Button>}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {tab === "payments" ? (
        (payments.data ?? []).length === 0 ? <EmptyState title="No sponsorship payments" description="Record payments from a deal's page; finance verifies them here." /> : (
          <ul className="divide-y rounded-lg border bg-card">
            {payments.data!.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <Link href={`/events/${eventId}/sponsorship/deals/${p.deal_id}`} className="font-medium hover:underline">{p.sponsor?.company_name}</Link>
                  <p className="text-xs text-muted-foreground">{formatDate(p.paid_on)} · {p.payment_method}{p.reference ? ` · ${p.reference}` : ""} · recorded by {p.recorder?.full_name ?? "—"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular font-semibold">{formatCurrency(p.amount, cur)}</span>
                  <StatusBadge status={p.status} />
                  {p.status === "pending" && can(permissions, "finance.manage") ? <PaymentReview eventId={eventId} paymentId={p.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "deliverables" ? (
        delivs.length === 0 ? <EmptyState title="No deliverables" description="Add what each sponsor was promised from the deal page." /> : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{delivs.filter((d) => d.status === "completed").length} of {delivs.length} completed.</p>
            <ul className="divide-y rounded-lg border bg-card">
              {delivs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <p className="font-medium">{titleCase(d.deliverable_type)} <span className="font-normal text-muted-foreground">· {d.deal?.sponsor?.company_name}</span></p>
                    <p className="text-xs text-muted-foreground">{d.description ?? ""}{d.due_date ? ` · due ${formatDate(d.due_date)}` : ""}{d.owner?.full_name ? ` · ${d.owner.full_name}` : ""}</p>
                  </div>
                  <DeliverableStatus eventId={eventId} id={d.id} status={d.status} disabled={!canManage} />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
