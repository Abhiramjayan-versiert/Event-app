import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Formats money; INR uses the Indian digit grouping (₹12,34,567). */
export function formatCurrency(value: unknown, currency = "INR", opts: { compact?: boolean } = {}) {
  const amount = toNumber(value);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 2,
    minimumFractionDigits: opts.compact ? 0 : amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatNumber(value: unknown, opts: { compact?: boolean } = {}) {
  return new Intl.NumberFormat("en-IN", { notation: opts.compact ? "compact" : "standard" }).format(toNumber(value));
}

function toDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
}

export function formatDate(value: string | Date | null | undefined, pattern = "d MMM yyyy") {
  const d = toDate(value);
  return d ? format(d, pattern) : "—";
}

export function formatDateTime(value: string | Date | null | undefined) {
  return formatDate(value, "d MMM yyyy, h:mm a");
}

export function formatRelative(value: string | Date | null | undefined) {
  const d = toDate(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : "—";
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return "—";
  if (!e || format(s, "yyyy-MM-dd") === format(e, "yyyy-MM-dd")) return format(s, "d MMM yyyy");
  if (s.getFullYear() === e.getFullYear()) {
    return s.getMonth() === e.getMonth() ? `${format(s, "d")}–${format(e, "d MMM yyyy")}` : `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
  }
  return `${format(s, "d MMM yyyy")} – ${format(e, "d MMM yyyy")}`;
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
