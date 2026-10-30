import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { getEventPeople, getRoleOptions } from "@/features/departments/queries";
import { TeamTable, type TeamRow } from "@/features/departments/team-table";

export const metadata = { title: "Team" };

const POSITION = { head: "Head", assistant_head: "Assistant head", member: "Member" } as Record<string, string>;

export default async function TeamPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { permissions } = await getEventContext(eventId);
  const [people, roles] = await Promise.all([getEventPeople(eventId), getRoleOptions("event")]);

  const rows: TeamRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    avatar_path: p.avatar_path,
    eventRoles: p.eventRoles.map((r) => r.role),
    departments: p.departmentRoles.map((d) => ({
      id: d.departmentId,
      label: `${d.department} · ${d.position === "member" ? d.role : POSITION[d.position]}`,
      lead: d.position !== "member",
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Team" description={`${rows.length} ${rows.length === 1 ? "person" : "people"} working on this event.`} />
      <TeamTable eventId={eventId} rows={rows} canManage={can(permissions, "event.members.manage")} selfId={access.user_id} eventRoles={roles} />
    </div>
  );
}
