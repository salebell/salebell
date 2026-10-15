"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectionBadge } from "@/components/app/status";
import { useCurrentApp } from "@/components/app/use-current-app";
import { Alert, ButtonLink } from "@/components/ui";
import { StoreBadge } from "@/components/app/platform-cards";

const tabs = [
  { path: "", label: "Overview" },
  { path: "/setup", label: "Setup" },
  { path: "/integrations", label: "Integrations" },
  { path: "/forwarding", label: "Your server" },
  { path: "/settings", label: "Settings" },
];

export function AppDetail({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { app, paused } = useCurrentApp();

  if (!app) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6 text-center">
        <p className="font-medium">App not found</p>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or it belongs to another workspace.</p>
        <ButtonLink href="/app" variant="secondary" className="mt-4">
          Back to apps
        </ButtonLink>
      </div>
    );
  }

  const base = `/app/apps/${app.id}`;
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Link href="/app" className="text-sm text-muted hover:text-fg">
            ← Apps
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]">{app.name}</h1>
            <StoreBadge store={app.store} />
            <ConnectionBadge app={app} paused={paused} />
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted">{app.bundle_id}</p>
        </div>
      </div>
      {/* Wrapping pills on phones so every tab stays visible; underlined tabs from sm up. */}
      <nav aria-label="App sections" className="mb-8 sm:border-b sm:border-border">
        <ul className="flex flex-wrap gap-1.5 sm:flex-nowrap sm:gap-1">
          {tabs.map((t) => {
            const href = base + t.path;
            const active = pathname === href;
            return (
              <li key={t.path}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-block rounded-full border px-3 py-1.5 text-sm transition-colors sm:-mb-px sm:rounded-none sm:border-0 sm:border-b-2 sm:bg-transparent sm:py-2.5 ${active ? "border-accent/40 bg-accent-soft font-medium text-fg sm:border-accent" : "border-border text-muted hover:text-fg sm:border-transparent"}`}
                >
                  {app.store === "play_store" && t.path === "/forwarding" ? "Pub/Sub fan-out" : t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {paused && (
        <div className="mb-6">
          <Alert tone="warn">
            Alerts for this app are paused because your workspace is on the Free plan, which covers one app. Recording{app.store === "play_store" ? " continues" : " and forwarding to your server continue"}.{" "}
            <Link href="/app/billing" className="font-medium underline underline-offset-2">Upgrade to resume alerts</Link>.
          </Alert>
        </div>
      )}
      {!app.enabled && (
        <div className="mb-6">
          <Alert tone="neutral">
            This app is disabled. Salebell rejects its notifications and sends no alerts{app.store === "play_store" ? "" : " or forwards"} until you enable it in{" "}
            <Link href={`${base}/settings`} className="font-medium underline underline-offset-2">Settings</Link>.
          </Alert>
        </div>
      )}
      {children}
    </div>
  );
}
