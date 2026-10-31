import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { publicRegistrationSchema } from "@/lib/validations/public";
import { registrationState, type PublicEvent } from "@/features/public/types";

const base: PublicEvent = {
  id: "e", name: "Fest", slug: "fest", description: null, category: "technical", starts_on: "2026-12-01", ends_on: "2026-12-02",
  venue: null, status: "registration_open", registration_opens_at: null, registration_closes_at: null, contact_email: null,
  contact_phone: null, website_url: null, logo_path: null, banner_path: null, currency: "INR", timezone: "Asia/Kolkata",
  college: { name: "CET", code: "CET" }, public_page: true, allow_team_registrations: true, max_team_size: 4,
  competitions: [{ code: "QUIZ", name: "Quiz", category: null, description: null, fee: 0, registration_type: "individual", team_min: 1, team_max: 1, starts_at: null, venue: null, rules_url: null, spots_left: null }],
};

describe("registrationState", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  it("is open only when the page is on, the window is open and competitions exist", () => {
    expect(registrationState(base, now).open).toBe(true);
    expect(registrationState({ ...base, public_page: false }, now).open).toBe(false);
    expect(registrationState({ ...base, status: "completed" }, now).open).toBe(false);
    expect(registrationState({ ...base, registration_opens_at: "2026-11-20T00:00:00Z" }, now)).toMatchObject({ open: false, reason: expect.stringContaining("open on") });
    expect(registrationState({ ...base, registration_closes_at: "2026-11-10T00:00:00Z" }, now).open).toBe(false);
    expect(registrationState({ ...base, competitions: [] }, now).open).toBe(false);
  });
});

describe("public registration form", () => {
  const ok = { name: "Asha K", email: "Asha@Example.com ", phone: "+91 98765 43210", college: "CET", competitions: ["QUIZ"], team_members: [] };
  it("normalises valid input", () => {
    const r = publicRegistrationSchema.parse(ok);
    expect(r.email).toBe("asha@example.com");
  });
  it("rejects bots, missing competitions and bad phones", () => {
    expect(publicRegistrationSchema.safeParse({ ...ok, website: "spam.example" }).success).toBe(false);
    expect(publicRegistrationSchema.safeParse({ ...ok, competitions: [] }).success).toBe(false);
    expect(publicRegistrationSchema.safeParse({ ...ok, phone: "call me" }).success).toBe(false);
  });
});

describe("ticket QR codes", () => {
  it("round-trip: the code printed on a ticket is what the gate scanner reads", () => {
    const url = "https://event-app-blush.vercel.app/t/0a1b2c3d4e5f6a7b";
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const scale = 6;
    const quiet = 4;
    const size = (n + quiet * 2) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
    const decoded = jsQR(pixels, size, size);
    expect(decoded?.data).toBe(url);
    // Same extraction the database applies to scanned text.
    expect(decoded!.data.replace(/^.*\/t\//, "").toUpperCase()).toBe("0A1B2C3D4E5F6A7B");
  });
});
