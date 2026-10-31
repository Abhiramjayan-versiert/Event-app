import { describe, expect, it } from "vitest";
import { isIsoTimestamp, toLocalInput } from "@/lib/datetime";

describe("datetime helpers", () => {
  it("recognises stored ISO timestamps but not datetime-local values", () => {
    expect(isIsoTimestamp("2026-11-05T04:30:00+00:00")).toBe(true);
    expect(isIsoTimestamp("2026-11-05T04:30:00.123Z")).toBe(true);
    expect(isIsoTimestamp("2026-11-05T10:00")).toBe(false);
    expect(isIsoTimestamp("")).toBe(false);
    expect(isIsoTimestamp(null)).toBe(false);
  });
  it("formats for datetime-local inputs in the runtime's timezone", () => {
    const iso = "2026-11-05T04:30:00Z";
    const d = new Date(iso);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(toLocalInput(iso)).toBe(expected);
    expect(toLocalInput(null)).toBe("");
  });
});
