export const siteConfig = {
  name: "EVENT APP",
  shortName: "EVENT APP",
  description: "Centralized event management and operations platform for colleges.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  defaultCurrency: "INR",
  defaultTimezone: "Asia/Kolkata",
} as const;
