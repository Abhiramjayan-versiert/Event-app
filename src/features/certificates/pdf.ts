/** Certificate PDF (landscape A4). Pure: runs in the browser and in tests. */
export type CertificateData = {
  code: string; kind: "participation" | "winner"; title: string; recipient_name: string; competition_name: string | null;
  issued_at: string; revoked: boolean;
  event: { name: string; starts_on: string; ends_on: string; college: string; certificate: CertificateSettings };
};
export type CertificateSettings = {
  signatory_1_name?: string; signatory_1_title?: string; signatory_2_name?: string; signatory_2_title?: string; footer?: string;
};

const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
// Built-in PDF fonts are Latin-1; keep text printable.
const latin = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/·/g, "-").replace(/[^\x20-\xFF]/g, "");

export async function buildCertificatePdf(c: CertificateData, verifyUrl: string): Promise<ArrayBuffer> {
  const [{ jsPDF }, QRCode] = await Promise.all([import("jspdf"), import("qrcode")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const center = (text: string, y: number) => doc.text(latin(text), W / 2, y, { align: "center" });

  doc.setFillColor(10, 10, 10);
  doc.rect(0, 0, W, H, "F");
  doc.setFillColor(255, 255, 255);
  doc.rect(22, 22, W - 44, H - 44, "F");
  doc.setDrawColor(182, 242, 58);
  doc.setLineWidth(3);
  doc.rect(34, 34, W - 68, H - 68);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  center(c.event.college.toUpperCase(), 78);
  doc.setFontSize(14);
  doc.setTextColor(10, 10, 10);
  center(c.event.name, 98);

  doc.setFontSize(30);
  center(c.kind === "winner" ? "Certificate of Achievement" : "Certificate of Participation", 160);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(90, 90, 90);
  center("This is to certify that", 200);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(32);
  doc.setTextColor(10, 10, 10);
  center(c.recipient_name, 248);
  doc.setDrawColor(145, 201, 39);
  doc.setLineWidth(1.2);
  doc.line(W / 2 - 180, 262, W / 2 + 180, 262);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(60, 60, 60);
  const dates = c.event.starts_on === c.event.ends_on ? fmtDate(c.event.starts_on) : `${fmtDate(c.event.starts_on)} to ${fmtDate(c.event.ends_on)}`;
  const line = c.kind === "winner"
    ? `has been awarded ${c.title.split(" · ")[0]} in ${c.competition_name ?? "the competition"} at ${c.event.name}, held on ${dates}.`
    : `has participated${c.competition_name ? ` in ${c.competition_name}` : ""} at ${c.event.name}, held on ${dates}.`;
  const wrapped = doc.splitTextToSize(latin(line), W - 220) as string[];
  wrapped.forEach((l, i) => center(l, 292 + i * 18));

  const s = c.event.certificate ?? {};
  const sig = (name: string | undefined, title: string | undefined, x: number) => {
    if (!name) return;
    doc.setDrawColor(10, 10, 10);
    doc.setLineWidth(0.6);
    doc.line(x - 90, H - 120, x + 90, H - 120);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(latin(name), x, H - 104, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    if (title) doc.text(latin(title), x, H - 91, { align: "center" });
    doc.setTextColor(10, 10, 10);
  };
  sig(s.signatory_1_name, s.signatory_1_title, 190);
  sig(s.signatory_2_name, s.signatory_2_title, W / 2);

  const qr = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: "M" });
  doc.addImage(qr, "PNG", W - 150, H - 160, 84, 84);
  doc.setFontSize(7);
  doc.setTextColor(110, 110, 110);
  doc.text(`Verify: ${c.code}`, W - 108, H - 66, { align: "center" });
  if (s.footer) center(s.footer, H - 52);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(10, 10, 10);
  doc.text("EVENT", 52, H - 52);
  doc.setTextColor(145, 201, 39);
  doc.text("APP", 52 + doc.getTextWidth("EVENT "), H - 52);
  if (c.revoked) {
    doc.setTextColor(200, 30, 30);
    doc.setFontSize(60);
    doc.text("REVOKED", W / 2, H / 2, { align: "center", angle: 20 });
  }
  return doc.output("arraybuffer");
}
