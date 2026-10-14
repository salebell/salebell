"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddAppOptions } from "@/components/app/add-app-options";
import { PageHeader } from "@/components/app/page-header";
import { ConnectionBadge, isConnected, lastEventAt } from "@/components/app/status";
import { useLoadedWorkspace } from "@/components/app/workspace";
import { ButtonLink, Card, Skeleton } from "@/components/ui";
import { count, timeAgo, usd } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { loadOverview } from "@/lib/overview";

type Today = Record<string, { usd: number; purchases: number }>;

export default function AppsPage() {
  const { ws, pausedAppIds } = useLoadedWorkspace();
  const now = useNow();
  const [today, setToday] = useState<Today | null>(null);
  const appIds = ws.apps.map((a) => a.id).join(",");

  useEffect(() => {
    if (!appIds) return;
    loadOverview().then((rows) => {
      const out: Today = {};
      for (const r of rows ?? []) out[r.app_id] = { usd: Number(r.gross_usd_today ?? 0), purchases: Number(r.purchases_today ?? 0) };
      setToday(out);
    });
  }, [appIds]);

  if (ws.apps.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-accent-text">Welcome to Salebell</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">Let&apos;s hear your first in-app purchase</h1>
        <p className="mt-2 text-muted">
          Connect your store. Pick your app. Hear your next sale.
        </p>
        <Card className="mt-6 p-4 sm:p-6">
          <AddAppOptions />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Apps"
        description={ws.account.name}
        actions={<ButtonLink href="/app/new">Add app</ButtonLink>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {ws.apps.map((app) => {
          const last = lastEventAt(app);
          const t = today?.[app.id];
          return (
            <Link
              key={app.id}
              href={`/app/apps/${app.id}${isConnected(app) ? "" : "/setup"}`}
              className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold group-hover:text-accent-text">{app.name}</p>
                  <p className="truncate font-mono text-xs text-muted">{app.bundle_id}</p>
                </div>
                <ConnectionBadge app={app} paused={pausedAppIds.has(app.id)} />
              </div>
              <div className="mt-6 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">Today, USD est.</p>
                  {today ? (
                    <p className="tnum mt-0.5 text-2xl font-semibold tracking-tight">{t ? usd(t.usd) : "–"}</p>
                  ) : (
                    <Skeleton className="mt-1.5 h-7 w-24" />
                  )}
                </div>
                <p className="text-right text-xs text-muted">
                  {t && <span className="tnum block">{count(t.purchases)} {t.purchases === 1 ? "purchase" : "purchases"}</span>}
                  {last ? `Last event ${timeAgo(last, now)}` : "Continue setup →"}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
