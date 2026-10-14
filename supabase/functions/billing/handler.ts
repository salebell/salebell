// POST {action:"checkout", interval:"month"|"year", account_id?} -> {url}
// POST {action:"portal", account_id?} -> {url}
// Account owners only. Stripe REST over fetch, no SDK.
// Checkout always runs against the account's own Stripe customer (created on first use),
// and is refused while the account has a live subscription, so one account cannot end up
// with two subscriptions from two checkouts. stripe-webhook refunds any that slip through.
import { bearer, browserFunction, json, readJson } from "../_shared/core/http.ts";
import { createStripeApi } from "../_shared/core/stripe.ts";
import type { AuthUser } from "../_shared/supabase.ts";

export type OwnerAccount = {
  id: string; name: string; plan: "free" | "pro"; stripe_customer_id: string | null;
  stripe_subscription_id: string | null; subscription_status: string | null; cancel_at_period_end?: boolean;
};
export type BillingConfig = { secretKey: string; priceMonthly: string; priceYearly: string; siteUrl: string };

export type Deps = {
  /** Authoritative database setting, resolved for every request. Errors fail closed. */
  billingEnabled: () => Promise<boolean>;
  config: BillingConfig | null;
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  /** The given account if the user owns it, else their oldest owned account; null if none. */
  ownerAccount: (userId: string, accountId: string | null) => Promise<OwnerAccount | null>;
  /** Stores the customer unless one is already set; returns the stored id. */
  setCustomer: (accountId: string, customerId: string) => Promise<string>;
  fetcher?: typeof fetch;
  log?: Pick<Console, "error">;
};

export function billingConfigFromEnv(get: (name: string) => string | undefined): BillingConfig | null {
  const secretKey = get("STRIPE_SECRET_KEY"), priceMonthly = get("STRIPE_PRICE_MONTHLY"), priceYearly = get("STRIPE_PRICE_YEARLY");
  const siteUrl = get("SITE_URL")?.replace(/\/+$/, "");
  return secretKey && priceMonthly && priceYearly && siteUrl ? { secretKey, priceMonthly, priceYearly, siteUrl } : null;
}

const LIVE = new Set(["active", "trialing", "past_due"]);

export function createBilling(deps: Deps) {
  const fetcher = deps.fetcher ?? fetch;
  return browserFunction(async (req) => {
    try {
      if (!await deps.billingEnabled()) return json(409, { error: "billing_disabled", message: "Billing is disabled on self-hosted installations." });
    } catch {
      return json(503, { error: "instance_settings_unavailable" });
    }
    const cfg = deps.config;
    if (!cfg) return json(503, { error: "billing_not_configured", message: "Billing is not configured yet." });
    const user = await deps.getUser(bearer(req));
    if (!user) return json(401, { error: "unauthorized" });
    const body = await readJson(req);
    const accountId = typeof body.account_id === "string" ? body.account_id : null;
    const account = await deps.ownerAccount(user.id, accountId);
    if (!account) return json(403, { error: "owner_only", message: "Only the account owner can manage billing." });

    const stripe = createStripeApi(cfg.secretKey, fetcher);
    const sessionUrl = async (path: string, params: Record<string, unknown>) => {
      const { url } = await stripe("POST", path, params);
      if (typeof url !== "string") throw new Error(`stripe ${path}: no url`);
      return url;
    };
    const returnUrl = `${cfg.siteUrl}/app/billing`;

    if (body.action === "checkout") {
      const interval = body.interval === "year" ? "year" : body.interval === "month" ? "month" : null;
      if (!interval) return json(400, { error: "interval must be month or year" });
      if (account.plan === "pro" || LIVE.has(account.subscription_status ?? "")) {
        return json(409, { error: "already_pro", message: "Already on Pro. Use the billing portal." });
      }
      let customer = account.stripe_customer_id;
      if (!customer) {
        // Idempotency key: two concurrent first checkouts get the same customer.
        const created = await stripe("POST", "customers", { email: user.email, metadata: { account_id: account.id } },
          `salebell-customer-${account.id}`);
        customer = await deps.setCustomer(account.id, String(created.id));
      }
      const url = await sessionUrl("checkout/sessions", {
        mode: "subscription",
        line_items: [{ price: interval === "year" ? cfg.priceYearly : cfg.priceMonthly, quantity: 1 }],
        client_reference_id: account.id,
        metadata: { account_id: account.id },
        subscription_data: { metadata: { account_id: account.id } },
        customer,
        customer_update: { name: "auto", address: "auto" },
        allow_promotion_codes: true,
        tax_id_collection: { enabled: true },
        billing_address_collection: "auto",
        success_url: `${returnUrl}?checkout=success`,
        cancel_url: `${returnUrl}?checkout=cancel`,
      });
      return json(200, { url });
    }
    if (body.action === "portal") {
      if (!account.stripe_customer_id) return json(409, { error: "no_customer", message: "No billing account yet. Upgrade first." });
      const url = await sessionUrl("billing_portal/sessions", { customer: account.stripe_customer_id, return_url: returnUrl });
      return json(200, { url });
    }
    return json(400, { error: "action must be checkout or portal" });
  }, deps.log);
}
