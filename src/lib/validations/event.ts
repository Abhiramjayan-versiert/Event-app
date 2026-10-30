import { z } from "zod";
import { emailSchema } from "@/lib/validations/auth";

export const EVENT_CATEGORIES = ["cultural", "technical", "management", "sports", "literary", "arts", "academic", "other"] as const;
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
export const EVENT_STATUSES = ["planning", "registration_open", "registration_closed", "upcoming", "live", "completed", "archived"] as const;
export const SOCIAL_PLATFORMS = ["instagram", "linkedin", "x", "youtube", "facebook"] as const;

const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter a full URL starting with https://");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const optionalDateTime = z
  .string()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Invalid date and time");

export const eventSchema = z
  .object({
    college_id: z.string().uuid("Choose a college"),
    name: z.string().trim().min(2, "Enter the event name").max(200),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9][a-z0-9-]{1,79})?$/, "Lowercase letters, numbers and hyphens")
      .optional(),
    category: z.enum(EVENT_CATEGORIES),
    description: z.string().trim().max(5000).optional().or(z.literal("")),
    starts_on: date,
    ends_on: date,
    registration_opens_at: optionalDateTime,
    registration_closes_at: optionalDateTime,
    venue: z.string().trim().max(300).optional().or(z.literal("")),
    website_url: optionalUrl,
    contact_email: emailSchema.optional().or(z.literal("")),
    contact_phone: z.string().trim().max(32).regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + ( ) - only").optional().or(z.literal("")),
    social_links: z.object(Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, optionalUrl])) as Record<(typeof SOCIAL_PLATFORMS)[number], typeof optionalUrl>),
    currency: z.enum(CURRENCIES),
    status: z.enum(EVENT_STATUSES).exclude(["archived"]),
  })
  .refine((v) => v.ends_on >= v.starts_on, { path: ["ends_on"], message: "End date must be on or after the start date" })
  .refine((v) => !v.registration_opens_at || !v.registration_closes_at || v.registration_closes_at >= v.registration_opens_at, {
    path: ["registration_closes_at"],
    message: "Registration must close after it opens",
  });

export type EventInput = z.infer<typeof eventSchema>;

export const eventAdminSchema = z.object({ email: emailSchema, full_name: z.string().trim().min(2).max(120) });

export const registrationSettingsSchema = z.object({
  duplicate_rule: z.enum(["email_per_category", "email_per_event", "phone_per_category", "none"]),
  allow_team_registrations: z.boolean(),
  max_team_size: z.number({ error: "Enter a number" }).int().min(1).max(50),
});
export type RegistrationSettingsInput = z.infer<typeof registrationSettingsSchema>;

/** Form datetime-local values are in the browser's local time; send ISO with offset. */
export function eventToRow(input: EventInput, tzOffsetMinutes = 0) {
  const nil = (v: string | undefined) => (v ? v : null);
  const dt = (v: string) => {
    if (!v) return null;
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return new Date(v).toISOString();
    return new Date(Date.parse(`${v}:00Z`) + tzOffsetMinutes * 60_000).toISOString();
  };
  const social = Object.fromEntries(Object.entries(input.social_links).filter(([, url]) => url));
  return {
    name: input.name,
    category: input.category,
    description: nil(input.description),
    starts_on: input.starts_on,
    ends_on: input.ends_on,
    registration_opens_at: dt(input.registration_opens_at),
    registration_closes_at: dt(input.registration_closes_at),
    venue: nil(input.venue),
    website_url: nil(input.website_url),
    contact_email: nil(input.contact_email),
    contact_phone: nil(input.contact_phone),
    social_links: social,
    currency: input.currency,
    status: input.status,
  };
}
