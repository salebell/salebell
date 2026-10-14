import type { AppRow } from "@/lib/database.types";
import { timeAgo } from "@/lib/format";

export function lastEventAt(app: AppRow) {
  const times = [app.last_event_production_at, app.last_event_sandbox_at].filter(Boolean) as string[];
  return times.sort().at(-1) ?? null;
}

export function isConnected(app: AppRow) {
  return lastEventAt(app) !== null;
}

export function StatusDot({ on, pulse }: { on: boolean; pulse?: boolean }) {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden="true">
      {pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${on ? "bg-accent" : "bg-warn"}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${on ? "bg-accent" : "bg-warn"}`} />
    </span>
  );
}

export function EnvStatus({ app, env, now }: { app: AppRow; env: "production" | "sandbox"; now: number }) {
  const at = env === "production" ? app.last_event_production_at : app.last_event_sandbox_at;
  const label = env === "production" ? "Production" : "Sandbox";
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusDot on={!!at} pulse={!at} />
      <span className="font-medium">{label}</span>
      <span className="text-muted">{at ? `last event ${timeAgo(at, now)}` : "waiting for first notification"}</span>
    </div>
  );
}

export function ConnectionBadge({ app, paused }: { app: AppRow; paused?: boolean }) {
  if (!app.enabled)
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">Disabled</span>;
  if (paused)
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Paused on Free</span>;
  const connected = isConnected(app);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${connected ? "bg-accent-soft text-accent-text" : "bg-warn-soft text-warn"}`}
    >
      <StatusDot on={connected} />
      {connected ? "Connected" : "Waiting"}
    </span>
  );
}
