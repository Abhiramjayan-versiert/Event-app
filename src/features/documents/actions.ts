"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError, fromZodError } from "@/lib/actions";
import { documentRecordSchema } from "@/lib/validations/document";

const uuid = z.string().uuid();

export async function createDocumentRecordAction(eventId: string, input: unknown, revalidate?: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success) return { ok: false, error: "Invalid event." };
  const parsed = documentRecordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const v = parsed.data;
  // The object must live under this event's folder (storage RLS checked the upload).
  if (!v.storage_path.startsWith(`${eventId}/`)) return { ok: false, error: "Invalid file path." };
  if (v.visibility === "department" && !v.department_id) return { ok: false, error: "Choose a department for department-only documents." };
  const supabase = await createClient();
  const [{ data: me }, { data: event }] = await Promise.all([supabase.auth.getUser(), supabase.from("events").select("college_id").eq("id", eventId).single()]);
  const { error } = await supabase.from("documents").insert({
    event_id: eventId, college_id: event?.college_id ?? "", department_id: v.department_id || null, category: v.category, title: v.title,
    description: v.description || null, storage_path: v.storage_path, mime_type: v.mime_type, size_bytes: v.size_bytes, visibility: v.visibility,
    related_table: v.related_table ?? null, related_id: v.related_id ?? null, uploaded_by: me.user?.id ?? null,
  });
  if (error) {
    // Clean up the uploaded object so it does not linger unreferenced.
    await supabase.storage.from("documents").remove([v.storage_path]);
    return fromDbError(error, "You cannot upload documents here.");
  }
  revalidatePath(`/events/${eventId}/documents`);
  if (revalidate?.startsWith(`/events/${eventId}`)) revalidatePath(revalidate);
  return { ok: true, message: "Document uploaded." };
}

/** Short-lived signed URL; storage RLS only signs objects whose document record the user can read. */
export async function getDocumentUrlAction(documentId: string): Promise<ActionResult<{ url: string }>> {
  if (!uuid.safeParse(documentId).success) return { ok: false, error: "Invalid document." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("bucket, storage_path, title").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, error: "Document not found or not accessible." };
  const { data, error } = await supabase.storage.from(doc.bucket).createSignedUrl(doc.storage_path, 120, { download: doc.title });
  if (error || !data) return { ok: false, error: "Could not create a download link." };
  return { ok: true, data: { url: data.signedUrl } };
}

export async function archiveDocumentAction(eventId: string, documentId: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(documentId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("documents").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", documentId).eq("event_id", eventId).select("id");
  if (error) return fromDbError(error, "Could not update the document.");
  if (!data?.length) return { ok: false, error: "Only the uploader or document managers can archive this." };
  revalidatePath(`/events/${eventId}`, "layout");
  return { ok: true, message: archived ? "Document archived." : "Document restored." };
}
