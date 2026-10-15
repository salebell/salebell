"use client";

import { eventLabel } from "@/lib/events";
import type { CsvEvent } from "@/lib/csv";
import { dateTime, money, timeAgo } from "@/lib/format";
import { Badge, Button, Skeleton } from "@/components/ui";

export type FeedEvent = CsvEvent & { fresh?: boolean };

const toneClass = {
  money: "text-accent-text",
  good: "text-fg",
  warn: "text-warn",
  bad: "text-danger",
  neutral: "text-fg",
} as const;

export function EventFeed({
  events,
  now,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  footer,
}: {
  events: FeedEvent[] | null;
  now: number;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  footer?: React.ReactNode;
}) {
  if (loading || !events) {
    return (
      <ul className="divide-y divide-border" aria-busy="true" aria-label="Loading events">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-4 w-16" />
          </li>
        ))}
      </ul>
    );
  }

  if (events.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <p className="text-2xl" aria-hidden="true">
          📭
        </p>
        <p className="mt-2 font-medium">No events yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">New store notifications appear here as they arrive. No need to refresh.</p>
        {footer && <div className="mt-6 text-left">{footer}</div>}
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border" aria-live="polite" aria-relevant="additions">
        {events.map((e) => {
          const label = eventLabel(e.type);
          return (
            <li key={e.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${e.fresh ? "animate-flash" : ""}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-base" aria-hidden="true">
                {label.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                  <span className={toneClass[label.tone]}>{label.label}</span>
                  {e.environment === "Sandbox" && <Badge tone="warn">Sandbox</Badge>}
                  {e.is_family_shared && <Badge>Family Sharing</Badge>}
                </p>
                <p className="truncate text-xs text-muted">
                  {[e.product_id, e.storefront].filter(Boolean).join(" · ") || e.raw_type}
                  {" · "}
                  <time dateTime={e.occurred_at} title={dateTime(e.occurred_at)}>
                    {timeAgo(e.occurred_at, now)}
                  </time>
                </p>
              </div>
              {e.revenue != null && (
                <span className={`tnum shrink-0 text-sm font-semibold ${Number(e.revenue) < 0 ? "text-danger" : ""}`}>
                  {Number(e.revenue) > 0 ? "+" : ""}
                  {money(e.revenue, e.currency)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {(hasMore || footer) && (
        <div className="space-y-4 border-t border-border px-4 py-4 sm:px-5">
          {hasMore && (
            <Button variant="secondary" size="sm" loading={loadingMore} onClick={onLoadMore}>
              Load older events
            </Button>
          )}
          {footer}
        </div>
      )}
    </>
  );
}
