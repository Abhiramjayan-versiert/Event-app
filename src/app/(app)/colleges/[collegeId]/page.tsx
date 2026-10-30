import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Building2, CalendarDays, Globe, Mail, MapPin, Pencil, Phone, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import type { GlobalDashboard } from "@/features/dashboard/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Crumb } from "@/components/layout/shell-context";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CollegeAdmins, type CollegeAdmin } from "@/features/colleges/college-admins";
import { setCollegeArchivedAction } from "@/features/colleges/actions";
import { publicStorageUrl } from "@/lib/storage";
import { formatCurrency, formatDateRange, formatNumber } from "@/lib/utils";

export default async function CollegePage({ params }: { params: Promise<{ collegeId: string }> }) {
  const { collegeId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(collegeId)) notFound();
  const access = await requireAccess();
  const supabase = await createClient();

  const { data: college } = await supabase.from("colleges").select("*").eq("id", collegeId).maybeSingle();
  if (!college) notFound();

  const [events, admins, perms] = await Promise.all([
    supabase.from("events").select("id, name, category, status, starts_on, ends_on").eq("college_id", collegeId).order("starts_on", { ascending: false }),
    supabase
      .from("college_members")
      .select("id, status, started_at, user:profiles!college_members_user_id_fkey(id, full_name, email, avatar_path), role:roles!inner(key)")
      .eq("college_id", collegeId)
      .eq("role.key", "college_admin")
      .is("ended_at", null),
    Promise.all(
      ["college.view", "college.manage", "college.users.manage", "college.events.create"].map((p) =>
        supabase.rpc("check_permission", { p_scope: "college", p_id: collegeId, p_permission: p }).then((r) => [p, Boolean(r.data)] as const),
      ),
    ).then((entries) => Object.fromEntries(entries) as Record<string, boolean>),
  ]);

  const analytics = perms["college.view"]
    ? ((await supabase.rpc("global_dashboard", { p_college: collegeId })).data as unknown as GlobalDashboard | null)
    : null;

  const adminRows: CollegeAdmin[] = (admins.data ?? []).flatMap((m) =>
    m.user ? [{ membershipId: m.id, userId: m.user.id, name: m.user.full_name, email: m.user.email, avatarPath: m.user.avatar_path, status: m.status, startedAt: m.started_at }] : [],
  );
  const logo = publicStorageUrl("branding", college.logo_path);
  const archived = college.status === "archived";

  return (
    <div className="space-y-8">
      <Crumb id={college.id} label={college.name} />
      <PageHeader
        eyebrow={<span className="font-mono">{college.code}</span>}
        title={
          <span className="flex items-center gap-3">
            {logo ? (
              <Image src={logo} alt="" width={36} height={36} className="size-9 rounded-md border object-cover" unoptimized />
            ) : (
              <span className="flex size-9 items-center justify-center rounded-md bg-muted"><Building2 className="size-4 text-muted-foreground" /></span>
            )}
            <span className="truncate">{college.name}</span>
            <StatusBadge status={college.status} />
          </span>
        }
        actions={
          <>
            {perms["college.manage"] && !archived ? (
              <Button variant="outline" asChild><Link href={`/colleges/${college.id}/edit`}><Pencil /> Edit</Link></Button>
            ) : null}
            {access.is_super_admin ? (
              <ConfirmButton
                variant="outline"
                title={archived ? "Restore this college?" : "Archive this college?"}
                description={
                  archived
                    ? "The college becomes active again and its administrators regain management access."
                    : "Archived colleges are read-only. Events, registrations and financial records are kept for reporting and audit — nothing is deleted."
                }
                confirmLabel={archived ? "Restore" : "Archive"}
                action={setCollegeArchivedAction.bind(null, college.id, !archived)}
              >
                {archived ? <><ArchiveRestore /> Restore</> : <><Archive /> Archive</>}
              </ConfirmButton>
            ) : null}
            {perms["college.events.create"] && !archived ? (
              <Button asChild><Link href={`/events/new?college=${college.id}`}><Plus /> New event</Link></Button>
            ) : null}
          </>
        }
      />

      {analytics ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Events" value={formatNumber(analytics.cards.total_events)} hint={`${analytics.cards.live_events} live · ${analytics.cards.upcoming_events} upcoming`} />
          <StatCard label="Participants" value={formatNumber(analytics.cards.total_participants)} />
          <StatCard label="Income received" value={formatCurrency(analytics.finance.total_income_received)} highlight />
          <StatCard label="Expenditure paid" value={formatCurrency(analytics.finance.expenditure_paid)} hint={`Net ${formatCurrency(analytics.finance.net_cash_position)}`} />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>Select an event to open its workspace.</CardDescription>
          </CardHeader>
          <CardContent>
            {(events.data ?? []).length === 0 ? (
              <EmptyState icon={CalendarDays} title="No events yet" description="Create the first event for this college." />
            ) : (
              <ul className="divide-y">
                {events.data!.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{e.name}</p>
                        <p className="text-xs text-muted-foreground">{e.category} · {formatDateRange(e.starts_on, e.ends_on)}</p>
                      </div>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              {college.description ? <p className="text-muted-foreground">{college.description}</p> : null}
              <Detail icon={MapPin} value={[college.address, college.city, college.state, college.country].filter(Boolean).join(", ")} />
              <Detail icon={Mail} value={college.email} href={college.email ? `mailto:${college.email}` : undefined} />
              <Detail icon={Phone} value={college.phone} href={college.phone ? `tel:${college.phone}` : undefined} />
              <Detail icon={Globe} value={college.website} href={college.website ?? undefined} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>College administrators</CardTitle>
              <CardDescription>Manage the college, its users and its events.</CardDescription>
            </CardHeader>
            <CardContent>
              <CollegeAdmins collegeId={college.id} admins={adminRows} canManage={perms["college.users.manage"] && !archived} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ icon: Icon, value, href }: { icon: typeof Mail; value: string | null; href?: string }) {
  if (!value) return null;
  return (
    <p className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      {href ? (
        <a href={href} className="break-all hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{value}</a>
      ) : (
        <span>{value}</span>
      )}
    </p>
  );
}
