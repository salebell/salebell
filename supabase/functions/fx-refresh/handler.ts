// Refreshes fx_rates (USD per unit of each currency) from open.er-api.com: free,
// no key, ~160 currencies (every App Store currency). Runs daily from pg_cron;
// a no-op when the rates are under 6 hours old, so extra calls are harmless.
export const FX_SOURCE = "https://open.er-api.com/v6/latest/USD";
export const MIN_AGE_MS = 6 * 60 * 60 * 1000;

export type Deps = {
  lastUpdated: () => Promise<string | null>;
  upsert: (rates: Record<string, number>) => Promise<number>;
  fetcher?: typeof fetch;
  now?: () => number;
  log?: Pick<Console, "log" | "error">;
};

const reply = (status: number, body: unknown) => Response.json(body, { status });

/** Source gives units per USD; we store USD per unit. */
export function toUsdPerUnit(perUsd: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, v] of Object.entries(perUsd)) {
    if (/^[A-Z]{3}$/.test(code) && typeof v === "number" && v > 0 && Number.isFinite(v)) out[code] = Number((1 / v).toPrecision(12));
  }
  return out;
}

export function createFxRefresh(deps: Deps) {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  return async (_req: Request): Promise<Response> => {
    try {
      const last = await deps.lastUpdated();
      if (last && now() - Date.parse(last) < MIN_AGE_MS) return reply(200, { refreshed: false, updated_at: last });
      const res = await fetcher(FX_SOURCE, { signal: AbortSignal.timeout(15_000) });
      const data = await res.json() as { result?: string; rates?: Record<string, unknown> };
      if (!res.ok || data.result !== "success" || !data.rates) throw new Error(`fx source HTTP ${res.status} ${data.result ?? ""}`);
      const rates = toUsdPerUnit(data.rates);
      if (rates.USD !== 1 || Object.keys(rates).length < 100) throw new Error(`fx source returned ${Object.keys(rates).length} rates`);
      const count = await deps.upsert(rates);
      log.log("fx rates refreshed", { count });
      return reply(200, { refreshed: true, count });
    } catch (error) {
      log.error("fx refresh failed", { error: String(error) });
      return reply(502, { error: "fx refresh failed" });
    }
  };
}
