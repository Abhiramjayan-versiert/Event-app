import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AccessSummary } from "@/lib/auth/types";

/** Colleges in which the current user may create events (checked in the database). */
export async function collegesForEventCreation(access: AccessSummary) {
  const supabase = await createClient();
  if (access.is_super_admin) {
    const { data } = await supabase.from("colleges").select("id, name").neq("status", "archived").order("name");
    return data ?? [];
  }
  const candidates = access.colleges.filter((c) => c.status !== "archived");
  const checks = await Promise.all(
    candidates.map(async (c) => {
      const { data } = await supabase.rpc("check_permission", { p_scope: "college", p_id: c.id, p_permission: "college.events.create" });
      return data ? { id: c.id, name: c.name } : null;
    }),
  );
  return checks.filter((c): c is { id: string; name: string } => c !== null);
}
