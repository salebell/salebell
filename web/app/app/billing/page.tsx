"use client";

import { redirect, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/page-header";
import { useLoadedWorkspace } from "@/components/app/workspace";
import { IntervalToggle } from "@/components/marketing/pricing-table";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { functionError } from "@/lib/errors";
import { FOUNDER_SENTENCE, PLAN_ROWS, PRICES, YEARLY_PER_MONTH } from "@/lib/plans";
import { supabaseBrowser } from "@/lib/supabase/client";

const STATUS: Record<string, { label: string; tone: "accent" | "warn" | "danger" | "neutral" }> = {
  active: { label: "Active", tone: "accent" },
  trialing: { label: "Trial", tone: "accent" },
  past_due: { label: "Payment failed, retrying", tone: "warn" },
  unpaid: { label: "Unpaid", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
  incomplete: { label: "Waiting for payment", tone: "warn" },
  incomplete_expired: { label: "Payment expired", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(iso));
}

function BillingContent() {
  const { ws, isPro, isSelfHosted, billingEnabled, refresh } = useLoadedWorkspace();
  const params = useSearchParams();
  const checkout = params.get("checkout");
  const [interval, setPeriod] = useState<"month" | "year">(params.get("interval") === "month" ? "month" : "year");
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = ws.role === "owner";
  const { account } = ws;
  const status = account.subscription_status ? STATUS[account.subscription_status] : null;
  // Optional until the column is deployed everywhere.
  const wontRenew = (account as { cancel_at_period_end?: boolean }).cancel_at_period_end === true;
  const waitingForStripe = billingEnabled && checkout === "success" && !isPro;

  // Stripe confirms the upgrade by webhook a moment after Checkout returns; poll for about a minute until the plan flips.
  useEffect(() => {
    if (!waitingForStripe) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      refresh();
      if (tries >= 30) {
        clearInterval(t);
        setSlow(true);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [waitingForStripe, refresh]);

  async function go(action: "checkout" | "portal") {
    if (!billingEnabled || isSelfHosted) return;
    setBusy(action);
    setError(null);
    const { data, error } = await supabaseBrowser().functions.invoke<{ url?: string }>("billing", {
      body: action === "checkout" ? { action, interval } : { action },
    });
    if (error || !data?.url) {
      setBusy(null);
      setError(error ? await functionError(error, "Billing isn't available right now.") : "Billing isn't available right now.");
      return;
    }
    window.location.href = data.url;
  }

  if (isSelfHosted) redirect("/app/instance");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Billing" description={`Plan for ${account.name}`} />

      {billingEnabled && checkout === "success" && (
        <Alert tone={isPro || !slow ? "accent" : "warn"}>
          {isPro
            ? "You're on Pro. Thank you!"
            : slow
              ? "Taking longer than usual, refresh in a minute."
              : "Waiting for Stripe to confirm your subscription…"}
        </Alert>
      )}
      {checkout === "cancel" && <Alert tone="neutral">Checkout canceled. You haven&apos;t been charged.</Alert>}
      {error && <Alert>{error}</Alert>}

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="mt-0.5 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {isPro ? "Pro" : "Free"}
              {status && <Badge tone={status.tone}>{status.label}</Badge>}
            </p>
            {isPro && account.current_period_end && (
              <p className="mt-1 text-sm text-muted">
                {wontRenew
                  ? `Pro until ${formatDate(account.current_period_end)}. Won't renew.`
                  : `${account.subscription_status === "canceled" ? "Ends" : "Renews"} on ${formatDate(account.current_period_end)}`}
              </p>
            )}
          </div>
          {billingEnabled && isOwner && (isPro || account.subscription_status) && (
            <Button variant="secondary" loading={busy === "portal"} onClick={() => go("portal")}>
              Manage subscription
            </Button>
          )}
        </div>
        {account.subscription_status === "past_due" && (
          <div className="mt-4">
            <Alert tone="warn">Your last payment failed. Stripe will retry; update your card in Manage subscription to keep Pro.</Alert>
          </div>
        )}
      </Card>

      {!billingEnabled && <Alert tone="neutral">Paid cloud subscriptions are not enabled on this instance. Your current plan remains available. Contact the operator for help.</Alert>}
      {billingEnabled && !isPro && !waitingForStripe && (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Upgrade to Pro</h2>
                <p className="mt-0.5 text-sm text-muted">Unlimited apps and integrations, full history, CSV export.</p>
              </div>
              <IntervalToggle value={interval} onChange={setPeriod} />
            </div>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="tnum text-4xl font-semibold tracking-tight">${interval === "month" ? PRICES.month : PRICES.year}</span>
              <span className="text-sm text-muted">{interval === "month" ? "per month" : `per year ($${YEARLY_PER_MONTH}/month)`}</span>
            </p>
            {isOwner ? (
              <Button size="lg" className="mt-5 w-full sm:w-auto" loading={busy === "checkout"} onClick={() => go("checkout")}>
                Upgrade with Stripe
              </Button>
            ) : (
              <p className="mt-5 text-sm text-muted">Only the workspace owner can change the plan.</p>
            )}
            <p className="mt-3 text-sm text-muted">
              {FOUNDER_SENTENCE} Enter the code at checkout.
            </p>
            <p className="mt-2 text-xs text-muted">Secure checkout by Stripe. Cancel any time; your data is never deleted on downgrade.</p>
          </div>
          <ul className="divide-y divide-border text-sm">
            {PLAN_ROWS.map((row) => (
              <li key={row.label} className="flex items-start justify-between gap-4 px-5 py-2.5 sm:px-6">
                <span className="text-muted">{row.label}</span>
                <span className="shrink-0 text-right font-medium">{row.pro === true ? "✓" : row.pro}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
