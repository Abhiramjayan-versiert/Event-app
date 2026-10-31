"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Download, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/shared/form-field";
import { createClient } from "@/lib/supabase/client";
import { safeFileName } from "@/lib/storage";
import {
  ALLOWED_DOCUMENT_TYPES, DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITY, MAX_DOCUMENT_BYTES, type RELATED_TABLES,
} from "@/lib/validations/document";
import { archiveDocumentAction, createDocumentRecordAction, getDocumentUrlAction } from "@/features/documents/actions";
import { formatDate, titleCase } from "@/lib/utils";

const VIS_LABEL: Record<string, string> = {
  event: "Everyone in the event", department: "Department only", finance: "Finance only", restricted: "Event managers only",
};

export function UploadDocumentDialog({
  eventId, departments, defaultDepartmentId, defaultCategory = "other", defaultVisibility = "event", related, revalidate, trigger,
}: {
  eventId: string;
  departments: { id: string; name: string }[];
  defaultDepartmentId?: string;
  defaultCategory?: (typeof DOCUMENT_CATEGORIES)[number];
  defaultVisibility?: (typeof DOCUMENT_VISIBILITY)[number];
  related?: { table: (typeof RELATED_TABLES)[number]; id: string };
  revalidate?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", category: defaultCategory, visibility: defaultVisibility, department_id: defaultDepartmentId ?? "", description: "" });

  function pick(f: File | undefined) {
    if (!f) return;
    if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(f.type)) return void toast.error("This file type is not allowed.");
    if (f.size > MAX_DOCUMENT_BYTES) return void toast.error("Files must be 50 MB or smaller.");
    setFile(f);
    setForm((v) => ({ ...v, title: v.title || f.name.replace(/\.[^.]+$/, "") }));
  }

  function upload() {
    if (!file) return void toast.error("Choose a file.");
    startTransition(async () => {
      const folder = form.department_id || "event";
      const path = `${eventId}/${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      const { error } = await createClient().storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
      if (error) return void toast.error("Upload failed. You may not have permission to upload here.");
      const r = await createDocumentRecordAction(
        eventId,
        { ...form, storage_path: path, mime_type: file.type, size_bytes: file.size, related_table: related?.table, related_id: related?.id },
        revalidate,
      );
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Uploaded");
      setOpen(false);
      setFile(null);
      setForm((v) => ({ ...v, title: "", description: "" }));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="outline"><Upload /> Upload</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>Stored privately. Downloads use short-lived links checked against your access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <input ref={input} type="file" className="hidden" accept={ALLOWED_DOCUMENT_TYPES.join(",")} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted">
            <FileText className="size-5" />
            {file ? <span className="font-medium text-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span> : "Choose a file (PDF, images, Office, CSV, video, ZIP — max 50 MB)"}
          </button>
          <FormField id="doc-title" label="Title" required><Input id="doc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="doc-cat" label="Category">
              <NativeSelect id="doc-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as typeof form.category })}>
                {DOCUMENT_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="doc-vis" label="Who can see it">
              <NativeSelect id="doc-vis" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as typeof form.visibility })}>
                {DOCUMENT_VISIBILITY.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
              </NativeSelect>
            </FormField>
          </div>
          <FormField id="doc-dept" label="Department" hint={form.visibility === "department" ? "Required for department-only documents." : undefined}>
            <NativeSelect id="doc-dept" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
              <option value="">Event-wide</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={pending} onClick={upload}>Upload</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DownloadButton({ documentId }: { documentId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Download"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await getDocumentUrlAction(documentId);
          if (!r.ok) return void toast.error(r.error);
          window.location.href = (r.data as { url: string }).url;
        })
      }
    >
      {pending ? null : <Download />}
    </Button>
  );
}

export function ArchiveDocumentButton({ eventId, documentId, archived }: { eventId: string; documentId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={archived ? "Restore" : "Archive"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await archiveDocumentAction(eventId, documentId, !archived);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message ?? "Saved");
          router.refresh();
        })
      }
    >
      {archived ? <ArchiveRestore /> : <Archive />}
    </Button>
  );
}

export type DocRow = {
  id: string; title: string; category: string; visibility: string; department: string | null; size_bytes: number; mime_type: string;
  uploader: string | null; created_at: string; archived_at: string | null; mine: boolean;
};

export function DocumentList({ eventId, rows, canArchiveAll }: { eventId: string; rows: DocRow[]; canArchiveAll: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No documents.</p>;
  return (
    <ul className="divide-y">
      {rows.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{d.title}{d.archived_at ? <Badge variant="muted" className="ml-2">Archived</Badge> : null}</p>
              <p className="truncate text-xs text-muted-foreground">
                {titleCase(d.category)} · {VIS_LABEL[d.visibility]}{d.department ? ` · ${d.department}` : ""} · {(d.size_bytes / 1024).toFixed(0)} KB · {d.uploader ?? "—"} · {formatDate(d.created_at)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <DownloadButton documentId={d.id} />
            {d.mine || canArchiveAll ? <ArchiveDocumentButton eventId={eventId} documentId={d.id} archived={Boolean(d.archived_at)} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
