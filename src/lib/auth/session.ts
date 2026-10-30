import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AccessSummary } from "@/lib/auth/types";
import { EMPTY_PERMISSIONS, type EventPermissionSet, type PermissionKey, can } from "@/lib/permissions";

/** Verified user (validated against Supabase Auth) — deduplicated per request. */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export const getAccess = cache(async (): Promise<AccessSummary | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_access");
  if (error) throw new Error(`Could not load access: ${error.message}`);
  return (data as unknown as AccessSummary) ?? null;
});

export async function requireAccess() {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (access.status !== "active") redirect("/auth/suspended");
  return access;
}

export async function requireSuperAdmin() {
  const access = await requireAccess();
  if (!access.is_super_admin) notFound();
  return access;
}

export const getEventPermissions = cache(async (eventId: string): Promise<EventPermissionSet> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_event_permissions", { p_event: eventId });
  if (error) return EMPTY_PERMISSIONS;
  return (data as unknown as EventPermissionSet) ?? EMPTY_PERMISSIONS;
});

/** Loads an event the user can see (RLS) together with their permissions; 404 otherwise. */
export const getEventContext = cache(async (eventId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("*, college:colleges(id, name, code, status)")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) notFound();
  const permissions = await getEventPermissions(eventId);
  return { event, permissions };
});

export async function requireEventPermission(eventId: string, key: PermissionKey) {
  const ctx = await getEventContext(eventId);
  if (!can(ctx.permissions, key)) notFound();
  return ctx;
}
