import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPushConfig, secretMatches, sendPush } from "@/lib/push/server";

export const dynamic = "force-dynamic";

/** Called by the database (pg_net) when a notification is created. */
export async function POST(request: Request) {
  const cfg = await getPushConfig().catch(() => null);
  if (!cfg || !secretMatches(request.headers.get("x-push-secret"), cfg.dispatch_secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { notification_id?: string } | null;
  if (!body?.notification_id || !/^[0-9a-f-]{36}$/i.test(body.notification_id)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { data } = await createAdminClient().rpc("push_payload", { p_notification: body.notification_id });
  const p = data as { title: string; body: string | null; link: string | null; subscriptions: { endpoint: string; p256dh: string; auth: string }[] } | null;
  if (!p?.subscriptions.length) return NextResponse.json({ sent: 0 });
  return NextResponse.json(await sendPush(p.subscriptions, p));
}
