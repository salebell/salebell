// Stripe over plain fetch (no SDK): webhook signature verification, form encoding
// and the subscription -> plan mapping. Runtime-agnostic.
export const SIGNATURE_TOLERANCE_SEC = 300;
/** Pinned so response shapes (invoice.payment_intent, period end) don't drift with the account default. */
export const STRIPE_API_VERSION = "2024-06-20";
/** Statuses that keep Pro. past_due keeps access while Stripe retries the card. */
export const PRO_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);
export const planForStatus = (status: string): "pro" | "free" => PRO_STATUSES.has(status) ? "pro" : "free";

const hexToBytes = (hex: string) => /^([0-9a-f]{2})+$/i.test(hex) ? Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16)) : null;

/** Verifies a Stripe-Signature header (t=...,v1=...) against the raw body. Constant-time compare via WebCrypto. */
export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  { toleranceSec = SIGNATURE_TOLERANCE_SEC, now = Date.now() }: { toleranceSec?: number; now?: number } = {},
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isInteger(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${t}.${payload}`);
  for (const [k, v] of parts) {
    const sig = k === "v1" ? hexToBytes(v ?? "") : null;
    if (sig && await crypto.subtle.verify("HMAC", key, sig, data)) return true;
  }
  return false;
}

/** Encodes nested params the way Stripe expects: a[b][0][c]=v. */
export function stripeForm(params: Record<string, unknown>): URLSearchParams {
  const out = new URLSearchParams();
  const add = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => add(`${prefix}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) add(`${prefix}[${k}]`, v);
    else out.append(prefix, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out;
}

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type StripeApi = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  params?: Record<string, unknown>,
  idempotencyKey?: string,
) => Promise<Record<string, unknown>>;

/** Minimal Stripe REST client: form-encoded bodies, query params for GET, idempotency keys. */
export function createStripeApi(secretKey: string, fetcher: typeof fetch = fetch): StripeApi {
  return async (method, path, params, idempotencyKey) => {
    const form = stripeForm(params ?? {});
    const query = method === "GET" && params ? `?${form}` : "";
    const res = await fetcher(`https://api.stripe.com/v1/${path}${query}`, {
      method,
      headers: {
        authorization: `Bearer ${secretKey}`, "stripe-version": STRIPE_API_VERSION,
        ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: method === "POST" ? form : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) throw new StripeError(res.status, `stripe ${method} ${path.split("/")[0]} HTTP ${res.status}: ${data.error?.message ?? ""}`);
    return data;
  };
}

export type StripeInvoice = { id: string; amount_paid?: number; payment_intent?: string | { id: string } | null };
export type StripeSubscription = {
  id: string;
  customer: string | { id: string };
  status: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ current_period_end?: number; price?: { id: string } }> };
  latest_invoice?: string | StripeInvoice | null;
};
type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/** Which subscription an event is about, plus the account hint. null = event not relevant. */
export function subscriptionRef(event: StripeEvent): { subscriptionId: string; accountId: string | null } | null {
  const o = event.data?.object ?? {};
  const meta = (o.metadata ?? {}) as Record<string, string>;
  switch (event.type) {
    case "checkout.session.completed": {
      const sub = typeof o.subscription === "string" ? o.subscription : (o.subscription as { id?: string } | null)?.id;
      if (o.mode !== "subscription" || !sub) return null;
      return { subscriptionId: sub, accountId: (o.client_reference_id as string | null) ?? meta.account_id ?? null };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return typeof o.id === "string" ? { subscriptionId: o.id, accountId: meta.account_id ?? null } : null;
    default:
      return null;
  }
}

/** Fields written to accounts. Period end moved to subscription items in newer Stripe API versions. */
export function subscriptionState(sub: StripeSubscription) {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return {
    customer: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    subscription: sub.id,
    status: sub.status,
    plan: planForStatus(sub.status),
    periodEnd: end ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    priceIds: (sub.items?.data ?? []).map((i) => i.price?.id).filter((id): id is string => !!id),
    accountId: sub.metadata?.account_id ?? null,
  };
}
