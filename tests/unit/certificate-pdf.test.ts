import { describe, expect, it } from "vitest";
import { buildCertificatePdf } from "@/features/certificates/pdf";

describe("certificate PDF", () => {
  it("renders a landscape single-page certificate with a QR image", async () => {
    const buf = await buildCertificatePdf({
      code: "AB12CD34EF56", kind: "winner", title: "Winner · Debate", recipient_name: "Asha Kumar", competition_name: "Debate",
      issued_at: "2026-11-20T10:00:00Z", revoked: false,
      event: { name: "Tech Fest 2026", starts_on: "2026-11-18", ends_on: "2026-11-19", college: "CET", certificate: { signatory_1_name: "Dr. Rao", signatory_1_title: "Principal", footer: "Organised by the Student Council" } },
    }, "https://example.app/c/ab12cd34ef56");
    const text = Buffer.from(buf).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    expect(text).toMatch(/\/Subtype \/Image/);
    const [, w, h] = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) ?? [];
    expect(Number(w)).toBeGreaterThan(Number(h));
  });
});
