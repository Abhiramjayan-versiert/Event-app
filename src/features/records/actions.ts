"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { RECORDS, type RecordKind } from "@/lib/records/config";

const uuid = z.string().uuid();
const DELETABLE: RecordKind[] = ["venue", "inventory", "emergency_contact", "schedule_item", "campaign", "media_asset"];

/** datetime-local values come from the browser's timezone; convert with its offset. */
function toIso(local: string, offsetMinutes: number) {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return new Date(local).toISOString();
  return new Date(Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`) + offsetMinutes * 60_000).toISOString();
}

export async function saveRecordAction(kind: RecordKind, eventId: string, id: string | null, values: unknown, tzOffset = 0): Promise<ActionResult> {
  const def = RECORDS[kind];
  if (!def || !uuid.safeParse(eventId).success || (id && !uuid.safeParse(id).success)) return { ok: false, error: "Invalid request." };
  const parsed = def.schema.safeParse(values);
  if (!parsed.success) return fromZodError(parsed.error);
  const row: Record<string, unknown> = { ...(parsed.data as Record<string, unknown>) };
  for (const f of def.fields) {
    if (f.type === "datetime" && typeof row[f.name] === "string" && row[f.name]) row[f.name] = toIso(row[f.name] as string, tzOffset);
  }
  if (kind === "schedule_item" && row.ends_at && row.starts_at && String(row.ends_at) < String(row.starts_at)) {
    return { ok: false, error: "End must be after start.", fieldErrors: { ends_at: ["End must be after start"] } };
  }
  if (kind === "campaign" && row.start_date && row.end_date && String(row.end_date) < String(row.start_date)) {
    return { ok: false, error: "End date must be after the start date." };
  }

  const supabase = await createClient();
  const table = supabase.from(def.table as "venues");
  if (id) {
    const { data, error } = await table.update(row as never).eq("id", id).eq("event_id", eventId).select("id");
    if (error) return fromDbError(error, `Could not save the ${def.title.toLowerCase()}.`);
    if (!data?.length) return { ok: false, error: `You do not have permission to edit this ${def.title.toLowerCase()}.` };
  } else {
    const { data: event } = await supabase.from("events").select("college_id").eq("id", eventId).single();
    const { error } = await table.insert({ ...row, event_id: eventId, college_id: event?.college_id ?? "" } as never);
    if (error) return fromDbError(error, `You do not have permission to add a ${def.title.toLowerCase()} here.`);
  }
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: `${def.title} saved.` };
}

export async function deleteRecordAction(kind: RecordKind, eventId: string, id: string): Promise<ActionResult> {
  const def = RECORDS[kind];
  if (!def || !DELETABLE.includes(kind) || !uuid.safeParse(eventId).success || !uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from(def.table as "venues").delete().eq("id", id).eq("event_id", eventId).select("id");
  if (error) return fromDbError(error, `Could not delete the ${def.title.toLowerCase()}.`);
  if (!data?.length) return { ok: false, error: "You do not have permission to delete this." };
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: `${def.title} deleted.` };
}
