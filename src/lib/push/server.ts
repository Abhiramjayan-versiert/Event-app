import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

type PushConfig = { vapid_public: string; vapid_private: string; dispatch_secret: string };
let cached: PushConfig | null = null;

/** Loads the VAPID keys, generating and storing them on first use (server + database only). */
export async function getPushConfig(): Promise<PushConfig> {
  if (cached) return cached;
  const admin = createAdminClient();
  const { data } = await admin.rpc("push_config_get");
  let cfg = data as PushConfig | null;
  if (!cfg) {
    const keys = webpush.generateVAPIDKeys();
    const { data: created, error } = await admin.rpc("push_config_init", {
      p_public: keys.publicKey, p_private: keys.privateKey, p_secret: randomBytes(32).toString("hex"), p_app_url: publicEnv.appUrl,
    });
    if (error || !created) throw new Error("Could not set up push notifications.");
    cfg = created as PushConfig;
  }
  cached = cfg;
  return cfg;
}

export function secretMatches(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Sub = { endpoint: string; p256dh: string; auth: string };

/** Sends one payload to many subscriptions; removes subscriptions the push service says are gone. */
export async function sendPush(subs: Sub[], payload: { title: string; body?: string | null; link?: string | null }, opts: { agent?: import("node:https").Agent } = {}) {
  const cfg = await getPushConfig();
  const admin = createAdminClient();
  const message = JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.link ?? "/notifications" });
  const results = await Promise.allSettled(subs.map((s) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, message, {
      vapidDetails: { subject: `mailto:no-reply@${new URL(publicEnv.appUrl).hostname}`, publicKey: cfg.vapid_public, privateKey: cfg.vapid_private },
      TTL: 60 * 60 * 12,
      ...(opts.agent ? { agent: opts.agent } : {}),
      urgency: "normal",
    }),
  ));
  let sent = 0;
  await Promise.all(results.map(async (r, i) => {
    if (r.status === "fulfilled") return void sent++;
    const code = (r.reason as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) await admin.rpc("drop_push_subscription", { p_endpoint: subs[i].endpoint });
  }));
  return { sent, total: subs.length };
}
