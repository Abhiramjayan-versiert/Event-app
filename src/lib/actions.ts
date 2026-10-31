import type { z } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export function fromZodError(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
}

/** Maps Postgres / PostgREST errors to safe, human readable messages. */
export function fromDbError(error: { code?: string; message: string } | null | undefined, fallback = "The operation failed."): ActionResult<never> {
  if (!error) return { ok: false, error: fallback };
  switch (error.code) {
    case "23505":
      return { ok: false, error: "A record with the same unique value already exists." };
    case "23503":
      return { ok: false, error: "A related record does not exist or is still in use." };
    case "23514":
      return { ok: false, error: "The submitted values violate a validation rule." };
    case "42501":
      return { ok: false, error: error.message.includes("row-level security") ? "You do not have permission to perform this action." : error.message };
    // Raised by our own database functions and triggers with user-facing messages.
    case "22023":
    case "P0002":
      return { ok: false, error: error.message };
    case "PGRST116":
      return { ok: false, error: "Record not found or you do not have access to it." };
    default:
      return { ok: false, error: fallback };
  }
}

/** Only allow same-origin relative redirects (prevents open redirects). */
export function safeRedirectPath(value: unknown, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
