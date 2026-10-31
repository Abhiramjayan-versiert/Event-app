import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);

export const apiRegistrationSchema = z.object({
  external_reference: text(120).optional(),
  participant: z.object({
    name: text(160).min(2),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: text(32).regex(/^[+0-9 ()-]*$/).optional(),
    college: text(200).optional(),
    course: text(120).optional(),
    academic_year: text(20).optional(),
  }),
  registration_type: z.enum(["individual", "team"]).default("individual"),
  team_name: text(120).optional(),
  team_members: z
    .array(z.object({ name: text(160).min(2), email: z.string().trim().toLowerCase().email().optional(), phone: text(32).optional() }))
    .max(49)
    .default([]),
  items: z.array(z.object({ competition_code: text(32).min(1), quantity: z.number().int().min(1).max(20).default(1) })).min(1).max(20),
  custom_fields: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({}),
}).refine((v) => v.registration_type === "individual" || (v.team_name && v.team_name.length > 0), {
  path: ["team_name"],
  message: "team_name is required for team registrations",
});

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(5).max(64),
  razorpay_payment_id: z.string().min(5).max(64),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export function zodDetails(error: z.ZodError) {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
  return details;
}
