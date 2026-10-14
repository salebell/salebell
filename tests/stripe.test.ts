import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createStripeApi, stripeForm, subscriptionState, verifyStripeSignature } from "../supabase/functions/_shared/core/stripe.ts";
import type { StripeSubscription } from "../supabase/functions/_shared/core/stripe.ts";
import { type ApplyInput, createCancelDuplicate, createStripeWebhook } from "../supabase/functions/stripe-webhook/handler.ts";
import { createBilling, type OwnerAccount } from "../supabase/functions/billing/handler.ts";
import { silent } from "./helpers.ts";

const SECRET = "whsec_test_secret";
const T = 1_791_500_000;
const sign = (body: string, t = T, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")},v0=deadbeef`;

test("verifies Stripe signatures with a timestamp tolerance", async () => {
  const body = '{"id":"evt_1"}';
  const now = T * 1000;
  assert.equal(await verifyStripeSignature(body, sign(body), SECRET, { now }), true);
  assert.equal(await verifyStripeSignature(body, `t=${T},v1=00,${sign(body).split(",")[1]}`, SECRET, { now }), true, "any v1 may match (secret rotation)");
  assert.equal(await verifyStripeSignature(body + " ", sign(body), SECRET, { now }), false, "body tampering");
  assert.equal(await verifyStripeSignature(body, sign(body, T, "whsec_other"), SECRET, { now }), false, "wrong secret");
  assert.equal(await verifyStripeSignature(body, sign(body), SECRET, { now: now + 301_000 }), false, "too old");
  assert.equal(await verifyStripeSignature(body, sign(body), SECRET, { now: now - 301_000 }), false, "from the future");
  assert.equal(await verifyStripeSignature(body, `t=${T},v0=${sign(body).split("v1=")[1]}`, SECRET, { now }), false, "v0 ignored");
  assert.equal(await verifyStripeSignature(body, null, SECRET, { now }), false);
  assert.equal(await verifyStripeSignature(body, "garbage", SECRET, { now }), false);
});

test("encodes nested Stripe form params", () => {
  const f = stripeForm({ mode: "subscription", line_items: [{ price: "price_1", quantity: 1 }], tax_id_collection: { enabled: true }, skip: undefined });
  assert.equal(f.toString(), "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&tax_id_collection%5Benabled%5D=true");
});

test("reads period end from the subscription or, on newer API versions, its items", () => {
  const base = { id: "sub_1", customer: "cus_1", status: "active" };
  assert.equal(subscriptionState({ ...base, current_period_end: T }).periodEnd, new Date(T * 1000).toISOString());
  assert.equal(subscriptionState({ ...base, customer: { id: "cus_1" }, items: { data: [{ current_period_end: T }] } }).periodEnd,
    new Date(T * 1000).toISOString());
  assert.equal(subscriptionState({ ...base, status: "unpaid" }).plan, "free");
  assert.equal(subscriptionState({ ...base, status: "past_due" }).plan, "pro");
});

// ---------- stripe-webhook state machine ----------

type Account = {
  id: string; plan: string; customer: string | null; subscription: string | null; status: string | null; periodEnd: string | null;
  cancelAtPeriodEnd?: boolean;
};
const PRICES = new Set(["price_m", "price_y"]);
const items = (price = "price_m") => ({ data: [{ price: { id: price } }] });

/** In-memory twin of public.apply_stripe_subscription (the SQL tests cover the real one). */
function fakeDb(accounts: Account[]) {
  return async (s: ApplyInput): Promise<string> => {
    const a = accounts.find((x) => x.id === s.accountId) ?? accounts.find((x) => x.customer === s.customer);
    if (!a) return "no_account";
    const pro = ["active", "trialing", "past_due"].includes(s.status);
    if (a.subscription && a.subscription !== s.subscription) {
      if (["active", "trialing"].includes(a.status ?? "")) return pro ? "duplicate" : "ignored";
      if (!pro) return "ignored";
    }
    Object.assign(a, {
      plan: pro ? "pro" : "free", customer: s.customer, subscription: s.subscription, status: s.status, periodEnd: s.periodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    });
    return a.plan;
  };
}

function stripeHarness(billingEnabled = async () => true) {
  const accounts: Account[] = [{ id: "acc-1", plan: "free", customer: null, subscription: null, status: null, periodEnd: null }];
  const subs = new Map<string, StripeSubscription>();
  const fetched: string[] = [];
  const cancelled: string[] = [];
  const handler = createStripeWebhook({
    billingEnabled,
    webhookSecret: SECRET,
    getSubscription: async (id) => { fetched.push(id); const s = subs.get(id); if (!s) throw new Error("404"); return s; },
    allowedPrices: PRICES,
    apply: fakeDb(accounts),
    cancelDuplicate: async (sub) => { cancelled.push(sub.id); subs.set(sub.id, { ...sub, status: "canceled" }); },
    now: () => T * 1000,
    log: silent,
  });
  const deliver = (type: string, object: Record<string, unknown>, id = `evt_${Math.random()}`) => {
    const body = JSON.stringify({ id, type, data: { object } });
    return handler(new Request("https://x/functions/v1/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": sign(body) } }));
  };
  return { accounts, subs, fetched, cancelled, handler, deliver };
}

