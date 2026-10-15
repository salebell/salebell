import type { ReactNode } from "react";

const platformNodes = {
  apple: [
    { label: "Import iOS apps", detail: "App Store Connect", icon: "key" },
    { label: "Select your app", detail: "Choose the app to monitor", icon: "app" },
    { label: "Track purchases", detail: "Enable Apple notifications", icon: "play" },
  ],
  google: [
    { label: "Import Android apps", detail: "Google Play", icon: "key" },
    { label: "Select your app", detail: "Choose the app to monitor", icon: "app" },
    { label: "Track purchases", detail: "Enable Google notifications", icon: "play" },
  ],
} as const;

export function ConnectionIcon({ kind, className = "size-5" }: { kind: "key" | "app" | "play" | "check" | "upload"; className?: string }) {
  const paths: Record<typeof kind, ReactNode> = {
    key: <><circle cx="8" cy="8" r="4" /><path d="m11 11 9 9m-3-3 3-3m-6 0 3-3" /></>,
    app: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 16 4-8 4 8m-7-3h6" /></>,
    play: <path d="m9 5 11 7-11 7z" />,
    check: <path d="m5 12 4 4L19 6" />,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[kind]}</svg>;
}

export function ConnectionFlow({ current, platform = "apple" }: { current: number; platform?: "apple" | "google" }) {
  const nodes = platformNodes[platform];
  return (
    <ol className="grid grid-cols-3 gap-2 sm:gap-4" aria-label="Connection progress">
      {nodes.map((node, index) => (
        <li key={node.label} aria-current={index === current ? "step" : undefined} className={`relative min-w-0 rounded-xl border p-3 sm:p-4 ${index === current ? "border-accent/60 bg-accent-soft/40" : "border-border bg-surface-2 text-muted"}`}>
          <span className={`mb-3 grid size-9 place-items-center rounded-lg ${index <= current ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted"}`}>
            <ConnectionIcon kind={index < current ? "check" : node.icon} />
          </span>
          <p className="text-xs font-semibold sm:text-sm">{node.label}</p>
          <p className="mt-1 hidden text-xs text-muted sm:block">{node.detail}</p>
          {index < nodes.length - 1 ? <span className="absolute -right-2.5 top-6 z-10 rounded-full bg-bg px-0.5 text-muted sm:-right-3.5" aria-hidden="true">→</span> : null}
        </li>
      ))}
    </ol>
  );
}
