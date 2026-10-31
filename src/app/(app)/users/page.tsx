import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/session";
import { canSeeGlobalDashboard } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { InviteUserDialog, UsersTable, type UserRow } from "@/features/users/users-table";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const access = await requireAccess();
  if (!canSeeGlobalDashboard(access)) notFound();
  const supabase = await createClient();

  const [{ data, error }, colleges, events] = await Promise.all([
    supabase
      .from("profiles")
      .select(`id, full_name, email, avatar_path, status, is_super_admin, created_at,
        college_members!college_members_user_id_fkey(ended_at, role:roles(name), college:colleges(code)),
        event_members!event_members_user_id_fkey(ended_at, role:roles(name), event:events(name)),
        department_members!department_members_user_id_fkey(ended_at, role:roles(name), department:departments(name, event:events(name)))`)
      .order("created_at", { ascending: false }),
    access.is_super_admin
      ? supabase.from("colleges").select("id, name").neq("status", "archived").order("name")
      : Promise.resolve({ data: access.colleges.filter((c) => c.roles.includes("college_admin")).map((c) => ({ id: c.id, name: c.name })) }),
    supabase.from("events").select("id, name, college:colleges(name)").neq("status", "archived").order("starts_on", { ascending: false }),
  ]);
  const pending = access.is_super_admin ? new Set(((await supabase.rpc("pending_invitations")).data ?? []).map((p) => p.user_id)) : new Set<string>();
  if (error) return <ErrorState title="Could not load users" message={error.message} />;

  const rows: UserRow[] = (data ?? []).map((p) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email,
    avatar_path: p.avatar_path,
    status: p.status,
    is_super_admin: p.is_super_admin,
    created_at: p.created_at,
    invite_pending: pending.has(p.id),
    roles: [
      ...p.college_members.filter((m) => !m.ended_at).map((m) => `${m.role?.name} · ${m.college?.code}`),
      ...p.event_members.filter((m) => !m.ended_at).map((m) => `${m.role?.name} · ${m.event?.name}`),
      ...p.department_members.filter((m) => !m.ended_at).map((m) => `${m.role?.name} · ${m.department?.name} (${m.department?.event?.name})`),
    ],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={access.is_super_admin ? "Everyone on the platform. Users cannot register themselves — they are invited." : "People working in your colleges and events."}
        actions={
          <InviteUserDialog
            isSuperAdmin={access.is_super_admin}
            colleges={colleges.data ?? []}
            events={(events.data ?? []).map((e) => ({ id: e.id, name: e.name, college: e.college?.name ?? "" }))}
          />
        }
      />
      <UsersTable rows={rows} isSuperAdmin={access.is_super_admin} selfId={access.user_id} />
    </div>
  );
}
