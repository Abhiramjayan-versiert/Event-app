import { z } from "zod";

export const INCOME_CATEGORIES = [
  "online_registration", "offline_registration", "sponsorship", "brand_partnership", "stall_booking", "ticket_sales",
  "merchandise", "donation", "other",
] as const;

/** Categories that may be recorded manually (gateway and sponsorship income are booked by their own workflows). */
export const MANUAL_INCOME_CATEGORIES = [
  "offline_registration", "brand_partnership", "stall_booking", "ticket_sales", "merchandise", "donation", "other",
] as const;

export const EXPENSE_CATEGORIES = [
  "marketing", "media_production", "stage", "sound_lighting", "venue", "food", "accommodation", "transportation",
  "printing", "decorations", "technical_equipment", "hospitality", "security", "miscellaneous",
] as const;

export const PAYMENT_METHODS = ["UPI", "Bank transfer", "Cash", "Cheque", "Card", "Payment gateway", "Other"] as const;

const money = z.number({ error: "Enter an amount" }).positive("Amount must be more than zero").max(1e11).multipleOf(0.01, "At most 2 decimals");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const optional = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const incomeSchema = z.object({
  category: z.enum(MANUAL_INCOME_CATEGORIES),
  amount: money,
  occurred_on: date,
  payment_method: z.enum(PAYMENT_METHODS),
  payment_reference: optional(120),
  description: optional(500),
  notes: optional(1000),
  verified: z.boolean(),
});
export type IncomeInput = z.infer<typeof incomeSchema>;

export const expenseSchema = z.object({
  department_id: z.string().uuid("Choose a department"),
  title: z.string().trim().min(2, "Enter a title").max(200),
  category: z.enum(EXPENSE_CATEGORIES),
  requested_amount: money,
  vendor_id: z.string().uuid().optional().or(z.literal("")),
  description: optional(2000),
  required_by: date.optional().or(z.literal("")),
  submit: z.boolean(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const paymentSchema = z.object({
  amount: money,
  paid_on: date,
  method: z.enum(PAYMENT_METHODS),
  reference: optional(120),
  notes: optional(1000),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

export const revisionSchema = z.object({
  department_id: z.string().uuid().optional().or(z.literal("")),
  requested_amount: z.number({ error: "Enter an amount" }).min(0).max(1e11),
  reason: z.string().trim().min(5, "Explain why the budget should change").max(1000),
});
export type RevisionInput = z.infer<typeof revisionSchema>;

export const EXPENSE_ACTIONS = ["submit", "resubmit", "start_review", "approve", "forward", "request_changes", "reject", "cancel"] as const;
