import type { NextRequest } from "next/server";
import { ApiError, authenticate, handle } from "@/lib/api/http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return handle(request, { eventId }, async ({ setCredential }) => {
    const { admin, credential } = await authenticate(request, eventId, "event:read");
    setCredential(credential);
    const { data: e } = await admin
      .from("events")
      .select("id, name, slug, category, description, starts_on, ends_on, registration_opens_at, registration_closes_at, venue, website_url, contact_email, contact_phone, social_links, currency, timezone, status, college:colleges(name, code, city)")
      .eq("id", eventId)
      .single();
    if (!e) throw new ApiError(404, "not_found", "Event not found.");
    const { data: schedule } = await admin
      .from("event_schedules")
      .select("title, description, item_type, starts_at, ends_at, location")
      .eq("event_id", eventId)
      .eq("is_public", true)
      .order("starts_at");
    const now = Date.now();
    const open =
      ["planning", "registration_open", "upcoming", "live"].includes(e.status) &&
      (!e.registration_opens_at || Date.parse(e.registration_opens_at) <= now) &&
      (!e.registration_closes_at || Date.parse(e.registration_closes_at) >= now) &&
      e.status !== "planning";
    return { body: { data: { ...e, registration_open: open, public_schedule: schedule ?? [] } } };
  });
}
