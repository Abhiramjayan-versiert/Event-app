import { z } from "zod";

const memberSchema = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254).optional().or(z.literal("")) });

export const publicRegistrationSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, "Enter a valid phone number"),
  college: z.string().trim().min(2, "Enter your college").max(200),
  course: z.string().trim().max(120).optional().or(z.literal("")),
  academic_year: z.string().trim().max(20).optional().or(z.literal("")),
  competitions: z.array(z.string().trim().max(40)).min(1, "Choose at least one competition").max(20),
  team_name: z.string().trim().max(120).optional().or(z.literal("")),
  team_members: z.array(memberSchema).max(49),
  /** Honeypot: real people never fill this hidden field. */
  website: z.string().max(0).optional().or(z.literal("")),
});

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;
