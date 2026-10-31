import { z } from "zod";

/**
 * Config-driven CRUD for operational records. The same definitions drive the
 * client forms and the server-side validation; the database (RLS) decides
 * whether the user may write.
 */
export type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "select" | "switch" | "url" | "email" | "tel";
export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** Options supplied at runtime (departments, venues, people…). */
  optionsKey?: "departments" | "venues" | "vendors" | "people" | "competitions";
  hint?: string;
  wide?: boolean;
};

const s = (max = 200) => z.string().trim().max(max);
const optStr = (max = 200) => s(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const optUuid = z.string().uuid().optional().or(z.literal("")).transform((v) => (v ? v : null));
const optNum = z.union([z.number(), z.nan(), z.null()]).optional().transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : null));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => (v ? v : null));
const optDateTime = z.string().optional().or(z.literal("")).transform((v) => (v ? v : null));

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) }));

export const RECORDS = {
  venue: {
    table: "venues",
    title: "Venue",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "location", label: "Location", type: "text" },
      { name: "capacity", label: "Capacity", type: "number" },
      { name: "contact_person", label: "Contact person", type: "text" },
      { name: "contact_phone", label: "Contact phone", type: "tel" },
      { name: "status", label: "Status", type: "select", options: opts(["active", "archived"]) },
      { name: "facilities", label: "Facilities", type: "textarea", wide: true },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    schema: z.object({
      name: s(200).min(2), location: optStr(300), capacity: optNum, contact_person: optStr(120), contact_phone: optStr(32),
      status: z.enum(["active", "archived"]).default("active"), facilities: optStr(2000), notes: optStr(2000),
    }),
  },
  vendor: {
    table: "vendors",
    title: "Vendor",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "category", label: "Category", type: "text", hint: "e.g. Catering, Sound, Printing" },
      { name: "contact_person", label: "Contact person", type: "text" },
      { name: "phone", label: "Phone", type: "tel" },
      { name: "email", label: "Email", type: "email" },
      { name: "tax_id", label: "GSTIN / tax ID", type: "text" },
      { name: "department_id", label: "Department", type: "select", optionsKey: "departments" },
      { name: "rating", label: "Rating (1–5)", type: "number" },
      { name: "address", label: "Address", type: "text", wide: true },
      { name: "bank_details_note", label: "Payment details note", type: "text", wide: true, hint: "Do not store full account numbers here." },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
      { name: "status", label: "Status", type: "select", options: opts(["active", "archived"]) },
    ],
    schema: z.object({
      name: s(200).min(2), category: optStr(80), contact_person: optStr(120), phone: optStr(32),
      email: z.string().trim().toLowerCase().email().optional().or(z.literal("")).transform((v) => (v ? v : null)),
      tax_id: optStr(40), department_id: optUuid, rating: optNum.refine((v) => v === null || (v >= 1 && v <= 5), "1 to 5"),
      address: optStr(500), bank_details_note: optStr(300), notes: optStr(2000), status: z.enum(["active", "archived"]).default("active"),
    }),
  },
  inventory: {
    table: "inventory",
    title: "Inventory item",
    fields: [
      { name: "name", label: "Item", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      { name: "quantity", label: "Quantity", type: "number", required: true },
      { name: "unit", label: "Unit", type: "text" },
      { name: "status", label: "Status", type: "select", options: opts(["required", "requested", "arranged", "in_use", "returned", "damaged", "lost"]) },
      { name: "department_id", label: "Department", type: "select", optionsKey: "departments" },
      { name: "venue_id", label: "Venue", type: "select", optionsKey: "venues" },
      { name: "vendor_id", label: "Vendor", type: "select", optionsKey: "vendors" },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    schema: z.object({
      name: s(200).min(2), category: optStr(80), quantity: z.number().int().min(0).max(1e6), unit: s(30).default("unit"),
      status: z.enum(["required", "requested", "arranged", "in_use", "returned", "damaged", "lost"]).default("required"),
      department_id: optUuid, venue_id: optUuid, vendor_id: optUuid, notes: optStr(2000),
    }),
  },
  emergency_contact: {
    table: "emergency_contacts",
    title: "Emergency contact",
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "role", label: "Role", type: "text", required: true, hint: "e.g. Ambulance, Campus security, Fire" },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "alt_phone", label: "Alternate phone", type: "tel" },
      { name: "sort_order", label: "Order", type: "number" },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    schema: z.object({
      name: s(120).min(2), role: s(120).min(2), phone: s(32).min(3), alt_phone: optStr(32),
      sort_order: optNum.transform((v) => v ?? 100), notes: optStr(1000),
    }),
  },
  schedule_item: {
    table: "event_schedules",
    title: "Schedule item",
    fields: [
      { name: "title", label: "Title", type: "text", required: true, wide: true },
      { name: "item_type", label: "Type", type: "select", options: opts(["session", "competition", "ceremony", "performance", "logistics", "meal", "break", "other"]) },
      { name: "status", label: "Status", type: "select", options: opts(["scheduled", "in_progress", "completed", "delayed", "cancelled"]) },
      { name: "starts_at", label: "Starts", type: "datetime", required: true },
      { name: "ends_at", label: "Ends", type: "datetime" },
      { name: "venue_id", label: "Venue", type: "select", optionsKey: "venues" },
      { name: "location", label: "Location (if not a venue)", type: "text" },
      { name: "department_id", label: "Responsible department", type: "select", optionsKey: "departments" },
      { name: "assigned_team", label: "Assigned team / people", type: "text" },
      { name: "competition_id", label: "Competition", type: "select", optionsKey: "competitions" },
      { name: "is_public", label: "Show on public website", type: "switch" },
      { name: "description", label: "Description", type: "textarea", wide: true },
    ],
    schema: z.object({
      title: s(200).min(2), item_type: z.enum(["session", "competition", "ceremony", "performance", "logistics", "meal", "break", "other"]).default("session"),
      status: z.enum(["scheduled", "in_progress", "completed", "delayed", "cancelled"]).default("scheduled"),
      starts_at: z.string().min(1, "Required"), ends_at: optDateTime, venue_id: optUuid, location: optStr(200), department_id: optUuid,
      assigned_team: optStr(200), competition_id: optUuid, is_public: z.boolean().default(false), description: optStr(2000),
    }),
  },
  campaign: {
    table: "marketing_campaigns",
    title: "Campaign",
    fields: [
      { name: "name", label: "Campaign", type: "text", required: true },
      { name: "platform", label: "Platform", type: "text", required: true, hint: "Instagram, College visits, Posters…" },
      { name: "channel_type", label: "Channel", type: "select", options: opts(["online", "offline", "ambassador", "influencer"]) },
      { name: "status", label: "Status", type: "select", options: opts(["planned", "active", "paused", "completed", "cancelled"]) },
      { name: "start_date", label: "Start", type: "date" },
      { name: "end_date", label: "End", type: "date" },
      { name: "budget", label: "Budget", type: "number" },
      { name: "actual_spend", label: "Actual spend", type: "number" },
      { name: "reach", label: "Reach", type: "number" },
      { name: "impressions", label: "Impressions", type: "number" },
      { name: "engagement", label: "Engagement", type: "number" },
      { name: "registrations_generated", label: "Registrations generated", type: "number" },
      { name: "owner_id", label: "Owner", type: "select", optionsKey: "people" },
      { name: "objective", label: "Objective", type: "textarea", wide: true },
      { name: "notes", label: "Notes", type: "textarea", wide: true },
    ],
    schema: z.object({
      name: s(200).min(2), platform: s(80).min(2), channel_type: z.enum(["online", "offline", "ambassador", "influencer"]).default("online"),
      status: z.enum(["planned", "active", "paused", "completed", "cancelled"]).default("planned"), start_date: optDate, end_date: optDate,
      budget: optNum.transform((v) => v ?? 0), actual_spend: optNum.transform((v) => v ?? 0), reach: optNum.transform((v) => v ?? 0),
      impressions: optNum.transform((v) => v ?? 0), engagement: optNum.transform((v) => v ?? 0),
      registrations_generated: optNum.transform((v) => v ?? 0), owner_id: optUuid, objective: optStr(2000), notes: optStr(2000),
    }),
  },
  media_asset: {
    table: "media_assets",
    title: "Media item",
    fields: [
      { name: "title", label: "Title", type: "text", required: true, wide: true },
      { name: "asset_type", label: "Type", type: "select", options: opts(["photo", "video", "poster", "reel", "press_release", "social_post", "coverage", "other"]) },
      { name: "status", label: "Status", type: "select", options: opts(["draft", "pending_approval", "approved", "published", "rejected"]) },
      { name: "platform", label: "Platform / outlet", type: "text" },
      { name: "scheduled_for", label: "Scheduled for", type: "datetime" },
      { name: "published_url", label: "Published link", type: "url", wide: true },
      { name: "reach", label: "Reach", type: "number" },
      { name: "engagement", label: "Engagement", type: "number" },
    ],
    schema: z.object({
      title: s(200).min(2), asset_type: z.enum(["photo", "video", "poster", "reel", "press_release", "social_post", "coverage", "other"]).default("social_post"),
      status: z.enum(["draft", "pending_approval", "approved", "published", "rejected"]).default("draft"), platform: optStr(80),
      scheduled_for: optDateTime, published_url: optStr(500), reach: optNum, engagement: optNum,
    }),
  },
} satisfies Record<string, { table: string; title: string; fields: Field[]; schema: z.ZodTypeAny }>;

export type RecordKind = keyof typeof RECORDS;
