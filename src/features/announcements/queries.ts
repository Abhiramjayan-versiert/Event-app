import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AnnouncementItem } from "@/features/announcements/announcements-ui";

export async function loadAnnouncements(filter: { eventId?: string; limit?: number }, userId: string): Promise<AnnouncementItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("announcements")
    .select("id, title, body, priority, pinned, published_at, scope, created_by, author:profiles!announcements_created_by_fkey(full_name), college:colleges(name), event:events(name), department:departments(name)")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(filter.limit ?? 50);
  if (filter.eventId) q = q.eq("event_id", filter.eventId);
  const { data } = await q;
  return (data ?? []).map((a) => ({
    id: a.id, title: a.title, body: a.body, priority: a.priority, pinned: a.pinned, published_at: a.published_at,
    author: a.author?.full_name ?? "Someone", mine: a.created_by === userId,
    audience: a.scope === "global" ? "Everyone" : a.scope === "college" ? a.college?.name ?? "College" : a.scope === "event" ? a.event?.name ?? "Event" : a.department?.name ?? "Department",
  }));
}
