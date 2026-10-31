import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentList, UploadDocumentDialog, type DocRow } from "@/features/documents/documents-ui";
import type { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITY, RELATED_TABLES } from "@/lib/validations/document";

/** Attachments card for any record (expense, deal, task…). Lists only documents the user may read. */
export async function DocumentsPanel({
  eventId, related, title = "Attachments", canUpload, departmentId, defaultCategory, defaultVisibility, revalidate,
}: {
  eventId: string;
  related: { table: (typeof RELATED_TABLES)[number]; id: string };
  title?: string;
  canUpload: boolean;
  departmentId?: string | null;
  defaultCategory?: (typeof DOCUMENT_CATEGORIES)[number];
  defaultVisibility?: (typeof DOCUMENT_VISIBILITY)[number];
  revalidate: string;
}) {
  const access = await requireAccess();
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, title, category, visibility, size_bytes, mime_type, created_at, archived_at, uploaded_by, department:departments(name), uploader:profiles!documents_uploaded_by_fkey(full_name)")
    .eq("event_id", eventId)
    .eq("related_table", related.table)
    .eq("related_id", related.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  const { data: dept } = departmentId ? await supabase.from("departments").select("id, name").eq("id", departmentId).maybeSingle() : { data: null };
  const rows: DocRow[] = (data ?? []).map((d) => ({
    id: d.id, title: d.title, category: d.category, visibility: d.visibility, department: d.department?.name ?? null, size_bytes: Number(d.size_bytes),
    mime_type: d.mime_type, uploader: d.uploader?.full_name ?? null, created_at: d.created_at, archived_at: d.archived_at, mine: d.uploaded_by === access.user_id,
  }));
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {canUpload ? (
          <UploadDocumentDialog
            eventId={eventId}
            departments={dept ? [dept] : []}
            defaultDepartmentId={departmentId ?? undefined}
            defaultCategory={defaultCategory}
            defaultVisibility={defaultVisibility}
            related={related}
            revalidate={revalidate}
          />
        ) : null}
      </CardHeader>
      <CardContent><DocumentList eventId={eventId} rows={rows} canArchiveAll={false} /></CardContent>
    </Card>
  );
}
