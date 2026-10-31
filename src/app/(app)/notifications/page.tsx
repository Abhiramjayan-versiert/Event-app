import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MarkAllReadButton } from "@/features/announcements/announcements-ui";
import { cn, formatDateTime, titleCase } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ unread?: string }> }) {
  await requireAccess();
  const { unread } = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("notifications").select("id, type, title, body, link, read_at, created_at, event:events(name)").order("created_at", { ascending: false }).limit(200);
  if (unread === "1") q = q.is("read_at", null);
  const { data } = await q;
  const rows = data ?? [];
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Notifications" description="Task assignments, approvals, payments, registrations, budget warnings and announcements." actions={<MarkAllReadButton disabled={!rows.some((n) => !n.read_at)} />} />
      <nav className="flex gap-1 rounded-md bg-muted p-1 text-sm">
        <Link href="/notifications" className={cn("rounded-sm px-3 py-1.5 font-medium", unread !== "1" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>All</Link>
        <Link href="/notifications?unread=1" className={cn("rounded-sm px-3 py-1.5 font-medium", unread === "1" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Unread</Link>
      </nav>
      {rows.length === 0 ? <EmptyState icon={Bell} title="No notifications" /> : (
        <ul className="divide-y rounded-lg border bg-card">
          {rows.map((n) => {
            const body = (
              <div className={cn("flex gap-3 p-4", !n.read_at && "bg-accent/40")}>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                  <p className="text-xs text-muted-foreground">{titleCase(n.type.replace(".", " "))}{n.event?.name ? ` · ${n.event.name}` : ""} · {formatDateTime(n.created_at)}</p>
                </div>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:opacity-90">{body}</Link> : body}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
