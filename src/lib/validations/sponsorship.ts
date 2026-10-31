import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/validations/finance";

export const SPONSOR_STAGES = [
  "lead_identified", "contacted", "meeting_scheduled", "proposal_sent", "negotiation", "confirmed", "partially_paid", "fully_paid", "rejected", "lost",
] as const;
export const DELIVERABLE_TYPES = [
  "logo_placement", "social_media", "stage_branding", "banner_placement", "stall_allocation", "video_promotion", "public_announcement", "website_branding", "other",
] as const;

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const sponsorSchema = z.object({
  company_name: z.string().trim().min(2, "Enter the company name").max(200),
  brand_name: opt(200),
  contact_person: opt(120),
  designation: opt(120),
  email: z.string().trim().toLowerCase().email("Invalid email").optional().or(z.literal("")),
  phone: opt(32),
  address: opt(500),
  website: opt(300),
  category: opt(80),
  assigned_to: z.string().uuid().optional().or(z.literal("")),
  notes: opt(2000),
});
export type SponsorInput = z.infer<typeof sponsorSchema>;

export const dealSchema = z.object({
  sponsor_id: z.string().uuid("Choose a sponsor"),
  package_id: z.string().uuid().optional().or(z.literal("")),
  stage: z.enum(SPONSOR_STAGES),
  proposed_amount: z.number().min(0).max(1e11),
  agreed_amount: z.number().min(0).max(1e11),
  expected_payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  owner_id: z.string().uuid().optional().or(z.literal("")),
  notes: opt(2000),
});
export type DealInput = z.infer<typeof dealSchema>;

export const packageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tier_order: z.number().int().min(0).max(999),
  amount: z.number().min(0).max(1e11),
  description: opt(1000),
  benefits: opt(3000),
  max_slots: z.number().int().min(1).max(1000).nullable(),
  is_active: z.boolean(),
});
export type PackageInput = z.infer<typeof packageSchema>;

export const sponsorshipPaymentSchema = z.object({
  amount: z.number().positive().max(1e11),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_method: z.enum(PAYMENT_METHODS),
  reference: opt(120),
  notes: opt(1000),
});

export const deliverableSchema = z.object({
  deliverable_type: z.enum(DELIVERABLE_TYPES),
  description: opt(1000),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  owner_id: z.string().uuid().optional().or(z.literal("")),
});
