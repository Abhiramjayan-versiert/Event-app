import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canInDepartment, departmentIdsWith } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { getEventPeople } from "@/features/departments/queries";
import { MyDuties, ShiftCard, ShiftDialog, type Shift } from "@/features/duty/roster-ui";

export const metadata = { title: "Duty roster" };

export default async function DutyRosterPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const access = await requireAccess();
  const { event, permissions } = await getEventContext(eventId);
  const supabase = await createClient();
  const [{ data: shifts }, { data: depts }, people] = await Promise.all([
    supabase.from("duty_shifts")
      .select("id, title, location, department_id, starts_at, ends_at, needed, notes, department:departments(name), assignments:duty_assignments(id, user_id, status, user:profiles!duty_assignments_user_id_fkey(full_name, email))")
      .eq("event_id", eventId).order("starts_at"),
    supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order"),
    getEventPeople(eventId),
  ]);
  const opsManager = can(permissions, "operations.manage");
  const leadDepts = new Set(departmentIdsWith(permissions, "department.manage"));
  const list: Shift[] = (shifts ?? []).map((s) => ({
    id: s.id, title: s.title, location: s.location, department_id: s.department_id, department: s.department?.name ?? null,
    starts_at: s.starts_at, ends_at: s.ends_at, needed: s.needed, notes: s.notes,
    canManage: opsManager || (s.department_id ? canInDepartment(permissions, s.department_id, "department.manage") : false),
    assignments: (s.assignments ?? []).map((a) => ({ id: a.id, user_id: a.user_id, name: a.user?.full_name || a.user?.email || "Member", status: a.status as Shift["assignments"][number]["status"] })),
  }));
  const tz = event.timezone;
  const byDay = new Map<string, Shift[]>();
  for (const s of list) {
    const k = new Date(s.starts_at).toLocaleDateString("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" });
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const mine = list.flatMap((s) => s.assignments.filter((a) => a.user_id === access.user_id).map((a) => ({ assignment: a, shift: s })));
  const canCreate = opsManager || leadDepts.size > 0;
  const deptOptions = (depts ?? []).filter((d) => opsManager || leadDepts.has(d.id));
  const all = list.flatMap((s) => s.assignments);
  const peopleOptions = people.map((p) => ({ id: p.id, name: p.name, email: p.email }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={event.name}
        title="Duty roster"
        description="Shifts for volunteers and the team. People are notified when assigned and can check in when their shift starts."
        actions={canCreate ? <ShiftDialog eventId={eventId} departments={deptOptions} trigger={<Button><Plus /> New shift</Button>} /> : null}
      />
      <MyDuties eventId={eventId} duties={mine} tz={tz} />
      {canCreate && list.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatCard label="Shifts" value={list.length} highlight />
          <StatCard label="Unfilled spots" value={list.reduce((n, s) => n + Math.max(s.needed - s.assignments.length, 0), 0)} />
          <StatCard label="Present" value={all.filter((a) => a.status === "present").length} />
          <StatCard label="No-shows" value={all.filter((a) => a.status === "absent").length} />
        </div>
      ) : null}
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canCreate ? "No shifts yet. Add the first one." : "No shifts have been planned yet."}</p>
      ) : (
        [...byDay.entries()].map(([d, items]) => (
          <section key={d} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{d}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {items.map((s) => <ShiftCard key={s.id} eventId={eventId} shift={s} people={peopleOptions} departments={deptOptions} tz={tz} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
