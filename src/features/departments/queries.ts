import "server-only";

import { createClient } from "@/lib/supabase/server";

export type EventPerson = {
  id: string;
  name: string;
  email: string;
  avatar_path: string | null;
  eventRoles: { membershipId: string; role: string; since: string }[];
  departmentRoles: { membershipId: string; departmentId: string; department: string; position: string; role: string; since: string }[];
};

/** Everyone currently active in an event (event-level roles and department positions). */
export async function getEventPeople(eventId: string): Promise<EventPerson[]> {
  const supabase = await createClient();
  const [em, dm] = await Promise.all([
    supabase
      .from("event_members")
      .select("id, started_at, user:profiles!event_members_user_id_fkey(id, full_name, email, avatar_path), role:roles(name)")
      .eq("event_id", eventId)
      .is("ended_at", null),
    supabase
      .from("department_members")
      .select("id, position, assigned_at, department:departments(id, name), user:profiles!department_members_user_id_fkey(id, full_name, email, avatar_path), role:roles(name)")
      .eq("event_id", eventId)
      .is("ended_at", null),
  ]);

  const people = new Map<string, EventPerson>();
  const person = (u: { id: string; full_name: string; email: string; avatar_path: string | null }) => {
    let p = people.get(u.id);
    if (!p) {
      p = { id: u.id, name: u.full_name, email: u.email, avatar_path: u.avatar_path, eventRoles: [], departmentRoles: [] };
      people.set(u.id, p);
    }
    return p;
  };
  for (const m of em.data ?? []) {
    if (m.user) person(m.user).eventRoles.push({ membershipId: m.id, role: m.role?.name ?? "—", since: m.started_at });
  }
  for (const m of dm.data ?? []) {
    if (m.user && m.department) {
      person(m.user).departmentRoles.push({
        membershipId: m.id, departmentId: m.department.id, department: m.department.name, position: m.position,
        role: m.role?.name ?? "—", since: m.assigned_at,
      });
    }
  }
  return [...people.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export async function getRoleOptions(scope: "event" | "department") {
  const supabase = await createClient();
  const { data } = await supabase.from("roles").select("key, name").eq("scope", scope).order("sort_order");
  return data ?? [];
}

/**
 * Every active user the signed-in admin may see (RLS: Super Admin sees all,
 * College Admins see people in their colleges, others see their teammates),
 * for "assign an existing user" pickers. The Super Admin is never listed.
 */
export async function getAssignablePeople(): Promise<{ id: string; name: string; email: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("status", "active")
    .eq("is_super_admin", false)
    .order("full_name")
    .limit(2000);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name, email: p.email }));
}
