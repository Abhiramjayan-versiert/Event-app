import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { safeEqualHex, verifyCheckoutSignature, verifyWebhookSignature } from "@/lib/api/razorpay";
import { apiRegistrationSchema } from "@/lib/validations/api";
import { sha256 } from "@/lib/api/http";

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe("payment signature verification", () => {
  it("accepts a correct webhook signature and rejects tampering", () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", amount: 50000 } } } });
    const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(verifyWebhookSignature(body, sig)).toBe(true);
    expect(verifyWebhookSignature(body.replace("50000", "1"), sig)).toBe(false);
    expect(verifyWebhookSignature(body, sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(verifyWebhookSignature(body, null)).toBe(false);
  });

  it("fails closed when the secret is not configured", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(verifyWebhookSignature("{}", "abc")).toBe(false);
  });

  it("verifies Razorpay checkout signatures (order_id|payment_id)", () => {
    process.env.RAZORPAY_KEY_SECRET = "key_secret";
    const sig = createHmac("sha256", "key_secret").update("order_1|pay_1").digest("hex");
    expect(verifyCheckoutSignature("order_1", "pay_1", sig)).toBe(true);
    expect(verifyCheckoutSignature("order_1", "pay_2", sig)).toBe(false);
  });

  it("compares in constant time without throwing on length mismatch", () => {
    expect(safeEqualHex("abc", "abcd")).toBe(false);
    expect(safeEqualHex("abc", "abc")).toBe(true);
  });

  it("hashes API keys deterministically", () => {
    expect(sha256("eak_test_x")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("a")).toBe(sha256("a"));
  });
});

describe("API registration payload", () => {
  const valid = { participant: { name: "Asha", email: "ASHA@Example.com" }, items: [{ competition_code: "HACK" }] };

  it("normalises and defaults", () => {
    const r = apiRegistrationSchema.parse(valid);
    expect(r.participant.email).toBe("asha@example.com");
    expect(r.registration_type).toBe("individual");
    expect(r.items[0].quantity).toBe(1);
  });

  it("requires a team name for team registrations", () => {
    expect(apiRegistrationSchema.safeParse({ ...valid, registration_type: "team" }).success).toBe(false);
    expect(apiRegistrationSchema.safeParse({ ...valid, registration_type: "team", team_name: "Byte" }).success).toBe(true);
  });

  it("rejects missing items, bad emails and oversized teams", () => {
    expect(apiRegistrationSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(apiRegistrationSchema.safeParse({ ...valid, participant: { name: "A b", email: "nope" } }).success).toBe(false);
    expect(apiRegistrationSchema.safeParse({ ...valid, registration_type: "team", team_name: "T", team_members: Array.from({ length: 50 }, () => ({ name: "Member" })) }).success).toBe(false);
  });
});
