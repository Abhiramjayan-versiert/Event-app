"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-renders the current server page when rows of the given tables change for
 * this event. Realtime respects RLS, so users only receive changes they may see.
 */
export function RealtimeRefresh({ eventId, tables }: { eventId: string; tables: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let channel = supabase.channel(`event:${eventId}:${tables.join(",")}`);
    for (const table of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eventId}` }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 800);
      });
    }
    channel.subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [eventId, tables, router]);

  return null;
}