test("checkout -> pro, renewal update, cancellation -> free; replays are idempotent", async () => {
  const h = stripeHarness();
  h.subs.set("sub_1", { id: "sub_1", customer: "cus_1", status: "active", current_period_end: T + 2_592_000, metadata: { account_id: "acc-1" }, items: items() });

  const done = await h.deliver("checkout.session.completed", { mode: "subscription", client_reference_id: "acc-1", customer: "cus_1", subscription: "sub_1" }, "evt_A");
  assert.equal(done.status, 200);
  assert.equal((await done.json()).outcome, "pro");
  assert.deepEqual(h.accounts[0], {
    id: "acc-1", plan: "pro", customer: "cus_1", subscription: "sub_1", status: "active",
    periodEnd: new Date((T + 2_592_000) * 1000).toISOString(), cancelAtPeriodEnd: false,
  });

  const snapshot = structuredClone(h.accounts);
  await h.deliver("checkout.session.completed", { mode: "subscription", client_reference_id: "acc-1", customer: "cus_1", subscription: "sub_1" }, "evt_A");
  await h.deliver("customer.subscription.created", { id: "sub_1", customer: "cus_1", metadata: { account_id: "acc-1" } });
  assert.deepEqual(h.accounts, snapshot, "replayed and late events converge on the same state");

  h.subs.set("sub_1", { ...h.subs.get("sub_1")!, cancel_at_period_end: true });
  await h.deliver("customer.subscription.updated", { id: "sub_1", customer: "cus_1" });
  assert.deepEqual([h.accounts[0].plan, h.accounts[0].cancelAtPeriodEnd], ["pro", true], "cancellation scheduled, still Pro");

  h.subs.set("sub_1", { ...h.subs.get("sub_1")!, status: "canceled" });
  // A stale "updated" event arriving after cancellation still applies the latest state (re-fetched).
  await h.deliver("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active" });
  assert.equal(h.accounts[0].plan, "free");
  await h.deliver("customer.subscription.deleted", { id: "sub_1", customer: "cus_1", status: "canceled" });
  assert.deepEqual([h.accounts[0].plan, h.accounts[0].status, h.accounts[0].customer], ["free", "canceled", "cus_1"]);
});

test("customer lookup works without metadata; old subscriptions cannot downgrade", async () => {
  const h = stripeHarness();
  h.subs.set("sub_new", { id: "sub_new", customer: "cus_1", status: "active", items: items() });
  h.subs.set("sub_old", { id: "sub_old", customer: "cus_1", status: "canceled", items: items() });
  await h.deliver("checkout.session.completed", { mode: "subscription", client_reference_id: "acc-1", subscription: "sub_new" });
  const r = await h.deliver("customer.subscription.deleted", { id: "sub_old", customer: "cus_1" });
  assert.equal((await r.json()).outcome, "ignored");
  assert.equal(h.accounts[0].plan, "pro");
});

