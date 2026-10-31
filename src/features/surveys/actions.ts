"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionResult, fromDbError } from "@/lib/actions";
import { publicEnv } from "@/lib/env";
import { emailConfigured, emailLayout, sendEmail } from "@/lib/email/send";

const uuid = z.string().uuid();
const surveySchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(150),
  intro: z.string().trim().max(1000),
  audience: z.enum(["participants", "anyone"]),
  status: z.enum(["draft", "open", "closed"]),
  questions: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
    type: z.enum(["rating", "nps", "choice", "text"]),
    label: z.string().trim().min(1, "Every question needs a label").max(300),
    options: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
    required: z.boolean().optional(),
  })).min(1, "Add at least one question").max(30),
});

export async function saveSurveyAction(eventId: string, surveyId: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(eventId).success || (surveyId && !uuid.safeParse(surveyId).success)) return { ok: false, error: "Invalid request." };
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the survey." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_survey", { p_event: eventId, p_survey: (surveyId ?? null) as unknown as string, p_data: parsed.data as never });
  if (error) return fromDbError(error, "Could not save the survey.");
  revalidatePath(`/events/${eventId}/feedback`);
  return { ok: true, data: { id: data as string }, message: "Survey saved." };
}

export async function emailSurveyInvitesAction(eventId: string, surveyId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(surveyId).success) return { ok: false, error: "Invalid request." };
  if (!emailConfigured()) return { ok: false, error: "Email sending isn't set up yet (SMTP settings on the server)." };
  const supabase = await createClient();
  const [{ data: batch, error }, { data: survey }] = await Promise.all([
    supabase.rpc("survey_invite_batch", { p_survey: surveyId, p_limit: 80 }),
    supabase.from("surveys").select("title, public_token, event:events(name)").eq("id", surveyId).single(),
  ]);
  if (error) return fromDbError(error, "Could not prepare the invitations.");
  if (!batch?.length || !survey) return { ok: true, message: "Everyone has been invited already." };
  const sent: string[] = [];
  for (const r of batch) {
    const { html, text } = emailLayout(`Tell us about ${survey.event?.name ?? "the event"}`, [
      `Hi ${r.name},`, "Thanks for being part of the event! It takes a minute to share your feedback, and it helps us make the next edition better.",
    ], { label: "Give feedback", url: `${publicEnv.appUrl}/s/${survey.public_token}?t=${r.ticket_code.toLowerCase()}` });
    if (await sendEmail(r.email, `${survey.title} · ${survey.event?.name ?? ""}`, html, text)) sent.push(r.registration_id);
  }
  if (sent.length) await supabase.rpc("mark_survey_invited", { p_survey: surveyId, p_registrations: sent });
  revalidatePath(`/events/${eventId}/feedback/${surveyId}`);
  return sent.length === batch.length
    ? { ok: true, message: `${sent.length} invitation${sent.length === 1 ? "" : "s"} sent.${batch.length === 80 ? " Click again for the next batch." : ""}` }
    : { ok: false, error: `${sent.length} sent, ${batch.length - sent.length} failed. Check the SMTP settings.` };
}

/** Public: submit a response (no sign-in). */
export async function submitSurveyAction(token: string, ticket: string | null, name: string, answers: Record<string, string>): Promise<ActionResult> {
  if (!/^[0-9a-f]{24}$/.test(token) || (ticket && !/^[0-9a-f]{16}$/i.test(ticket))) return { ok: false, error: "Invalid survey link." };
  const admin = createAdminClient();
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
  const { data: allowed } = await admin.rpc("api_rate_limit", { p_bucket: `survey:${ip}`, p_limit: 20, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "Too many responses from this network. Please try later." };
  const clean = Object.fromEntries(Object.entries(answers).slice(0, 40).map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 2000)]));
  const { error } = await admin.rpc("submit_survey_response", { p_token: token, p_ticket: (ticket ?? null) as unknown as string, p_name: name.slice(0, 160), p_answers: clean });
  if (error) return error.code === "22023" ? { ok: false, error: error.message } : { ok: false, error: "Could not save your response. Please try again." };
  return { ok: true, message: "Thank you for your feedback!" };
}
