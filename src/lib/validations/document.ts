import { z } from "zod";

export const DOCUMENT_CATEGORIES = [
  "invoice", "receipt", "sponsor_proposal", "sponsor_agreement", "poster", "media_asset", "report", "vendor_document", "operational", "other",
] as const;
export const DOCUMENT_VISIBILITY = ["event", "department", "finance", "restricted"] as const;
export const RELATED_TABLES = ["expense_requests", "sponsorship_deals", "tasks", "registrations", "vendors"] as const;

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
export const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv", "text/plain", "video/mp4", "video/quicktime", "application/zip",
] as const;

export const documentRecordSchema = z.object({
  storage_path: z.string().min(10).max(500),
  title: z.string().trim().min(1, "Enter a title").max(200),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  category: z.enum(DOCUMENT_CATEGORIES),
  visibility: z.enum(DOCUMENT_VISIBILITY),
  department_id: z.string().uuid().optional().or(z.literal("")),
  mime_type: z.enum(ALLOWED_DOCUMENT_TYPES),
  size_bytes: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
  related_table: z.enum(RELATED_TABLES).optional(),
  related_id: z.string().uuid().optional(),
});
export type DocumentRecordInput = z.infer<typeof documentRecordSchema>;
