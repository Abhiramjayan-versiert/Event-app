import { describe, expect, it } from "vitest";
import { buildIcs } from "@/lib/calendar/ics";

describe("buildIcs", () => {
  const ics = buildIcs("EVENT APP", [
    { uid: "task-1", title: "Task: Print banners, posters; flyers", description: "Line one\nLine two", starts_at: "2026-11-05T04:30:00Z", ends_at: "2026-11-05T05:00:00Z", all_day: false, url: "/events/x" },
    { uid: "event-1", title: "Tech Fest " + "x".repeat(120), starts_at: "2026-11-10T00:00:00Z", ends_at: "2026-11-13T00:00:00Z", all_day: true },
  ], "https://app.example", new Date("2026-11-01T00:00:00Z"));
  const lines = ics.split("\r\n");

  it("escapes text and uses UTC / all-day dates", () => {
    expect(ics).toContain("SUMMARY:Task: Print banners\\, posters\; flyers");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("DTSTART:20261105T043000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261110");
    expect(ics).toContain("URL:https://app.example/events/x");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds long lines to 75 octets", () => {
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(" x"))).toBe(true);
  });
});
