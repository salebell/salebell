import type { DailyRevenue } from "@/lib/database.types";
import { utcDay } from "@/lib/format";

export type Stats = { usd: number; purchases: number; trials: number; renewals: number; refunds: number; missingFx: boolean };

const empty = (): Stats => ({ usd: 0, purchases: 0, trials: 0, renewals: 0, refunds: 0, missingFx: false });

function add(into: Stats, s: Stats) {
  into.usd += s.usd;
  into.purchases += s.purchases;
  into.trials += s.trials;
  into.renewals += s.renewals;
  into.refunds += s.refunds;
  into.missingFx ||= s.missingFx;
}

/** Collapses daily_revenue rows (one per currency) into one Stats per UTC day. */
export function byDay(rows: DailyRevenue[]) {
  const map = new Map<string, Stats>();
  for (const r of rows) {
    if (!r.day) continue;
    const s = map.get(r.day) ?? empty();
    const gross = r.gross_revenue == null ? 0 : Number(r.gross_revenue);
    add(s, {
      usd: r.gross_revenue_usd == null ? 0 : Number(r.gross_revenue_usd),
      purchases: Number(r.purchases ?? 0),
      trials: Number(r.trials ?? 0),
      renewals: Number(r.renewals ?? 0),
      refunds: Number(r.refunds ?? 0),
      // Revenue in a currency we have no exchange rate for yet is left out of the USD total.
      missingFx: gross !== 0 && r.gross_revenue_usd == null,
    });
    map.set(r.day, s);
  }
  return map;
}

export function daysBack(n: number, today = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(utcDay(new Date(today.getTime() - i * 86_400_000)));
  return out;
}

export function total(map: Map<string, Stats>, days: string[]) {
  const s = empty();
  for (const d of days) {
    const v = map.get(d);
    if (v) add(s, v);
  }
  return s;
}

export type Bucket = { start: string; end: string; stats: Stats };

/** Daily buckets, or weekly ones (7 days each, ending today) when bucketDays is 7. */
export function buckets(map: Map<string, Stats>, rangeDays: number, bucketDays: 1 | 7): Bucket[] {
  const days = daysBack(rangeDays);
  const out: Bucket[] = [];
  for (let i = 0; i < days.length; i += bucketDays) {
    const slice = days.slice(i, i + bucketDays);
    out.push({ start: slice[0], end: slice[slice.length - 1], stats: total(map, slice) });
  }
  return out;
}
