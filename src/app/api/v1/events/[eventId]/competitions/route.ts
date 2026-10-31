import type { NextRequest } from "next/server";
import { authenticate, handle } from "@/lib/api/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "event:read");
    setCredential(credential);
    const { data } = await admin
      .from("event_competitions")
      .select("code, name, category, description, fee, registration_type, team_min, team_max, capacity, starts_at, ends_at, venue, rules_url")
      .eq("event_id", eventId)
      .eq("is_active", true)
      .order("name");
    const categories = [...new Set((data ?? []).map((c) => c.category))];
    return { body: { data: data ?? [], categories } };
  });
}
