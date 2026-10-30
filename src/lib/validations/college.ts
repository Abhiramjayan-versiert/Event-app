import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Enter a full URL starting with https://")
  .optional();

export const collegeSchema = z.object({
  name: z.string().trim().min(2, "Enter the college name").max(200),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "2–20 characters: letters, numbers and hyphens"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254).optional().or(z.literal("")),
  website: optionalUrl,
  phone: z.string().trim().max(32).regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + ( ) - only").optional().or(z.literal("")),
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  country: z.string().trim().min(2).max(100),
  description: optionalText(2000),
  status: z.enum(["active", "inactive"]),
});

export type CollegeInput = z.infer<typeof collegeSchema>;

/** Converts empty strings from forms into NULLs for the database. */
export function collegeToRow(input: CollegeInput) {
  const nil = (v: string | undefined) => (v ? v : null);
  return {
    name: input.name,
    code: input.code,
    email: nil(input.email),
    website: nil(input.website),
    phone: nil(input.phone),
    address: nil(input.address),
    city: nil(input.city),
    state: nil(input.state),
    country: input.country,
    description: nil(input.description),
    status: input.status,
  };
}
