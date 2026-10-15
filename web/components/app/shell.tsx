"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Button, Skeleton } from "@/components/ui";
import { useWorkspace } from "./workspace";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ws, error, refresh } = useWorkspace();
  const isSelfHosted = ws?.instance.deploymentMode === "self_hosted";
  const settingsPath = isSelfHosted ? "/app/instance" : "/app/billing";
  const nav = [
    { href: "/app", label: "Apps", match: (p: string) => p === "/app" || p.startsWith("/app/apps") || p === "/app/new" },
    ...(ws ? [{ href: settingsPath, label: isSelfHosted ? "Instance" : "Billing", match: (p: string) => p.startsWith(settingsPath) }] : []),
    { href: "/app/account", label: "Account", match: (p: string) => p.startsWith("/app/account") },
  ];

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            <Logo href="/app" textClassName="hidden sm:inline" />
            <nav aria-label="App" className="flex items-center gap-0.5">
              {nav.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-md px-2 py-1.5 text-sm transition-colors sm:px-2.5 ${active ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          {ws &&
            (ws.instance.deploymentMode === "self_hosted" ? (
              <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">Self-hosted</span>
            ) : ws.account.plan === "pro" ? (
              <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-text">Pro</span>
            ) : ws.instance.billingEnabled ? (
              <Link
                href="/app/billing"
                className="shrink-0 whitespace-nowrap rounded-full border border-border-strong px-2.5 py-0.5 text-xs font-medium text-muted hover:text-fg"
              >
                <span className="hidden sm:inline">Free · </span>Upgrade
              </Link>
            ) : <span className="text-xs text-muted">Cloud Free</span>)}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {error ? (
          <div className="mx-auto max-w-md rounded-xl border border-border bg-surface p-6 text-center">
            <p className="font-medium">We couldn&apos;t load your workspace</p>
            <p className="mt-1 text-sm text-muted">{error}</p>
            <Button variant="secondary" className="mt-4" onClick={() => refresh()}>
              Try again
            </Button>
          </div>
        ) : ws ? (
          children
        ) : (
          <div className="space-y-6" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-8 w-48" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
            <Skeleton className="h-64" />
          </div>
        )}
      </main>
    </>
  );
}