test("rejects bad signatures, ignores irrelevant events, retries on failures", async () => {
  const h = stripeHarness();
  const body = JSON.stringify({ id: "evt_x", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
  const forged = await h.handler(new Request("https://x", { method: "POST", body, headers: { "stripe-signature": sign(body, T, "whsec_attacker") } }));
  assert.equal(forged.status, 400);
  assert.equal(h.fetched.length, 0);

  assert.equal((await (await h.deliver("invoice.paid", { id: "in_1" })).json()).ignored, "invoice.paid");
  assert.equal((await (await h.deliver("checkout.session.completed", { mode: "payment", subscription: null })).json()).ignored,
    "checkout.session.completed", "one-off payments are not subscriptions");

  const failing = await h.deliver("customer.subscription.updated", { id: "sub_missing", customer: "cus_9" });
  assert.equal(failing.status, 500, "Stripe retries when the subscription cannot be read");

  const unconfigured = createStripeWebhook({
    billingEnabled: async () => true,
    webhookSecret: null, getSubscription: null, allowedPrices: null, apply: fakeDb([]), cancelDuplicate: async () => {}, log: silent,
  });
  assert.equal((await unconfigured(new Request("https://x", { method: "POST", body: "{}" }))).status, 503);
  const noPrices = createStripeWebhook({
    billingEnabled: async () => true,
    webhookSecret: SECRET, getSubscription: async () => { throw new Error(); }, allowedPrices: new Set(), apply: fakeDb([]),
    cancelDuplicate: async () => {}, log: silent,
  });
  assert.equal((await noPrices(new Request("https://x", { method: "POST", body: "{}" }))).status, 503, "prices are required");
});

test("subscriptions to other prices never change the plan", async () => {
  const h = stripeHarness();
  h.subs.set("sub_x", { id: "sub_x", customer: "cus_1", status: "active", metadata: { account_id: "acc-1" }, items: items("price_other") });
  h.subs.set("sub_mixed", { id: "sub_mixed", customer: "cus_1", status: "active", metadata: { account_id: "acc-1" }, items: { data: [...items().data, ...items("price_other").data] } });
  for (const id of ["sub_x", "sub_mixed"]) {
    const r = await h.deliver("customer.subscription.created", { id, metadata: { account_id: "acc-1" } });
    assert.deepEqual([r.status, (await r.json()).outcome], [200, "foreign_price"]);
  }
  assert.equal(h.accounts[0].plan, "free");
});

test("a second live subscription is refunded and cancelled; the first one stays", async () => {
  const h = stripeHarness();
  h.subs.set("sub_1", { id: "sub_1", customer: "cus_1", status: "active", metadata: { account_id: "acc-1" }, items: items() });
  h.subs.set("sub_2", { id: "sub_2", customer: "cus_1", status: "active", metadata: { account_id: "acc-1" }, items: items("price_y") });
  await h.deliver("customer.subscription.created", { id: "sub_1" });
  const dup = await h.deliver("checkout.session.completed", { mode: "subscription", client_reference_id: "acc-1", subscription: "sub_2" });
  assert.deepEqual([dup.status, (await dup.json()).outcome], [200, "duplicate"]);
  assert.deepEqual(h.cancelled, ["sub_2"]);
  assert.deepEqual([h.accounts[0].subscription, h.accounts[0].plan], ["sub_1", "pro"]);
  // Its own deletion event afterwards is ignored.
  assert.equal((await (await h.deliver("customer.subscription.deleted", { id: "sub_2" })).json()).outcome, "ignored");
  assert.deepEqual([h.accounts[0].subscription, h.accounts[0].plan], ["sub_1", "pro"]);
});

test("a failed duplicate cancellation returns 500 so Stripe retries", async () => {
  const accounts: Account[] = [{ id: "acc-1", plan: "pro", customer: "cus_1", subscription: "sub_1", status: "active", periodEnd: null }];
  const handler = createStripeWebhook({
    billingEnabled: async () => true,
    webhookSecret: SECRET,
    getSubscription: async (id) => ({ id, customer: "cus_1", status: "active", metadata: { account_id: "acc-1" }, items: items() }),
    allowedPrices: PRICES,
    apply: fakeDb(accounts),
    cancelDuplicate: async () => { throw new Error("stripe down"); },
    now: () => T * 1000,
    log: silent,
  });
  const body = JSON.stringify({ id: "evt_d", type: "customer.subscription.created", data: { object: { id: "sub_2" } } });
  const r = await handler(new Request("https://x", { method: "POST", body, headers: { "stripe-signature": sign(body) } }));
  assert.equal(r.status, 500);
});

function fakeStripe(responses: Record<string, unknown> = {}) {
  const calls: { method: string; url: string; body: string; key: string | null; version: string | null }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({
      method: init.method!, url, body: String(init.body ?? ""),
      key: new Headers(init.headers).get("idempotency-key"), version: new Headers(init.headers).get("stripe-version"),
    });
    const path = new URL(url).pathname.replace("/v1/", "");
    return Response.json(responses[`${init.method} ${path}`] ?? { id: "x", url: `https://checkout.stripe.com/c/${calls.length}` });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("duplicate cancellation refunds the paid invoice, then cancels, with idempotency keys", async () => {
  const s = fakeStripe({ "GET invoices/in_2": { id: "in_2", amount_paid: 7900, payment_intent: "pi_2" } });
  await createCancelDuplicate(createStripeApi("sk_test", s.fetcher))({ id: "sub_2", customer: "cus_1", status: "active", latest_invoice: "in_2" });
  assert.deepEqual(s.calls.map((c) => [c.method, new URL(c.url).pathname, c.key]), [
    ["GET", "/v1/invoices/in_2", null],
    ["POST", "/v1/refunds", "salebell-duplicate-refund-sub_2"],
    ["DELETE", "/v1/subscriptions/sub_2", "salebell-duplicate-cancel-sub_2"],
  ]);
  assert.equal(new URLSearchParams(s.calls[1].body).get("payment_intent"), "pi_2");
  assert.equal(new URLSearchParams(s.calls[1].body).get("reason"), "duplicate");
  assert.ok(s.calls.every((c) => c.version === "2024-06-20"));

  // Expanded invoice with nothing paid (100% coupon or trial): cancel only.
  const free = fakeStripe();
  await createCancelDuplicate(createStripeApi("sk_test", free.fetcher))({
    id: "sub_3", customer: "cus_1", status: "trialing", latest_invoice: { id: "in_3", amount_paid: 0, payment_intent: null },
  });
  assert.deepEqual(free.calls.map((c) => c.method), ["DELETE"]);

  const failing = createStripeApi("sk_test", (async () => Response.json({ error: { message: "nope" } }, { status: 402 })) as unknown as typeof fetch);
  await assert.rejects(createCancelDuplicate(failing)({ id: "sub_4", customer: "c", status: "active", latest_invoice: { id: "i", amount_paid: 1, payment_intent: "pi" } }));
});

// ---------- billing ----------

function billingHarness(account: Partial<OwnerAccount> | null = {}, billingEnabled = async () => true) {
  const stripeCalls: { url: string; body: URLSearchParams; key: string | null }[] = [];
  const stored: [string, string][] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    stripeCalls.push({ url, body: init.body as URLSearchParams, key: new Headers(init.headers).get("idempotency-key") });
    if (url.endsWith("/customers")) return Response.json({ id: "cus_new" });
    return Response.json({ url: `https://checkout.stripe.com/c/${stripeCalls.length}` });
  }) as unknown as typeof fetch;
  const handler = createBilling({
    billingEnabled,
    config: { secretKey: "sk_test_x", priceMonthly: "price_m", priceYearly: "price_y", siteUrl: "https://salebell.vercel.app" },
    getUser: async (jwt) => (jwt === "good" ? { id: "user-1", email: "dev@example.com" } : null),
    ownerAccount: async () => account === null ? null : {
      id: "acc-1", name: "My workspace", plan: "free", stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null, ...account,
    },
    setCustomer: async (a, c) => { stored.push([a, c]); return c; },
    fetcher,
    log: silent,
  });
  const call = (body: unknown, jwt = "good") => handler(new Request("https://x/functions/v1/billing", {
    method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
  }));
  return { stripeCalls, stored, call, handler };
}

test("checkout session: price by interval, promo codes, tax IDs, account reference, return URLs", async () => {
  const h = billingHarness();
  const res = await h.call({ action: "checkout", interval: "year" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, "https://checkout.stripe.com/c/2");
  const [cust, c] = h.stripeCalls;
  assert.equal(cust.url, "https://api.stripe.com/v1/customers", "customer created before the first checkout");
  assert.equal(cust.key, "salebell-customer-acc-1");
  assert.deepEqual([cust.body.get("email"), cust.body.get("metadata[account_id]")], ["dev@example.com", "acc-1"]);
  assert.deepEqual(h.stored, [["acc-1", "cus_new"]]);
  assert.equal(c.url, "https://api.stripe.com/v1/checkout/sessions");
  const p = Object.fromEntries(c.body);
  assert.equal(p.mode, "subscription");
  assert.equal(p["line_items[0][price]"], "price_y");
  assert.equal(p.allow_promotion_codes, "true");
  assert.equal(p["tax_id_collection[enabled]"], "true");
  assert.equal(p.client_reference_id, "acc-1");
  assert.equal(p["subscription_data[metadata][account_id]"], "acc-1");
  assert.deepEqual([p.customer, p.customer_email], ["cus_new", undefined]);
  assert.equal(p.success_url, "https://salebell.vercel.app/app/billing?checkout=success");
  assert.equal(p.cancel_url, "https://salebell.vercel.app/app/billing?checkout=cancel");

  const existing = billingHarness({ stripe_customer_id: "cus_1", subscription_status: "canceled" });
  await existing.call({ action: "checkout", interval: "month" });
  assert.equal(existing.stripeCalls.length, 1, "existing customer reused");
  const q = Object.fromEntries(existing.stripeCalls[0].body);
  assert.deepEqual([q.customer, q.customer_email, q["customer_update[name]"], q["line_items[0][price]"]], ["cus_1", undefined, "auto", "price_m"]);
});

test("portal, owner-only, and error cases", async () => {
  const pro = billingHarness({ plan: "pro", stripe_customer_id: "cus_1" });
  const portal = await pro.call({ action: "portal" });
  assert.equal(portal.status, 200);
  assert.equal(pro.stripeCalls[0].url, "https://api.stripe.com/v1/billing_portal/sessions");
  assert.equal(Object.fromEntries(pro.stripeCalls[0].body).return_url, "https://salebell.vercel.app/app/billing");
  assert.equal((await pro.call({ action: "checkout", interval: "month" })).status, 409, "no second subscription");
  for (const status of ["active", "trialing"]) {
    const live = billingHarness({ plan: "free", stripe_customer_id: "cus_1", subscription_status: status });
    assert.equal((await live.call({ action: "checkout", interval: "month" })).status, 409, `blocked while ${status}`);
    assert.equal(live.stripeCalls.length, 0);
  }

  assert.equal((await billingHarness().call({ action: "portal" })).status, 409, "no customer yet");
  assert.equal((await billingHarness(null).call({ action: "checkout", interval: "month" })).status, 403, "members cannot bill");
  assert.equal((await billingHarness().call({ action: "checkout", interval: "week" })).status, 400);
  assert.equal((await billingHarness().call({ action: "checkout" }, "bad")).status, 401);
  const pre = await billingHarness().handler(new Request("https://x", { method: "OPTIONS" }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");

  const off = createBilling({ billingEnabled: async () => true, config: null, getUser: async () => null, ownerAccount: async () => null, setCustomer: async (_, c) => c, log: silent });
  const r = await off(new Request("https://x", { method: "POST", body: "{}" }));
  assert.deepEqual([r.status, (await r.json()).error], [503, "billing_not_configured"]);
});

test("self-hosted checkout and portal never contact Stripe even when credentials are configured", async () => {
  const h = billingHarness({ stripe_customer_id: "cus_imported" }, async () => false);
  for (const action of ["checkout", "portal"]) {
    const res = await h.call({ action, interval: "month" });
    assert.deepEqual([res.status, (await res.json()).error], [409, "billing_disabled"]);
  }
  assert.equal(h.stripeCalls.length, 0);
  assert.equal(h.stored.length, 0);
});

test("self-hosted Stripe webhook acknowledges events without changing imported subscription records", async () => {
  const h = stripeHarness(async () => false);
  const before = structuredClone(h.accounts);
  const res = await h.deliver("customer.subscription.updated", { id: "sub_imported" });
  assert.deepEqual([res.status, await res.json()], [200, { received: true, ignored: "billing_disabled" }]);
  assert.deepEqual(h.accounts, before);
  assert.deepEqual(h.fetched, []);
  assert.deepEqual(h.cancelled, []);
});

test("billing endpoints fail closed when the instance settings cannot be loaded", async () => {
  const unavailable = async () => { throw new Error("database unavailable"); };
  const billing = billingHarness({}, unavailable);
  const res = await billing.call({ action: "checkout", interval: "year" });
  assert.deepEqual([res.status, (await res.json()).error], [503, "instance_settings_unavailable"]);
  assert.equal(billing.stripeCalls.length, 0);

  const webhook = stripeHarness(unavailable);
  const event = await webhook.deliver("customer.subscription.created", { id: "sub_imported" });
  assert.deepEqual([event.status, (await event.json()).error], [503, "instance_settings_unavailable"]);
  assert.deepEqual(webhook.fetched, []);
});
