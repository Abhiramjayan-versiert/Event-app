import Link from "next/link";
import { notFound } from "next/navigation";
import { Eye, Megaphone, MousePointerClick, Pencil, Plus, UserPlus, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarsChart, ChartPanel } from "@/components/charts/charts";
import { DeleteRecordButton, RecordDialog } from "@/features/records/record-dialog";
import { getOptionSets } from "@/features/records/options";
import { formatCurrency, formatDate, formatNumber, titleCase } from "@/lib/utils";

export const metadata = { title: "Marketing" };

export default async function MarketingPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const { event, permissions } = await getEventContext(eventId);
  if (!can(permissions, "marketing.view")) notFound();
  const canManage = can(permissions, "marketing.manage");
  const supabase = await createClient();
  const [campaigns, options] = await Promise.all([
    supabase.from("marketing_campaigns").select("*, owner:profiles!marketing_campaigns_owner_id_fkey(full_name)").eq("event_id", eventId).order("start_date", { ascending: false, nullsFirst: false }),
    getOptionSets(eventId),
  ]);
  const rows = campaigns.data ?? [];
  const n = (v: unknown) => Number(v ?? 0);
  const sum = (k: "budget" | "actual_spend" | "reach" | "impressions" | "engagement" | "registrations_generated") => rows.reduce((s, r) => s + n(r[k]), 0);
  const spend = sum("actual_spend");
  const regs = sum("registrations_generated");
  const cur = event.currency;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="Campaigns across social media, offline promotion, ambassadors and influencers. Enter performance manually; platform integrations can be added later."
        actions={
          <>
            <Button variant="outline" asChild><Link href={`/events/${eventId}/tasks?module=marketing`}>Marketing tasks</Link></Button>
            {canManage ? <RecordDialog kind="campaign" eventId={eventId} options={options} trigger={<Button><Plus /> Campaign</Button>} /> : null}
          </>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Advertising budget" value={formatCurrency(sum("budget"), cur)} hint={`${formatCurrency(spend, cur)} spent`} icon={Wallet} />
        <StatCard label="Reach" value={formatNumber(sum("reach"), { compact: true })} hint={`${formatNumber(sum("impressions"), { compact: true })} impressions`} icon={Eye} />
        <StatCard label="Engagement" value={formatNumber(sum("engagement"), { compact: true })} icon={MousePointerClick} />
        <StatCard label="Registrations generated" value={formatNumber(regs)} icon={UserPlus} highlight />
        <StatCard label="Cost per registration" value={regs ? formatCurrency(spend / regs, cur) : "—"} icon={Megaphone} />
        <StatCard label="Campaigns" value={rows.length} hint={`${rows.filter((r) => r.status === "active").length} active`} icon={Megaphone} />
      </section>
      {rows.length ? (
        <ChartPanel title="Budget vs spend by campaign">
          <BarsChart kind="currency" currency={cur} layout="horizontal-bars" data={rows.slice(0, 12).map((r) => ({ name: r.name, budget: n(r.budget), spend: n(r.actual_spend) }))} xKey="name" series={[{ key: "budget", label: "Budget", color: "ink" }, { key: "spend", label: "Spent" }]} />
        </ChartPanel>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" description="Create campaigns to plan promotion and track their results." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-3 py-2.5">Campaign</th><th className="px-3">Dates</th><th className="px-3">Budget / spend</th><th className="px-3">Reach</th><th className="px-3">Engagement</th><th className="px-3">Registrations</th><th className="px-3">Status</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5"><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.platform} · {titleCase(c.channel_type)}{c.owner?.full_name ? ` · ${c.owner.full_name}` : ""}</p></td>
                  <td className="px-3 text-xs">{c.start_date ? formatDate(c.start_date) : "—"} – {c.end_date ? formatDate(c.end_date) : "—"}</td>
                  <td className="tabular px-3">{formatCurrency(c.budget, cur)} / {formatCurrency(c.actual_spend, cur)}</td>
                  <td className="tabular px-3">{formatNumber(c.reach)}</td>
                  <td className="tabular px-3">{formatNumber(c.engagement)}</td>
                  <td className="tabular px-3">{formatNumber(c.registrations_generated)}</td>
                  <td className="px-3"><Badge variant={c.status === "active" ? "lime" : c.status === "completed" ? "success" : "muted"}>{titleCase(c.status)}</Badge></td>
                  <td className="px-3 text-right">
                    {canManage ? (
                      <span className="flex justify-end gap-1">
                        <RecordDialog kind="campaign" eventId={eventId} id={c.id} defaults={c} options={options} trigger={<Button variant="ghost" size="sm"><Pencil /> Update</Button>} />
                        <DeleteRecordButton kind="campaign" eventId={eventId} id={c.id} label={c.name} />
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
