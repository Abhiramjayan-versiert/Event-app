import { publicEnv } from "@/lib/env";

/** Public URL for files in public buckets (avatars, branding). Private documents use signed URLs. */
export function publicStorageUrl(bucket: "avatars" | "branding", path: string | null | undefined) {
  if (!path || !publicEnv.supabaseUrl) return null;
  return `${publicEnv.supabaseUrl}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export const UPLOAD_LIMITS = {
  avatar: { maxBytes: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  branding: { maxBytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] },
} as const;

export function safeFileName(input: string) {
  const name = input.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  return ext ? `${base}.${ext}` : base;
}
