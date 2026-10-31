import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Camera, ExternalLink, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteRecordButton, RecordDialog } from "@/features/records/record-dialog";
import { cn, formatDateTime, formatNumber, titleCase } from "@/lib/utils";

export const metadata = { title: "Media & PR" };

const STATUS: Record<string, "muted" | "warning" | "success" | "lime" | "destructive"> = {
  draft: "muted", pending_approval: "warning", approved: "success", published: "lime", rejected: "destructive",
};

export default async function MediaPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ type?: string }> }) {
  const { eventId } = await params;
  const { type } = await searchParams;
  const { permissions } = await getEventContext(eventId);
  if (!can(permissions, "media.view")) notFound();
  const canManage = can(permissions, "media.manage");
  const supabase = await createClient();
  const [assets, tasks] = await Promise.all([
    supabase.from("media_assets").select("*, uploader:profiles!media_assets_uploaded_by_fkey(full_name)").eq("event_id", eventId).order("scheduled_for", { ascending: true, nullsFirst: false }),
    supabase.from("tasks").select("id, title, status, due_at, task_type").eq("event_id", eventId).eq("module", "media").neq("status", "completed").order("due_at", { nullsFirst: false }).limit(8),
  ]);
  const all = assets.data ?? [];
  const list = type ? all.filter((a) => a.asset_type === type) : all;
  const upcoming = all.filter((a) => a.scheduled_for && new Date(a.scheduled_for).getTime() >= Date.now() - 86_400_000 && a.status !== "published").slice(0, 10);
  const byPlatform = new Map<string, { reach: number; engagement: number; count: number }>();
  for (const a of all.filter((x) => x.status === "published")) {
    const k = a.platform ?? "Other";
    const v = byPlatform.get(k) ?? { reach: 0, engagement: 0, count: 0 };
    byPlatform.set(k, { reach: v.reach + Number(a.reach ?? 0), engagement: v.engagement + Number(a.engagement ?? 0), count: v.count + 1 });
  }
  const types = ["photo", "video", "poster", "reel", "press_release", "social_post", "coverage", "other"];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media & PR"
        description="Content calendar, approvals, press coverage and media performance. Shoot and design work is planned as media tasks."
        actions={
          <>
            <Button variant="outline" asChild><Link href={`/events/${eventId}/tasks?module=media&view=calendar`}>Media tasks & shoots</Link></Button>
            {canManage ? <RecordDialog kind="media_asset" eventId={eventId} trigger={<Button><Plus /> Content item</Button>} /> : null}
          </>
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Content items" value={all.length} icon={Camera} />
        <StatCard label="Awaiting approval" value={all.filter((a) => a.status === "pending_approval").length} />
        <StatCard label="Published" value={all.filter((a) => a.status === "published").length} highlight />
        <StatCard label="Total reach" value={formatNumber(all.reduce((s, a) => s + Number(a.reach ?? 0), 0), { compact: true })} hint={`${formatNumber(all.reduce((s, a) => s + Number(a.engagement ?? 0), 0), { compact: true })} engagements`} />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="size-4" /> Content calendar</CardTitle></CardHeader>
          <CardContent>
            {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing scheduled.</p> : (
              <ul className="space-y-2 text-sm">{upcoming.map((a) => <li key={a.id} className="flex justify-between gap-2"><span className="truncate">{a.title}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.scheduled_for)}</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Open media tasks</CardTitle></CardHeader>
          <CardContent>
            {(tasks.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No open media tasks.</p> : (
              <ul className="space-y-2 text-sm">{tasks.data!.map((t) => <li key={t.id}><Link href={`/events/${eventId}/tasks/${t.id}`} className="flex justify-between gap-2 hover:underline"><span className="truncate">{t.title}</span><span className="shrink-0 text-xs text-muted-foreground">{t.task_type ? titleCase(t.task_type) : ""}</span></Link></li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Performance by platform</CardTitle></CardHeader>
          <CardContent>
            {byPlatform.size === 0 ? <p className="text-sm text-muted-foreground">Publish content and enter reach to see results.</p> : (
              <ul className="space-y-2 text-sm">{[...byPlatform.entries()].map(([p, v]) => <li key={p} className="flex justify-between gap-2"><span>{p} <span className="text-xs text-muted-foreground">({v.count})</span></span><span className="tabular text-xs">{formatNumber(v.reach, { compact: true })} reach · {formatNumber(v.engagement, { compact: true })} eng.</span></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap gap-1">
        <Link href={`/events/${eventId}/media`} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", !type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>All</Link>
        {types.map((t) => <Link key={t} href={`/events/${eventId}/media?type=${t}`} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", type === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{titleCase(t)}</Link>)}
      </div>
      {list.length === 0 ? <EmptyState icon={Camera} title="No content yet" description="Add posters, reels, press releases and coverage to plan, approve and track them." /> : (
        <ul className="divide-y rounded-lg border bg-card">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">{a.title}<Badge variant="muted">{titleCase(a.asset_type)}</Badge><Badge variant={STATUS[a.status] ?? "muted"}>{titleCase(a.status)}</Badge></p>
                <p className="text-xs text-muted-foreground">
                  {[a.platform, a.scheduled_for ? formatDateTime(a.scheduled_for) : null, a.uploader?.full_name, a.reach ? `${formatNumber(a.reach)} reach` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {a.published_url ? <Button variant="ghost" size="icon-sm" asChild><a href={a.published_url} target="_blank" rel="noreferrer" aria-label="Open link"><ExternalLink /></a></Button> : null}
                {canManage ? (
                  <>
                    <RecordDialog kind="media_asset" eventId={eventId} id={a.id} defaults={a} trigger={<Button variant="ghost" size="sm"><Pencil /> Update</Button>} />
                    <DeleteRecordButton kind="media_asset" eventId={eventId} id={a.id} label={a.title} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
