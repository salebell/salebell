import type { ReactNode } from "react";

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {items.map((item) => (
        <details key={item.q} className="group px-5 py-1 open:pb-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[0.9375rem] font-medium marker:hidden [&::-webkit-details-marker]:hidden">
            {item.q}
            <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-45" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="max-w-3xl space-y-3 text-[0.9375rem] leading-relaxed text-muted">{item.a}</div>
        </details>
      ))}
    </div>
  );
}
