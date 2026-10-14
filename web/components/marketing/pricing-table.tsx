"use client";

import { useState } from "react";
import { ButtonLink } from "@/components/ui";
import { PLAN_ROWS, PRICES, YEARLY_PER_MONTH, YEARLY_SAVING } from "@/lib/plans";
import { cloudBillingPath } from "@/lib/deployment";

export function IntervalToggle({ value, onChange }: { value: "month" | "year"; onChange: (v: "month" | "year") => void }) {
  return (
    <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-lg border border-border bg-surface-2 p-1 text-sm">
      {(["month", "year"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-3.5 py-1.5 font-medium transition-colors ${value === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {v === "month" ? "Monthly" : "Yearly"}
          {v === "year" && <span className="ml-1.5 text-xs text-accent-text">Save {YEARLY_SAVING}%</span>}
        </button>
      ))}
    </div>
  );
}

function Cell({ value }: { value: string | boolean }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1.5 text-accent-text">
        <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Included</span>
      </span>
    );
  if (value === false)
    return (
      <span className="text-muted">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Not included</span>
      </span>
    );
  return <span>{value}</span>;
}

export function PricingTable({ cta = "/login" }: { cta?: string }) {
  const [interval, setPeriod] = useState<"month" | "year">("year");
  const proPrice = interval === "month" ? PRICES.month : PRICES.year;

  return (
    <div>
      <div className="mb-8 flex justify-center">
        <IntervalToggle value={interval} onChange={setPeriod} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {(["free", "pro"] as const).map((plan) => (
          <section
            key={plan}
            aria-labelledby={`plan-${plan}`}
            className={`flex flex-col rounded-2xl border p-6 sm:p-7 ${plan === "pro" ? "border-accent/50 bg-surface shadow-[0_20px_50px_-30px_var(--accent)]" : "border-border bg-surface"}`}
          >
            <div className="flex items-center justify-between">
              <h3 id={`plan-${plan}`} className="text-lg font-semibold">
                {plan === "free" ? "Cloud Free" : "Cloud Pro"}
              </h3>
              {plan === "pro" && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-text">For 2+ apps</span>}
            </div>
            <p className="mt-4 flex items-baseline gap-1.5">
              <span className="tnum text-4xl font-semibold tracking-tight">${plan === "free" ? 0 : proPrice}</span>
              <span className="text-sm text-muted">{plan === "free" ? "forever" : interval === "month" ? "per month" : "per year"}</span>
            </p>
            <p className="mt-2 min-h-10 text-sm text-muted">
              {plan === "free"
                ? "One app with verified purchase events, one integration and forwarding."
                : interval === "year"
                  ? `Every app you ship, every channel, full history. $${YEARLY_PER_MONTH}/month billed yearly.`
                  : "Every app you ship, every channel, full history."}
            </p>
            <ul className="mt-6 flex-1 space-y-3 border-t border-border pt-6 text-sm">
              {PLAN_ROWS.map((row) => (
                <li key={row.label} className="flex items-start justify-between gap-4">
                  <span className="text-muted">{row.label}</span>
                  <span className="shrink-0 text-right font-medium">
                    <Cell value={row[plan]} />
                  </span>
                </li>
              ))}
            </ul>
            <ButtonLink href={plan === "pro" ? `${cta}?next=${encodeURIComponent(cloudBillingPath(interval))}` : cta} variant={plan === "pro" ? "primary" : "secondary"} size="lg" className="mt-7 w-full">
              {plan === "free" ? "Start free" : "Start free, upgrade any time"}
            </ButtonLink>
          </section>
        ))}
      </div>
    </div>
  );
}
