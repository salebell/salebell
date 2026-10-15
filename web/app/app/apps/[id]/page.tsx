"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventFeed, type FeedEvent } from "@/components/app/event-feed";
import { RevenueChart } from "@/components/app/revenue-chart";
import { isConnected } from "@/components/app/status";
import { UpgradeCallout } from "@/components/app/upgrade";
import { useCurrentApp } from "@/components/app/use-current-app";
import { Alert, Button, ButtonLink, Card, Skeleton } from "@/components/ui";
import { CSV_COLUMNS, download, toCsv, type CsvEvent } from "@/lib/csv";
import type { DailyRevenue } from "@/lib/database.types";
import { friendlyError } from "@/lib/errors";
import { collectPages, eventCursor } from "@/lib/event-pages";
import { count, usd, utcDay } from "@/lib/format";
import { useLiveEvents, useNow } from "@/lib/hooks";
import { loadOverview, overviewStats, type Overview } from "@/lib/overview";
import { FREE_LIMITS } from "@/lib/plans";
import { buckets, byDay, daysBack, total, type Stats } from "@/lib/revenue";
import { supabaseBrowser } from "@/lib/supabase/client";

type Env = "Production" | "Sandbox";
type Range = 30 | 90 | 365;
const RANGES: { days: Range; label: string }[] = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];
const PAGE = 30;
const SELECT = CSV_COLUMNS.join(", ");

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; locked?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 font-medium transition-colors ${value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {o.label}
          {o.locked && (
            <svg viewBox="0 0 16 16" className="size-3" aria-label="Pro">
              <path d="M5 7V5a3 3 0 0 1 6 0v2M4 7h8v6H4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

function Kpi({ title, stats }: { title: string; stats: Stats | null }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{title}</p>
      {stats ? (
        <>
          <p className="tnum mt-1.5 text-[1.75rem] font-semibold leading-tight tracking-tight">{usd(stats.usd)}</p>
          <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
            <div className="flex justify-between gap-2"><dt>Purchases</dt><dd className="font-medium text-fg">{count(stats.purchases)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Renewals</dt><dd className="font-medium text-fg">{count(stats.renewals)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Trials</dt><dd className="font-medium text-fg">{count(stats.trials)}</dd></div>
            <div className="flex justify-between gap-2"><dt>Refunds</dt><dd className={`font-medium ${stats.refunds ? "text-danger" : "text-fg"}`}>{count(stats.refunds)}</dd></div>
          </dl>
        </>
      ) : (
        <>
          <Skeleton className="mt-2 h-8 w-32" />
          <Skeleton className="mt-4 h-8 w-full" />
        </>
      )}
    </Card>
  );
}

export default function AppOverviewPage() {
  const { app, isPro } = useCurrentApp();
  const now = useNow();
  const appId = app?.id;
  const [env, setEnv] = useState<Env>(() => (app && !app.last_event_production_at && app.last_event_sandbox_at ? "Sandbox" : "Production"));
  const [range, setRange] = useState<Range>(30);
  const [rows, setRows] = useState<DailyRevenue[] | null>(null);
  // undefined while loading, null if the RPC failed (fall back to UTC days).
  const [overview, setOverview] = useState<Overview | null | undefined>(undefined);
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<"idle" | "busy" | "locked">("idle");
  const refetchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const rangeLocked = !isPro && range > FREE_LIMITS.historyDays;
  const fetchDays = Math.max(range, 30);

  const loadRevenue = useCallback(async () => {
    if (!appId) return;
    const from = daysBack(fetchDays)[0];
    const { data, error } = await supabaseBrowser()
      .from("daily_revenue")
      .select("*")
      .eq("app_id", appId)
      .eq("environment", env)
      .gte("day", from);
    if (error) setError(friendlyError(error));
    setRows(data ?? []);
  }, [appId, env, fetchDays]);

  const loadToday = useCallback(async () => {
    if (!appId) return;
    const all = await loadOverview();
    setOverview(all ? (all.find((o) => o.app_id === appId) ?? null) : null);
  }, [appId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on filter change
    loadRevenue();
  }, [loadRevenue]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset feed on filter change
    setEvents(null);
    supabaseBrowser()
      .from("store_events")
      .select(SELECT)
      .eq("app_id", appId)
      .eq("environment", env)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(friendlyError(error));
        setEvents((data as unknown as CsvEvent[] | null) ?? []);
        setHasMore((data?.length ?? 0) === PAGE);
      });
    return () => {
      cancelled = true;
    };
  }, [appId, env]);

  useLiveEvents(appId, (e) => {
    if (e.environment !== env) return;
    setEvents((cur) => (cur && !cur.some((x) => x.id === e.id) ? [{ ...e, fresh: true }, ...cur] : cur));
    clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      loadRevenue();
      if (e.environment === "Production") loadToday();
    }, 1200);
  });

  async function loadMore() {
    if (!appId || !events?.length || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    const { data, error } = await supabaseBrowser()
      .from("store_events")
      .select(SELECT)
      .eq("app_id", appId)
      .eq("environment", env)
      .or(eventCursor(events[events.length - 1]))
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE);
    setLoadingMore(false);
    if (error) return setError(friendlyError(error, "Couldn't load more events. Try again."));
    setEvents((current) => {
      const combined = [...(current ?? []), ...((data as unknown as CsvEvent[] | null) ?? [])];
      return Array.from(new Map(combined.map((event) => [event.id, event])).values());
    });
    setHasMore((data?.length ?? 0) === PAGE);
  }

  async function exportCsv() {
    if (!app) return;
    if (!isPro) return setExportState("locked");
    setExportState("busy");
    setError(null);
    try {
      const all = await collectPages<CsvEvent>(async (from, to) => {
        const { data, error } = await supabaseBrowser()
        .from("store_events")
        .select(SELECT)
        .eq("app_id", app.id)
        .eq("environment", env)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
        return { data: data as unknown as CsvEvent[] | null, error };
      });
      const slug = app.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
      download(`salebell-${slug}-${env.toLowerCase()}-${utcDay(new Date())}.csv`, toCsv(all));
    } catch (error) {
      setError(`Export failed. No file was downloaded. ${friendlyError(error instanceof Error ? error : null)}`);
    } finally {
      setExportState("idle");
    }
  }

  const map = useMemo(() => (rows ? byDay(rows) : null), [rows]);
  // Production totals come from app_overview in the browser's time zone; Sandbox (or an RPC error) uses UTC days.
  const kpis = useMemo(() => {
    if (!map) return null;
    const missingFx = total(map, daysBack(30)).missingFx;
    if (env === "Production" && overview === undefined) return null;
    if (env === "Production" && overview) {
      const o = overviewStats(overview);
      return { ...o, month: { ...o.month, missingFx } };
    }
    return { today: total(map, daysBack(1)), week: total(map, daysBack(7)), month: total(map, daysBack(30)) };
  }, [map, env, overview]);
  const chart = useMemo(() => (map ? buckets(map, range, range > 90 ? 7 : 1) : null), [map, range]);

  if (!app) return null;
  const google = app.store === "play_store";

  return (
    <div className="space-y-8">
      {!isConnected(app) && (
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Waiting for the first notification</p>
            <p className="text-sm text-muted">{google ? "Connect Pub/Sub and save the topic in Play Console to start receiving events." : "Paste your Salebell URLs into App Store Connect to start receiving events."}</p>
          </div>
          <ButtonLink href={`/app/apps/${app.id}/setup`} size="sm">
            Finish setup
          </ButtonLink>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Environment"
          value={env}
          onChange={setEnv}
          options={[
            { value: "Production", label: "Production" },
            { value: "Sandbox", label: "Sandbox" },
          ]}
        />
        <p className="text-xs text-muted">{google ? "Verified Google Play order totals, including discounts and tax, in USD (est.). Chart days are UTC." : "Gross customer price before Apple's commission, in USD (est.). Chart days are UTC."}</p>
      </div>

      {error && <Alert>{error}</Alert>}

      <section aria-label="Key numbers" className="grid gap-4 sm:grid-cols-3">
        <Kpi title="Today" stats={kpis?.today ?? null} />
        <Kpi title="Last 7 days" stats={kpis?.week ?? null} />
        <Kpi title="Last 30 days" stats={kpis?.month ?? null} />
      </section>
      {kpis?.month.missingFx && (
        <p className="-mt-4 text-xs text-muted">
          Some purchases are in a currency without an exchange rate yet and aren&apos;t included in the USD totals.
        </p>
      )}

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Gross revenue</h2>
          <Segmented
            label="Chart range"
            value={range}
            onChange={setRange}
            options={RANGES.map((r) => ({ value: r.days, label: r.label, locked: !isPro && r.days > FREE_LIMITS.historyDays }))}
          />
        </div>
        {rangeLocked ? (
          <UpgradeCallout reason="history" />
        ) : chart ? (
          <RevenueChart data={chart} title={`${env} gross revenue in USD, ${range > 90 ? "weekly" : "daily"}, last ${RANGES.find((r) => r.days === range)!.label}`} />
        ) : (
          <Skeleton className="h-[220px]" />
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 font-semibold">
            Live events
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
          </h2>
          <Button variant="secondary" size="sm" loading={exportState === "busy"} onClick={exportCsv}>
            Export CSV
            {!isPro && <span className="rounded bg-accent-soft px-1.5 py-px text-[0.625rem] font-semibold text-accent-text">PRO</span>}
          </Button>
        </div>
        {exportState === "locked" && (
          <div className="border-b border-border p-4 sm:px-5">
            <UpgradeCallout reason="export" compact />
          </div>
        )}
        <EventFeed
          events={events}
          now={now}
          loading={events === null}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          footer={
            !isPro && events && !hasMore && events.length > 0 ? (
              <p className="text-xs text-muted">
                The Free plan shows the last 30 days. Older events are kept.{" "}
                <Link href="/app/billing" className="font-medium text-accent-text underline underline-offset-2">
                  Upgrade to see everything
                </Link>
              </p>
            ) : null
          }
        />
      </Card>
    </div>
  );
}
