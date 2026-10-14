"use client";

import { useId } from "react";
import { CopyField } from "@/components/copy-button";
import { Badge } from "@/components/ui";

type Urls = { production_url: string | null; sandbox_url: string | null };

/** Mirrors the two server URL sections in App Store Connect. */
export function NotificationUrls({ urls, current, forwarding }: { urls: Urls; current?: Urls; forwarding?: Urls }) {
  const id = useId();
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-3">
        <h3 className="text-sm font-semibold">App Store Server Notifications</h3>
        <Badge>App Information</Badge>
      </div>
      <div className="divide-y divide-border">
        {(["production", "sandbox"] as const).map((environment) => {
          const key = `${environment}_url` as const;
          const label = environment === "production" ? "Production" : "Sandbox";
          return (
            <section key={environment} className="space-y-3 p-4 sm:p-5" aria-label={`${label} notification settings`}>
              <CopyField id={`${id}-${environment}`} label={`${label} Server URL`} value={urls[key] ?? ""} />
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="size-3 rounded-full border-[3.5px] border-accent" aria-hidden="true" />
                Version 2
              </div>
              {forwarding?.[key] ? (
                <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                  <p className="font-medium">↳ Your server stays connected</p>
                  <p className="mt-1 break-all font-mono text-muted">{forwarding[key]}</p>
                </div>
              ) : null}
              {current?.[key] && current[key] !== urls[key] ? (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">URL being replaced</summary>
                  <p className="mt-2 break-all font-mono">{current[key]}</p>
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
