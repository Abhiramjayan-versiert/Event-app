import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { buildIcs, type IcsItem } from "@/lib/calendar/ics";

export const dynamic = "force-dynamic";

/** Personal calendar feed. The secret token in the URL is the credential. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  if (!/^[0-9a-f]{48}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createAdminClient().rpc("calendar_feed_items", { p_token: token });
  if (error) return new NextResponse("Calendar unavailable", { status: 503 });
  const ics = buildIcs("EVENT APP", (data ?? []) as IcsItem[], publicEnv.appUrl);
  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=900",
      "content-disposition": 'inline; filename="event-app.ics"',
    },
  });
}
