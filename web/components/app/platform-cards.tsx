import { Badge } from "@/components/ui";

export function StoreIcon({ store, className = "size-6" }: { store: "apple" | "google"; className?: string }) {
  return store === "apple" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="m8 16 6-10M10 6l6 10M7 13h10" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m8 5-2-3m10 3 2-3M5 11a7 7 0 0 1 14 0v1H5zm0 4v4h14v-4M8 19v3m8-3v3M2 14v4m20-4v4" />
      <path d="M9 8h.01M15 8h.01" />
    </svg>
  );
}

/** Apple is selected by default; future platforms add no step to today's setup. */
export function PlatformCards() {
  return (
    <section aria-label="App platform" className="grid grid-cols-2 gap-3">
      <div className="min-w-0 rounded-xl border border-accent/50 bg-accent-soft/40 p-3 sm:p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg"><StoreIcon store="apple" className="size-5" /></span>
          <div className="min-w-0"><p className="text-sm font-semibold">iOS</p><p className="text-xs text-muted">App Store</p></div>
        </div>
        <div className="mt-3"><Badge tone="accent">✓ Selected</Badge></div>
      </div>
      <div aria-disabled="true" className="min-w-0 rounded-xl border border-border bg-surface-2 p-3 text-muted sm:p-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-surface"><StoreIcon store="google" className="size-5" /></span>
          <div className="min-w-0"><p className="text-sm font-semibold">Android</p><p className="text-xs">Google Play RTDN</p></div>
        </div>
        <div className="mt-3"><Badge>Coming soon</Badge></div>
      </div>
    </section>
  );
}
