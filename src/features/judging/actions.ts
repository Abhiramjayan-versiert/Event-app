"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { type ActionResult, fromDbError } from "@/lib/actions";

const uuid = z.string().uuid();
const criteriaSchema = z.array(z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Name every criterion").max(120),
  max_score: z.number().positive().max(1000),
  weight: z.number().positive().max(100),
})).min(1, "Add at least one criterion").max(20);

function refresh(eventId: string, competitionId: string) {
  revalidatePath(`/events/${eventId}/judging`);
  revalidatePath(`/events/${eventId}/judging/${competitionId}`);
}

export async function saveJudgingSetupAction(eventId: string, competitionId: string, criteria: unknown, judges: string[]): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const c = criteriaSchema.safeParse(criteria);
  if (!c.success) return { ok: false, error: c.error.issues[0]?.message ?? "Check the criteria." };
  if (!z.array(uuid).max(50).safeParse(judges).success) return { ok: false, error: "Invalid judges." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_judging_setup", { p_competition: competitionId, p_criteria: c.data as never, p_judges: judges });
  if (error) return fromDbError(error, "Could not save the judging setup.");
  refresh(eventId, competitionId);
  return { ok: true, message: "Judging setup saved. New judges were notified." };
}

export async function submitScoresAction(eventId: string, competitionId: string, registrationId: string, scores: { criterion_id: string; score: number | null }[], comment: string): Promise<ActionResult> {
  if (![eventId, competitionId, registrationId].every((v) => uuid.safeParse(v).success)) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_scores", { p_competition: competitionId, p_registration: registrationId, p_scores: scores as never, p_comment: comment.slice(0, 1000) });
  if (error) return fromDbError(error, "Could not save the scores.");
  refresh(eventId, competitionId);
  return { ok: true, message: "Scores saved." };
}

export async function publishResultsAction(eventId: string, competitionId: string, results: { registration_id: string; position: number; title: string }[]): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const parsed = z.array(z.object({ registration_id: uuid, position: z.number().int().min(1).max(50), title: z.string().trim().min(1).max(80) })).min(1).safeParse(results);
  if (!parsed.success) return { ok: false, error: "Choose at least one winner and give each a title." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_results", { p_competition: competitionId, p_results: parsed.data as never });
  if (error) return fromDbError(error, "Could not publish the results.");
  refresh(eventId, competitionId);
  return { ok: true, message: "Results published. Scores are now locked." };
}

export async function unpublishResultsAction(eventId: string, competitionId: string): Promise<ActionResult> {
  if (!uuid.safeParse(eventId).success || !uuid.safeParse(competitionId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpublish_results", { p_competition: competitionId });
  if (error) return fromDbError(error, "Could not unpublish the results.");
  refresh(eventId, competitionId);
  return { ok: true, message: "Results unpublished. Judges can score again." };
}
