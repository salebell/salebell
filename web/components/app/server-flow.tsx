import Link from "next/link";
import { Badge } from "@/components/ui";
import type { AppRow } from "@/lib/database.types";
import { StoreIcon } from "./platform-cards";

function destinationHost(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function FlowArrow({ active = true }: { active?: boolean }) {
  return <div aria-hidden="true" className={`grid place-items-center py-2 sm:py-0 ${active ? "text-accent-text" : "text-muted/50"}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-5 rotate-90 sm:rotate-0"><path d="M3 12h17m-6-6 6 6-6 6" /></svg></div>;
}

/** A hostname summary deliberately leaves webhook paths and tokens in the form. */
export function ServerFlow({ app }: { app: Pick<AppRow, "id" | "forward_url_production" | "forward_url_sandbox"> }) {
  const hasDestination = Boolean(app.forward_url_production || app.forward_url_sandbox);
  return (
    <figure aria-label="Apple notification flow" className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <figcaption className="mb-4 text-sm font-semibold">Where notifications go</figcaption>
      <div className="grid items-stretch sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)]">
        <div className="min-w-0 rounded-xl border border-border bg-surface-2 p-4">
          <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-fg"><StoreIcon store="apple" className="size-5" /></span>
          <p className="mt-3 text-xs text-muted">Source</p>
          <p className="mt-1 font-semibold">App Store</p>
          <p className="mt-1 text-xs text-muted">Purchase notifications</p>
        </div>
        <FlowArrow />
        <div className="min-w-0 rounded-xl border border-accent/50 bg-accent-soft/40 p-4">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-fg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8m-11 12a2 2 0 0 0 4 0M12 2V1" /></svg></span>
          <p className="mt-3 text-xs text-accent-text">Verify & record</p>
          <p className="mt-1 font-semibold">Salebell</p>
          <p className="mt-1 text-xs text-muted">Your revenue dashboard</p>
        </div>
        <FlowArrow active={hasDestination} />
        <div className={`min-w-0 rounded-xl border p-4 ${hasDestination ? "border-border bg-surface-2" : "border-dashed border-border bg-surface-2/50"}`}>
          <span className="grid size-9 place-items-center rounded-lg border border-border bg-surface text-muted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true"><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" /></svg></span>
          <p className="mt-3 text-xs text-muted">Destination · optional</p>
          <p className="mt-1 font-semibold">Your server</p>
          <dl className="mt-3 space-y-2 text-xs">
            {(["production", "sandbox"] as const).map((environment) => {
              const url = app[`forward_url_${environment}`];
              const host = destinationHost(url);
              return <div key={environment}><dt className="text-muted">{environment === "production" ? "Production" : "Sandbox"}</dt><dd className={`mt-0.5 break-all ${host ? "font-mono text-fg" : "text-muted"}`}>{host ?? (url ? "Check your URL" : "Not configured")}</dd></div>;
            })}
          </dl>
        </div>
        <div className="mt-4 min-w-0 sm:col-start-3 sm:mt-0">
          <div aria-hidden="true" className="hidden h-5 justify-center sm:flex"><span className="border-l border-dashed border-border-strong" /></div>
          <Link href={`/app/apps/${app.id}/integrations`} className="block rounded-xl border border-dashed border-border bg-surface-2/50 p-3 transition-colors hover:border-accent">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">Salebell → your alerts</span><Badge>Optional</Badge></div>
            <p className="mt-1 text-xs text-muted">Choose Slack, Discord & more ↗</p>
          </Link>
        </div>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-muted">{hasDestination ? "Salebell passes the original notification to each configured server. Alerts use a separate route." : "No server needed. Add a destination below if you already use one; Salebell still records your notifications."}</p>
    </figure>
  );
}
