import { describe, expect, it } from "vitest";
import { collegeSchema } from "@/lib/validations/college";
import { eventSchema, eventToRow } from "@/lib/validations/event";
import { loginSchema, setPasswordSchema } from "@/lib/validations/auth";
import { formatCurrency } from "@/lib/utils";

const validEvent = {
  college_id: "6f1c2a8e-8b4a-4a53-9a59-2f5f1c0d1e11",
  name: "Spectrum 2027",
  category: "cultural",
  starts_on: "2027-02-10",
  ends_on: "2027-02-12",
  registration_opens_at: "2027-01-01T09:00",
  registration_closes_at: "2027-02-05T23:59",
  website_url: "",
  contact_email: "",
  social_links: { instagram: "https://instagram.com/spectrum", linkedin: "", x: "", youtube: "", facebook: "" },
  currency: "INR",
  status: "planning",
};

describe("college validation", () => {
  it("normalises the college code to upper case", () => {
    const r = collegeSchema.parse({ name: "St. Xavier's", code: "sxc-blr", country: "India", status: "active" });
    expect(r.code).toBe("SXC-BLR");
  });
  it("rejects bad codes and websites", () => {
    expect(collegeSchema.safeParse({ name: "X College", code: "a b", country: "India", status: "active" }).success).toBe(false);
    expect(collegeSchema.safeParse({ name: "X College", code: "XC", country: "India", status: "active", website: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("event validation", () => {
  it("accepts a valid event", () => {
    expect(eventSchema.safeParse(validEvent).success).toBe(true);
  });
  it("requires end date on/after start date", () => {
    const r = eventSchema.safeParse({ ...validEvent, ends_on: "2027-02-01" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["ends_on"]);
  });
  it("requires registration to close after it opens", () => {
    expect(eventSchema.safeParse({ ...validEvent, registration_closes_at: "2026-12-01T09:00" }).success).toBe(false);
  });
  it("cannot be created directly as archived", () => {
    expect(eventSchema.safeParse({ ...validEvent, status: "archived" }).success).toBe(false);
  });
  it("converts local datetimes to UTC using the browser offset (IST = -330)", () => {
    const row = eventToRow(eventSchema.parse(validEvent), -330);
    expect(row.registration_opens_at).toBe("2027-01-01T03:30:00.000Z");
    expect(row.social_links).toEqual({ instagram: "https://instagram.com/spectrum" });
    expect(row.website_url).toBeNull();
  });
});

describe("auth validation", () => {
  it("lower-cases and trims emails", () => {
    expect(loginSchema.parse({ email: "  Admin@College.EDU ", password: "x" }).email).toBe("admin@college.edu");
  });
  it("enforces password strength and confirmation", () => {
    expect(setPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: "longpassword", confirmPassword: "longpassword" }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: "longpassword1", confirmPassword: "different1" }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ password: "longpassword1", confirmPassword: "longpassword1" }).success).toBe(true);
  });
});

describe("currency formatting", () => {
  it("uses Indian digit grouping for INR", () => {
    expect(formatCurrency(1234567)).toBe("₹12,34,567");
    expect(formatCurrency("2500.5")).toBe("₹2,500.50");
  });
});
