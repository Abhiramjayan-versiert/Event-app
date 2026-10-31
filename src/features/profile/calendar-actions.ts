"use server";

import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions";

/** Returns (or rotates) the signed-in user's private calendar feed token. */
export async function calendarTokenAction(reset: boolean): Promise<ActionResult<{ token: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_calendar_token", { p_reset: reset });
  if (error || !data) return { ok: false, error: "Could not create your calendar link." };
  return { ok: true, data: { token: data }, message: reset ? "New link created. The old link stopped working." : undefined };
}
