// Stripe -> accounts.plan. Verifies Stripe-Signature, then re-reads the subscription
// from Stripe and applies its current state, so out-of-order and repeated events
// converge on the same result (idempotent).
// Only subscriptions to our own two prices count. A second live subscription for an account
// that already has one ('duplicate') is refunded and cancelled; the existing one stays.
import {
  type StripeApi, type StripeInvoice, type StripeSubscription, subscriptionRef, subscriptionState, verifyStripeSignature,
} from "../_shared/core/stripe.ts";

export type ApplyInput = {
  accountId: string | null; customer: string; subscription: string; status: string; periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type Deps = {
  /** Authoritative database setting; no Stripe activity is allowed when disabled. */
  billingEnabled: () => Promise<boolean>;
  webhookSecret: string | null;
  /** Latest subscription from Stripe (latest_invoice expanded); throws on transport errors. */
  getSubscription: ((id: string) => Promise<StripeSubscription>) | null;
  /** STRIPE_PRICE_MONTHLY and STRIPE_PRICE_YEARLY; null when not configured. */
  allowedPrices: ReadonlySet<string> | null;
  /** Returns 'pro' | 'free' | 'ignored' | 'no_account' | 'duplicate'. */
  apply: (input: ApplyInput) => Promise<string>;
  /** Refunds and cancels a duplicate subscription; throws so Stripe retries. */
  cancelDuplicate: (sub: StripeSubscription) => Promise<void>;
  now?: () => number;
  log?: Pick<Console, "log" | "warn" | "error">;
};

const reply = (status: number, body: unknown) => Response.json(body, { status });

export function createStripeWebhook(deps: Deps) {
  const log = deps.log ?? console;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return reply(405, { error: "POST required" });
    try {
      if (!await deps.billingEnabled()) return reply(200, { received: true, ignored: "billing_disabled" });
    } catch {
      return reply(503, { error: "instance_settings_unavailable" });
    }
    if (!deps.webhookSecret || !deps.getSubscription || !deps.allowedPrices?.size) return reply(503, { error: "stripe_not_configured" });
    const payload = await req.text();
    const ok = await verifyStripeSignature(payload, req.headers.get("stripe-signature"), deps.webhookSecret, { now: deps.now?.() });
    if (!ok) return reply(400, { error: "invalid signature" });

    let event: Parameters<typeof subscriptionRef>[0];
    try {
      event = JSON.parse(payload);
    } catch {
      return reply(400, { error: "invalid JSON" });
    }
    const ref = subscriptionRef(event);
    if (!ref) return reply(200, { received: true, ignored: event.type });

    try {
      const sub = await deps.getSubscription(ref.subscriptionId);
      const state = subscriptionState(sub);
      if (!state.priceIds.length || state.priceIds.some((id) => !deps.allowedPrices!.has(id))) {
        log.warn("stripe subscription with a foreign price ignored", { event: event.id, subscription: state.subscription });
        return reply(200, { received: true, outcome: "foreign_price" });
      }
      const outcome = await deps.apply({
        accountId: state.accountId ?? ref.accountId, customer: state.customer, subscription: state.subscription,
        status: state.status, periodEnd: state.periodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      });
      if (outcome === "duplicate") await deps.cancelDuplicate(sub);
      (outcome === "no_account" || outcome === "duplicate" ? log.warn : log.log)("stripe event applied", {
        event: event.id, type: event.type, subscription: state.subscription, status: state.status, outcome,
      });
      return reply(200, { received: true, outcome });
    } catch (error) {
      // 5xx makes Stripe retry with backoff.
      log.error("stripe event failed", { event: event.id, type: event.type, error: String(error) });
      return reply(500, { error: "processing failed" });
    }
  };
}

/**
 * Refunds the duplicate's latest invoice in full (it is minutes old) and cancels it now.
 * Refund first: once cancelled, a retried event would no longer be 'duplicate'.
 * Idempotency keys make Stripe retries of this event safe.
 */
export function createCancelDuplicate(stripe: StripeApi) {
  return async (sub: StripeSubscription): Promise<void> => {
    const latest = sub.latest_invoice ?? null;
    const invoice = typeof latest === "string"
      ? await stripe("GET", `invoices/${encodeURIComponent(latest)}`) as StripeInvoice
      : latest;
    const pi = invoice?.payment_intent;
    const paymentIntent = typeof pi === "string" ? pi : pi?.id;
    if (paymentIntent && invoice?.amount_paid) {
      await stripe("POST", "refunds", { payment_intent: paymentIntent, reason: "duplicate", metadata: { subscription: sub.id } },
        `salebell-duplicate-refund-${sub.id}`);
    }
    await stripe("DELETE", `subscriptions/${encodeURIComponent(sub.id)}`, undefined, `salebell-duplicate-cancel-${sub.id}`);
  };
}
