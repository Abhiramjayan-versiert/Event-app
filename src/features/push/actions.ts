"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/actions";
import { getPushConfig, sendPush } from "@/lib/push/server";

const subSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
});

export async function pushPublicKeyAction(): Promise<ActionResult<{ key: string }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };
  try {
    return { ok: true, data: { key: (await getPushConfig()).vapid_public } };
  } catch {
    return { ok: false, error: "Push notifications are not available right now." };
  }
}

export async function savePushSubscriptionAction(input: unknown, userAgent: string): Promise<ActionResult> {
  const parsed = subSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This browser returned an invalid subscription." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint, p_p256dh: parsed.data.keys.p256dh, p_auth: parsed.data.keys.auth, p_user_agent: userAgent.slice(0, 300),
  });
  if (error) return { ok: false, error: "Could not turn on notifications." };
  return { ok: true, message: "Notifications are on for this device." };
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const supabase = await createClient();
  await supabase.rpc("remove_push_subscription", { p_endpoint: endpoint.slice(0, 1000) });
  return { ok: true, message: "Notifications are off for this device." };
}

export async function testPushAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: subs } = await supabase.from("push_subscriptions").select("endpoint, p256dh, auth");
  if (!subs?.length) return { ok: false, error: "Turn on notifications on this device first." };
  const r = await sendPush(subs, { title: "EVENT APP", body: "Notifications are working on this device. 🎉", link: "/notifications" });
  return r.sent ? { ok: true, message: `Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` } : { ok: false, error: "The test could not be delivered." };
}
