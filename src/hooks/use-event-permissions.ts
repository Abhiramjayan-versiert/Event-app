"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventPermissionSet } from "@/lib/permissions";

const cache = new Map<string, EventPermissionSet>();

/**
 * Loads the signed-in user's permissions for an event. The last value is shown
 * straight away, but it is always re-checked, so access changes made by an
 * admin apply without restarting the app.
 */
export function useEventPermissions(eventId: string | null) {
  const [perms, setPerms] = useState<EventPermissionSet | null>(eventId ? cache.get(eventId) ?? null : null);

  useEffect(() => {
    if (!eventId) return setPerms(null);
    setPerms(cache.get(eventId) ?? null);
    let cancelled = false;
    const load = () =>
      createClient()
        .rpc("my_event_permissions", { p_event: eventId })
        .then(({ data }) => {
          if (cancelled || !data) return;
          const value = data as unknown as EventPermissionSet;
          cache.set(eventId, value);
          setPerms(value);
        });
    void load();
    // Re-check when the app comes back to the foreground (installed app on a phone).
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [eventId]);

  return perms;
}
