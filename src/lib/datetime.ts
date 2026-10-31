import { format } from "date-fns";

/**
 * ISO timestamp → value for <input type="datetime-local"> in the *current
 * runtime's* timezone. Call it in the browser (see useLocalDateTimeFields);
 * on the server it would use the server's timezone (UTC on Vercel).
 */
export function toLocalInput(iso: string | null | undefined) {
  return iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : "";
}

/** True for full ISO timestamps (with Z or an offset), as stored in the database. */
export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v);
}
