"use client";

import Link from "next/link";
import type { PlanLimit } from "@/lib/errors";
import { PRICES } from "@/lib/plans";
import { useLoadedWorkspace } from "./workspace";

const copy: Record<PlanLimit, { title: string; body: string }> = {
  apps: {
    title: "Add more apps with Pro",
    body: "The Free plan covers one app. Pro gives you unlimited apps, unlimited integrations and full history.",
  },
  channels: {
    title: "Add more integrations with Pro",
    body: "The Free plan includes one integration across your workspace. Pro removes the limit, so every app can alert every channel.",
  },
  history: {
    title: "See your full history with Pro",
    body: "The Free plan shows the last 30 days. Older data is kept, not deleted, and appears as soon as you upgrade.",
  },
  export: {
    title: "Export CSV with Pro",
    body: "Download every event for this app as a spreadsheet-friendly CSV file.",
  },
};

export function UpgradeCallout({ reason, compact = false }: { reason: PlanLimit; compact?: boolean }) {
  const { isSelfHosted, billingEnabled } = useLoadedWorkspace();
  if (isSelfHosted) return null;
  const { title, body } = copy[reason];
  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-xl border border-accent/35 bg-accent-soft/60 sm:flex-row sm:items-center sm:justify-between ${compact ? "p-3.5" : "p-4 sm:p-5"}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-sm text-muted">{body}</p>
      </div>
      {billingEnabled ? <Link
        href="/app/billing?interval=month"
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover"
      >
        Upgrade · ${PRICES.month}/mo
      </Link> : <p className="text-xs text-muted">Paid subscriptions are not enabled. Contact your instance operator.</p>}
    </div>
  );
}
