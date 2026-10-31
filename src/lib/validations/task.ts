import { z } from "zod";

export const TASK_STATUSES = ["not_started", "in_progress", "under_review", "completed", "on_hold"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_MODULES = ["general", "media", "marketing", "operations", "sponsorship", "finance", "registration"] as const;
export const TASK_TYPES = [
  "general", "photography", "videography", "poster_design", "reel", "social_post", "press_release", "logistics", "procurement",
  "coordination", "technical", "outreach",
] as const;

const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const taskSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  description: opt(5000),
  department_id: z.string().uuid().optional().or(z.literal("")),
  parent_task_id: z.string().uuid().optional().or(z.literal("")),
  module: z.enum(TASK_MODULES),
  task_type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES),
  start_at: opt(30),
  due_at: opt(30),
  location: opt(200),
  assignees: z.array(z.string().uuid()).max(30).default([]),
});
export type TaskInput = z.input<typeof taskSchema>;
