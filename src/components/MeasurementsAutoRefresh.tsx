"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type MeasurementsAutoRefreshProps = {
  channelName: string;
  pollMs?: number;
};

export function MeasurementsAutoRefresh({ channelName, pollMs = 5000 }: MeasurementsAutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    let refreshTimer: number | null = null;

    const refreshSoon = () => {
      if (refreshTimer) {
        return;
      }

      refreshTimer = window.setTimeout(() => {
        router.refresh();
        refreshTimer = null;
      }, 250);
    };

    const supabase = createClient();
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "measurements" }, refreshSoon)
      .subscribe();
    const interval = window.setInterval(refreshSoon, pollMs);

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [channelName, pollMs, router]);

  return null;
}
