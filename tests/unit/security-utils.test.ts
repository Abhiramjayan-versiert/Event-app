import { describe, expect, it } from "vitest";
import { safeRedirectPath, fromDbError } from "@/lib/actions";
import { toCsv } from "@/lib/export/csv";
import { safeFileName } from "@/lib/storage";

describe("safeRedirectPath", () => {
  it("allows same-origin paths", () => {
    expect(safeRedirectPath("/events/123?tab=x")).toBe("/events/123?tab=x");
  });
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "", null, 42])("rejects %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });
});

describe("toCsv", () => {
  it("escapes quotes, commas and newlines", () => {
    const csv = toCsv([{ a: 'He said "hi"', b: "x,y", c: "line1\nline2" }], [
      { key: "a", header: "A" }, { key: "b", header: "B" }, { key: "c", header: "C" },
    ]);
    expect(csv).toBe('A,B,C\r\n"He said ""hi""","x,y","line1\nline2"');
  });
  it("neutralises spreadsheet formula injection", () => {
    const csv = toCsv([{ v: "=HYPERLINK(\"http://x\")" }, { v: "+1" }, { v: "-cmd" }, { v: "@SUM(A1)" }], [{ key: "v", header: "V" }]);
    expect(csv.split("\r\n").slice(1).every((line) => line.replace(/^"/, "").startsWith("'"))).toBe(true);
  });
  it("renders null as empty", () => {
    expect(toCsv([{ v: null }], [{ key: "v", header: "V" }])).toBe("V\r\n");
  });
});

describe("safeFileName", () => {
  it("strips path traversal and unsafe characters", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\temp\\a.png")).toBe("a.png");
    expect(safeFileName("My Invoice (Final).PDF")).toBe("my-invoice-final.pdf");
  });
});

describe("fromDbError", () => {
  it("never leaks raw database messages for unknown errors", () => {
    const r = fromDbError({ code: "XX000", message: "internal detail: relation secret" }, "Could not save.");
    expect(r).toEqual({ ok: false, error: "Could not save." });
  });
  it("maps RLS violations to a permission message", () => {
    const r = fromDbError({ code: "42501", message: 'new row violates row-level security policy for table "x"' });
    expect(r.ok === false && r.error).toBe("You do not have permission to perform this action.");
  });
});
