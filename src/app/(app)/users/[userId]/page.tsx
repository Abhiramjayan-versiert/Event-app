import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAccessManager, type AccessData } from "@/features/users/user-access";
import { DeleteAccountCard } from "@/features/users/delete-account";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "User access" };

/** Super Admin: one place to see and change everything a person can access. */
export default async function UserAccessPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const access = await requireSuperAdmin();
  const supabase = await createClient();

  const [{ data: user }, pending, cm, em, dm, colleges, events, depts, eventRoles, deptRoles] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, status, is_super_admin, created_at, job_title, phone").eq("id", userId).maybeSingle(),
    supabase.rpc("pending_invitations"),
    supabase.from("college_members").select("id, college_id, started_at, ended_at, role:roles(name), college:colleges(name)").eq("user_id", userId).order("started_at", { ascending: false }),
    supabase.from("event_members").select("id, event_id, started_at, ended_at, end_reason, role:roles(name), event:events(name)").eq("user_id", userId).order("started_at", { ascending: false }),
    supabase.from("department_members").select("id, event_id, department_id, position, started_at:assigned_at, ended_at, end_reason, role:roles(name), department:departments(name), event:events(name)").eq("user_id", userId).order("assigned_at", { ascending: false }),
    supabase.from("colleges").select("id, name").neq("status", "archived").order("name"),
    supabase.from("events").select("id, name, college:colleges(name)").neq("status", "archived").order("starts_on", { ascending: false }),
    supabase.from("departments").select("id, name, event_id").eq("status", "active").order("sort_order"),
    supabase.from("roles").select("key, name").eq("scope", "event").order("sort_order"),
    supabase.from("roles").select("key, name").eq("scope", "department").order("sort_order"),
  ]);
  if (!user) notFound();

  const isSelf = user.id === access.user_id;
  const invitePending = (pending.data ?? []).some((p) => p.user_id === user.id);
  const active = <T extends { ended_at: string | null }>(rows: T[] | null) => (rows ?? []).filter((r) => !r.ended_at);
  const ended = [
    ...(cm.data ?? []).filter((r) => r.ended_at).map((r) => ({ id: r.id, what: `${r.role?.name ?? "Role"} · ${r.college?.name ?? ""}`, from: r.started_at, to: r.ended_at!, reason: null as string | null })),
    ...(em.data ?? []).filter((r) => r.ended_at).map((r) => ({ id: r.id, what: `${r.role?.name ?? "Role"} · ${r.event?.name ?? ""}`, from: r.started_at, to: r.ended_at!, reason: r.end_reason })),
    ...(dm.data ?? []).filter((r) => r.ended_at).map((r) => ({ id: r.id, what: `${r.role?.name ?? "Role"} · ${r.department?.name ?? ""} (${r.event?.name ?? ""})`, from: r.started_at, to: r.ended_at!, reason: r.end_reason })),
  ].sort((a, b) => b.to.localeCompare(a.to));

  const data: AccessData = {
    user: { id: user.id, email: user.email, full_name: user.full_name },
    colleges: colleges.data ?? [],
    events: (events.data ?? []).map((e) => ({ id: e.id, name: e.name, college: e.college?.name ?? "" })),
    departments: depts.data ?? [],
    eventRoles: eventRoles.data ?? [],
    departmentRoles: deptRoles.data ?? [],
    collegeAccess: active(cm.data).map((r) => ({ id: r.id, college_id: r.college_id, college: r.college?.name ?? "—", role: r.role?.name ?? "—", since: r.started_at })),
    eventAccess: active(em.data).map((r) => ({ id: r.id, event_id: r.event_id, event: r.event?.name ?? "—", role: r.role?.name ?? "—", since: r.started_at })),
    departmentAccess: active(dm.data).map((r) => ({
      id: r.id, event_id: r.event_id, department_id: r.department_id, department: r.department?.name ?? "—", event: r.event?.name ?? "—",
      position: r.position, role: r.role?.name ?? "—", since: r.started_at,
    })),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Link href="/users" className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="size-3" /> Users</Link>}
        title={isSelf ? "Your account" : user.full_name || user.email}
        description={isSelf ? "Super Admin" : user.email}
        actions={
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={user.status} />
            {invitePending ? <Badge variant="outline">Invite pending</Badge> : null}
            {user.is_super_admin ? <Badge variant="lime">Super Admin</Badge> : null}
          </div>
        }
      />
      {user.is_super_admin ? (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm">
            <ShieldCheck className="size-5 text-lime-dark" />
            Super Admin access is fixed to this account. It has every permission everywhere and cannot be assigned to anyone else.
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Joined {formatDate(user.created_at)}{user.job_title ? ` · ${user.job_title}` : ""}{user.phone ? ` · ${user.phone}` : ""}. Suspend or reactivate the account and resend invitations from the Users list.
          </p>
          <UserAccessManager data={data} />
          {isSelf || user.status === "deleted" ? null : <DeleteAccountCard userId={user.id} email={user.email} name={user.full_name} />}
        </>
      )}
      {ended.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Access history</CardTitle>
            <CardDescription>Ended assignments are kept for the record.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {ended.map((h) => (
                <li key={h.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{h.what}</span>
                  <span className="text-muted-foreground">{formatDate(h.from)} – {formatDate(h.to)}{h.reason ? ` · ${h.reason}` : ""}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
