import { z } from "zod";
import { emailSchema } from "@/lib/validations/auth";

export const inviteSchema = z.object({
  email: emailSchema,
  full_name: z.string().trim().min(2, "Enter the person's name").max(120),
});

export type InviteInput = z.infer<typeof inviteSchema>;
