import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createStripeApi, type StripeSubscription } from "../_shared/core/stripe.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { loadInstanceSettings } from "../_shared/instance.ts";
import { createCancelDuplicate, createStripeWebhook } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);
const secretKey = env("STRIPE_SECRET_KEY");
const stripe = secretKey ? createStripeApi(secretKey) : null;
const prices = [env("STRIPE_PRICE_MONTHLY"), env("STRIPE_PRICE_YEARLY")].filter((p): p is string => !!p);

Deno.serve(createStripeWebhook({
  billingEnabled: async () => (await loadInstanceSettings(db)).billing_enabled,
  webhookSecret: env("STRIPE_WEBHOOK_SECRET") ?? null,
  getSubscription: stripe
    ? async (id) => await stripe("GET", `subscriptions/${encodeURIComponent(id)}`, { expand: ["latest_invoice"] }) as StripeSubscription
    : null,
  allowedPrices: prices.length === 2 ? new Set(prices) : null,
  apply: (s) => db.rpc<string>("apply_stripe_subscription", {
    p_account: s.accountId, p_customer: s.customer, p_subscription: s.subscription, p_status: s.status, p_period_end: s.periodEnd,
    p_cancel_at_period_end: s.cancelAtPeriodEnd,
  }),
  cancelDuplicate: stripe ? createCancelDuplicate(stripe) : async () => { throw new Error("stripe not configured"); },
}));
