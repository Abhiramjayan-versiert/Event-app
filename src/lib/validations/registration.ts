import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/validations/finance";

export const offlineRegistrationSchema = z.object({
  participant_name: z.string().trim().min(2, "Enter the participant's name").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(32).regex(/^[+0-9 ()-]*$/, "Digits only").optional().or(z.literal("")),
  participant_college: z.string().trim().max(200).optional().or(z.literal("")),
  course: z.string().trim().max(120).optional().or(z.literal("")),
  academic_year: z.string().trim().max(20).optional().or(z.literal("")),
  competition_id: z.string().uuid("Choose a competition"),
  registration_type: z.enum(["individual", "team"]),
  team_name: z.string().trim().max(120).optional().or(z.literal("")),
  team_members: z.string().trim().max(2000).optional().or(z.literal("")),
  discount: z.number().min(0).max(1e9),
  paid_now: z.boolean(),
  payment_method: z.enum(PAYMENT_METHODS),
  payment_reference: z.string().trim().max(120).optional().or(z.literal("")),
});
export type OfflineRegistrationInput = z.infer<typeof offlineRegistrationSchema>;

export const competitionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,31}$/, "Letters, numbers, - and _"),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  fee: z.number().min(0).max(1e9),
  registration_type: z.enum(["individual", "team"]),
  team_min: z.number().int().min(1).max(50),
  team_max: z.number().int().min(1).max(50),
  capacity: z.number().int().min(1).max(1e6).nullable(),
  venue: z.string().trim().max(200).optional().or(z.literal("")),
  rules_url: z.string().trim().max(300).optional().or(z.literal("")),
  is_active: z.boolean(),
}).refine((v) => v.team_max >= v.team_min, { path: ["team_max"], message: "Must be at least the minimum" });
export type CompetitionInput = z.infer<typeof competitionSchema>;

