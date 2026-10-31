/** Minimal RFC 5545 calendar writer (escaping, 75-octet line folding, UTC times). */
export type IcsItem = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  url?: string;
};

const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10).replace(/-/g, "");

export function buildIcs(name: string, items: IcsItem[], baseUrl: string, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EVENT APP//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const it of items) {
    lines.push("BEGIN:VEVENT", `UID:${it.uid}@event-app`, `DTSTAMP:${utc(now.toISOString())}`);
    if (it.all_day) lines.push(`DTSTART;VALUE=DATE:${day(it.starts_at)}`, `DTEND;VALUE=DATE:${day(it.ends_at)}`);
    else lines.push(`DTSTART:${utc(it.starts_at)}`, `DTEND:${utc(it.ends_at)}`);
    lines.push(`SUMMARY:${escape(it.title)}`);
    if (it.description) lines.push(`DESCRIPTION:${escape(it.description)}`);
    if (it.location) lines.push(`LOCATION:${escape(it.location)}`);
    if (it.url) lines.push(`URL:${baseUrl}${it.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
