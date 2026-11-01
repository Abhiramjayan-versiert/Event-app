import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessRow, type AccessPerson } from "@/features/access/access-ui";

export const metadata = { title: "Department access" };

const POSITION: Record<string, string> = { head: "Head", co_head: "Co-head", assistant_head: "Assistant head", member: "Member" };

/** College Admins and the Super Admin: who can open which department of this event. */
export default async function DepartmentAccessPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { event } = await getEventContext(eventId);
  const supabase = await createClient();
  const { data: isCollegeAdmin } = await supabase.rpc("check_permission", { p_scope: "college", p_id: event.college_id, p_permission: "college.manage" });
  if (!access.is_super_admin && !isCollegeAdmin) notFound();

  const [depts, em, dm, grants] = await Promise.all([
    supabase.from("departments").select("id, name").eq("event_id", eventId).neq("status", "archived").order("sort_order").order("name"),
    supabase.from("event_members").select("user_id, all_departments, role:roles(name), user:profiles!event_members_user_id_fkey(full_name, email)").eq("event_id", eventId).is("ended_at", null),
    supabase.from("department_members").select("user_id, department_id, position, department:departments(name), user:profiles!department_members_user_id_fkey(full_name, email)").eq("event_id", eventId).is("ended_at", null),
    supabase.from("department_access_grants").select("id, user_id, department_id, access, department:departments(name), user:profiles!department_access_grants_user_id_fkey(full_name, email)").eq("event_id", eventId).is("ended_at", null),
  ]);

  const people = new Map<string, AccessPerson>();
  const person = (id: string, u: { full_name: string; email: string } | null) => {
    let p = people.get(id);
    if (!p) {
      p = { userId: id, name: u?.full_name ?? "", email: u?.email ?? "", eventRoles: [], allDepartments: false, own: [], grants: [] };
      people.set(id, p);
    }
    return p;
  };
  for (const m of em.data ?? []) {
    const p = person(m.user_id, m.user);
    if (m.role?.name) p.eventRoles.push(m.role.name);
    p.allDepartments ||= m.all_departments;
  }
  for (const m of dm.data ?? []) person(m.user_id, m.user).own.push({ departmentId: m.department_id, department: m.department?.name ?? "", position: POSITION[m.position] ?? m.position });
  for (const g of grants.data ?? []) {
    person(g.user_id, g.user).grants.push({ id: g.id, departmentId: g.department_id, department: g.department?.name ?? "", access: g.access as "view" | "manage" });
  }
  const list = [...people.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const confined = list.filter((p) => p.eventRoles.length > 0 && p.own.length > 0 && !p.allDepartments).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event.name}
        title="Department access"
        description="Decide which departments each person can open. Only College Admins and the Super Admin can change this."
      />
      <Card>
        <CardHeader>
          <CardTitle>How access works</CardTitle>
        </CardHeader>
        <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>People placed in a department can open only that department, even if they are also an Event Admin.</li>
              <li>Switch on <b>All departments</b> for organisers who need the whole event (Event Admin powers apply again).</li>
              <li>Or give access to specific departments: <b>View</b> to see it, <b>Manage</b> to work in it like its head.</li>
              <li>Head roles keep their event-wide area: Finance sees finance for every department, Registration sees registrations, Media sees media.</li>
            </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>People in this event</CardTitle>
          <CardDescription>{list.length} people · {confined} Event Admin{confined === 1 ? "" : "s"} limited to their own department</CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nobody has a role in this event yet.</p>
          ) : (
            <ul className="divide-y">
              {list.map((p) => <AccessRow key={p.userId} eventId={eventId} person={p} departments={depts.data ?? []} />)}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
