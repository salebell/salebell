"use client";

import { useEffect, useRef, useState } from "react";
import type { StoreEvent } from "@/lib/database.types";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Calls onInsert for every new store_events row of this app (Realtime; RLS applies). */
export function useLiveEvents(appId: string | undefined, onInsert: (e: StoreEvent) => void) {
  const handler = useRef(onInsert);
  useEffect(() => {
    handler.current = onInsert;
  });
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!appId) return;
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`store_events:${appId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "store_events", filter: `app_id=eq.${appId}` },
        (payload) => handler.current(payload.new as StoreEvent),
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      setLive(false);
      supabase.removeChannel(channel);
    };
  }, [appId]);

  return live;
}

/** Re-renders every `ms` so relative times stay fresh. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
