import { z } from "zod";
import { emailSchema } from "@/lib/validations/auth";

export const DEPARTMENT_KINDS = [
  "finance", "registration", "sponsorship", "media", "marketing", "technical", "logistics", "operations", "hospitality", "general",
] as const;

export const DEPARTMENT_ICONS = [
  "layers", "wallet", "camera", "megaphone", "handshake", "clipboard-list", "cpu", "truck", "presentation", "coffee", "bus",
  "bed", "utensils", "shield", "palette", "file-text", "users", "user-check", "radio", "music", "trophy", "heart",
] as const;

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "Enter a department name").max(80),
  kind: z.enum(DEPARTMENT_KINDS),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  icon: z.enum(DEPARTMENT_ICONS),
  status: z.enum(["active", "archived"]),
  progress_pct: z.number({ error: "Enter a number" }).int().min(0).max(100),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const assignmentSchema = z
  .object({
    user_id: z.string().uuid().optional().or(z.literal("")),
    email: emailSchema.optional().or(z.literal("")),
    full_name: z.string().trim().max(120).optional().or(z.literal("")),
    position: z.enum(["head", "co_head", "assistant_head", "member"]),
    role_key: z.string().max(64).optional().or(z.literal("")),
  })
  .refine((v) => v.user_id || (v.email && v.full_name && v.full_name.length >= 2), {
    message: "Choose a team member or enter a name and email",
    path: ["email"],
  });
export type AssignmentInput = z.infer<typeof assignmentSchema>;

export const announcementSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(150),
  body: z.string().trim().min(2, "Write the announcement").max(5000),
  priority: z.enum(["normal", "important", "urgent"]),
  pinned: z.boolean(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const eventRoleSchema = z
  .object({
    user_id: z.string().uuid().optional().or(z.literal("")),
    email: emailSchema.optional().or(z.literal("")),
    full_name: z.string().trim().max(120).optional().or(z.literal("")),
    role_key: z.string().min(2).max(64),
  })
  .refine((v) => v.user_id || (v.email && v.full_name && v.full_name.length >= 2), {
    message: "Choose a person or enter a name and email",
    path: ["email"],
  });
