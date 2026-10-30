"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventPermissionSet } from "@/lib/permissions";

const cache = new Map<string, EventPermissionSet>();

/** Loads (and caches per session) the signed-in user's permissions for an event. */
export function useEventPermissions(eventId: string | null) {
  const [perms, setPerms] = useState<EventPermissionSet | null>(eventId ? cache.get(eventId) ?? null : null);

  useEffect(() => {
    if (!eventId) return setPerms(null);
    const cached = cache.get(eventId);
    if (cached) return setPerms(cached);
    let cancelled = false;
    createClient()
      .rpc("my_event_permissions", { p_event: eventId })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const value = data as unknown as EventPermissionSet;
        cache.set(eventId, value);
        setPerms(value);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return perms;
}
