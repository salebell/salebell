import { Badge } from "@/components/ui";
import type { AppStore } from "@/lib/app-form";

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

export function StoreBadge({ store }: { store: string }) {
  return <Badge>{store === "play_store" ? "Google Play" : "App Store"}</Badge>;
}

export function PlatformCards({ value = "app_store", onChange }: { value?: AppStore; onChange?: (store: AppStore) => void }) {
  return (
    <section aria-label="App platform" className="grid grid-cols-2 gap-3">
      {(["app_store", "play_store"] as const).map((store) => <button key={store} type="button" aria-pressed={value === store} onClick={() => onChange?.(store)} className={`min-w-0 rounded-xl border p-3 text-left transition-colors sm:p-4 ${value === store ? "border-accent/50 bg-accent-soft/40" : "border-border bg-surface-2 hover:border-border-strong"}`}>
        <div className="flex items-center gap-2.5">
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${value === store ? "bg-accent text-accent-fg" : "border border-border bg-surface"}`}><StoreIcon store={store === "app_store" ? "apple" : "google"} className="size-5" /></span>
          <div className="min-w-0"><p className="text-sm font-semibold">{store === "app_store" ? "iOS" : "Android"}</p><p className="text-xs text-muted">{store === "app_store" ? "App Store" : "Google Play"}</p></div>
        </div>
        <div className="mt-3"><Badge tone={value === store ? "accent" : "neutral"}>{value === store ? "✓ Selected" : "Select"}</Badge></div>
      </button>)}
    </section>
  );
}
