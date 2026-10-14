import type { Database } from "@/lib/database.types";
import type { Stats } from "@/lib/revenue";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Overview = Database["public"]["Functions"]["app_overview"]["Returns"][number];

function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Production totals per app for today / 7 / 30 calendar days in the browser's time zone, like the iOS app. Null on error. */
export async function loadOverview(): Promise<Overview[] | null> {
  const { data, error } = await supabaseBrowser().rpc("app_overview", { p_tz: timeZone() });
  return error ? null : data;
}

function stats(o: Overview, suffix: "today" | "7d" | "30d"): Stats {
  return {
    usd: Number(o[`gross_usd_${suffix}`] ?? 0),
    purchases: Number(o[`purchases_${suffix}`] ?? 0),
    trials: Number(o[`trials_${suffix}`] ?? 0),
    renewals: Number(o[`renewals_${suffix}`] ?? 0),
    refunds: Number(o[`refunds_${suffix}`] ?? 0),
    missingFx: false,
  };
}

export function overviewStats(o: Overview) {
  return { today: stats(o, "today"), week: stats(o, "7d"), month: stats(o, "30d") };
}
