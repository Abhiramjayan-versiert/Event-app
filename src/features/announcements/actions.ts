"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { announcementSchema } from "@/lib/validations/department";

const target = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }),
  z.object({ scope: z.literal("college"), college_id: z.string().uuid() }),
  z.object({ scope: z.literal("event"), event_id: z.string().uuid() }),
]);

export async function postAnnouncementAction(targetInput: unknown, input: unknown): Promise<ActionResult> {
  const t = target.safeParse(targetInput);
  if (!t.success) return { ok: false, error: "Invalid audience." };
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const { error } = await supabase.from("announcements").insert({
    scope: t.data.scope,
    college_id: t.data.scope === "college" ? t.data.college_id : null,
    event_id: t.data.scope === "event" ? t.data.event_id : null,
    title: parsed.data.title,
    body: parsed.data.body,
    priority: parsed.data.priority,
    pinned: parsed.data.pinned,
    created_by: me.user?.id ?? null,
  });
  if (error) return fromDbError(error, "You cannot post announcements to this audience.");
  revalidatePath("/announcements");
  revalidatePath("/dashboard");
  if (t.data.scope === "event") revalidatePath(`/events/${t.data.event_id}/announcements`);
  return { ok: true, message: "Announcement published." };
}

export async function removeAnnouncementAction(id: string, path: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid announcement." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("announcements").delete().eq("id", id).select("id");
  if (error || !data?.length) return fromDbError(error, "Only the author can delete this announcement.");
  if (path.startsWith("/")) revalidatePath(path);
  return { ok: true, message: "Announcement deleted." };
}

export async function markNotificationsReadAction(ids: string[] | "all"): Promise<ActionResult> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  let q = supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  if (ids !== "all") {
    if (!ids.every((i) => z.string().uuid().safeParse(i).success)) return { ok: false, error: "Invalid request." };
    q = q.in("id", ids);
  }
  const { error } = await q;
  if (error) return fromDbError(error, "Could not update notifications.");
  revalidatePath("/notifications");
  return { ok: true, message: "Marked as read." };
}
