import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEventContext, requireAccess } from "@/lib/auth/session";
import { can, canAnywhere, departmentIdsWith } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentList, UploadDocumentDialog, type DocRow } from "@/features/documents/documents-ui";
import { DOCUMENT_CATEGORIES } from "@/lib/validations/document";
import { cn, titleCase } from "@/lib/utils";

export const metadata = { title: "Documents" };

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ category?: string; archived?: string }> }) {
  const { eventId } = await params;
  const { category, archived } = await searchParams;
  const access = await requireAccess();
  const { permissions } = await getEventContext(eventId);
  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select("id, title, category, visibility, size_bytes, mime_type, created_at, archived_at, uploaded_by, department:departments(name), uploader:profiles!documents_uploaded_by_fkey(full_name)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .limit(500);
  query = archived === "1" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (category && (DOCUMENT_CATEGORIES as readonly string[]).includes(category)) query = query.eq("category", category);
  const [{ data }, depts] = await Promise.all([query, supabase.from("departments").select("id, name").eq("event_id", eventId).eq("status", "active").order("sort_order")]);

  const uploadAll = can(permissions, "documents.upload");
  const uploadDepts = (depts.data ?? []).filter((d) => uploadAll || departmentIdsWith(permissions, "documents.upload").includes(d.id));
  const canUpload = uploadAll || canAnywhere(permissions, "documents.upload");
  const rows: DocRow[] = (data ?? []).map((d) => ({
    id: d.id, title: d.title, category: d.category, visibility: d.visibility, department: d.department?.name ?? null, size_bytes: Number(d.size_bytes),
    mime_type: d.mime_type, uploader: d.uploader?.full_name ?? null, created_at: d.created_at, archived_at: d.archived_at, mine: d.uploaded_by === access.user_id,
  }));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ category, archived, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/events/${eventId}/documents${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Invoices, receipts, agreements, posters, reports and operational files. Private storage; each document's visibility decides who can open it."
        actions={canUpload ? <UploadDocumentDialog eventId={eventId} departments={uploadDepts} defaultDepartmentId={uploadAll ? undefined : uploadDepts[0]?.id} defaultVisibility={uploadAll ? "event" : "department"} trigger={<Button>Upload document</Button>} /> : null}
      />
      <div className="flex flex-wrap gap-1">
        <Link href={qs({ category: undefined })} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", !category ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>All</Link>
        {DOCUMENT_CATEGORIES.map((c) => <Link key={c} href={qs({ category: c })} className={cn("rounded-md px-2.5 py-1 text-xs font-medium", category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{titleCase(c)}</Link>)}
        <Link href={qs({ archived: archived === "1" ? undefined : "1" })} className="ml-auto rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{archived === "1" ? "Show current" : "Show archived"}</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No documents" description="Upload files to share them with the right people." />
      ) : (
        <Card><CardContent className="pt-2"><DocumentList eventId={eventId} rows={rows} canArchiveAll={can(permissions, "documents.view_all")} /></CardContent></Card>
      )}
    </div>
  );
}
