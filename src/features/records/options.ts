import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getEventPeople } from "@/features/departments/queries";
import type { OptionSets } from "@/features/records/record-dialog";

/** Select options used by operational record forms (all filtered by RLS). */
export async function getOptionSets(eventId: string): Promise<OptionSets> {
  const supabase = await createClient();
  const [depts, venues, vendors, comps, people] = await Promise.all([
    supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order"),
    supabase.from("venues").select("id, name").eq("event_id", eventId).eq("status", "active").order("name"),
    supabase.from("vendors").select("id, name").eq("event_id", eventId).eq("status", "active").order("name"),
    supabase.from("event_competitions").select("id, name").eq("event_id", eventId).order("name"),
    getEventPeople(eventId),
  ]);
  return {
    departments: (depts.data ?? []).map((d) => ({ value: d.id, label: d.name })),
    venues: (venues.data ?? []).map((v) => ({ value: v.id, label: v.name })),
    vendors: (vendors.data ?? []).map((v) => ({ value: v.id, label: v.name })),
    competitions: (comps.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    people: people.map((p) => ({ value: p.id, label: p.name || p.email })),
  };
}
