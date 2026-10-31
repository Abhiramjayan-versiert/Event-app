import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.razorpay.com/v1";

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function webhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

function authHeader() {
  return "Basic " + Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
}

/** Constant-time comparison of two hex HMAC signatures. */
export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  return safeEqualHex(createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}

/** Signature returned by Razorpay Checkout to the website after payment. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  return safeEqualHex(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), signature);
}

export async function createOrder(amount: number, currency: string, receipt: string, notes: Record<string, string>) {
  const res = await fetch(`${BASE}/orders`, {
    method: "POST",
    headers: { authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency, receipt: receipt.slice(0, 40), notes }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Razorpay order creation failed (${res.status})`);
  return (await res.json()) as { id: string; amount: number; currency: string };
}

/** Server-side payment check (used in addition to the checkout signature). */
export async function fetchPayment(paymentId: string) {
  const res = await fetch(`${BASE}/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: authHeader() }, cache: "no-store" });
  if (!res.ok) throw new Error(`Razorpay payment lookup failed (${res.status})`);
  return (await res.json()) as { id: string; order_id: string; amount: number; currency: string; status: string; method: string };
}
