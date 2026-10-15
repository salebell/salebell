import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichGoogleOrder, googleMoneyMilliunits } from "../supabase/functions/_shared/core/google_orders.ts";
import { normalizeGooglePlayNotification, parseGooglePush } from "../supabase/functions/_shared/core/google_play.ts";

const time = Date.parse("2026-10-15T12:00:00Z");
const money = (units = "9", nanos = 990000000, currencyCode = "USD") => ({ units, nanos, currencyCode });
const purchase = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ productId: "premium", latestSuccessfulOrderId: "GPA.1" }] };
const order = (over = {}) => ({ orderId: "GPA.1", purchaseToken: "private-token", state: "PROCESSED", total: money(),
  lineItems: [{ productId: "premium", subscriptionDetails: { offerPhaseDetails: { baseDetails: {} } } }],
  orderHistory: { processedEvent: { eventTime: new Date(time - 1000).toISOString() } }, ...over });
async function run(type = 4, response = order(), p: Record<string, unknown> | null = purchase, voided = false) {
  const notification = voided ? { voidedPurchaseNotification: { orderId: "GPA.1", purchaseToken: "private-token", productType: 1, refundType: 2 } }
    : { subscriptionNotification: { version: "1.0", notificationType: type, purchaseToken: "private-token" } };
  const message = parseGooglePush({ subscription: "projects/example/subscriptions/salebell", message: { messageId: "123", data: Buffer.from(JSON.stringify({ version: "1.0", packageName: "com.example", eventTimeMillis: String(time), ...notification })).toString("base64") } });
  const normalized = await normalizeGooglePlayNotification(message, p, p ? undefined : "Production");
  const calls: string[] = [];
  await enrichGoogleOrder(message, p, normalized, async id => { calls.push(id); return response; });
  return { ...normalized, calls };
}

test("Google Money uses exact milliunit rounding, including zero and non-USD currencies", () => {
  assert.equal(googleMoneyMilliunits(money()), 9990);
  assert.equal(googleMoneyMilliunits({ currencyCode: "JPY", units: "600" }), 600000);
  assert.equal(googleMoneyMilliunits({ currencyCode: "USD" }), 0);
  assert.equal(googleMoneyMilliunits(money("0", 123500000)), 124);
  for (const invalid of [money("-1"), money("1.2"), money("0", -1), money("0", 1e9), money("1", 0, "bad"), money("999999999999"), {}, null]) {
    assert.throws(() => googleMoneyMilliunits(invalid));
  }
});

test("purchases and renewals display verified order totals and allowlist metadata", async () => {
  for (const type of [4, 2]) {
    const result = await run(type, order({ buyerAddress: { buyerPostcode: "PRIVATE_POSTCODE" }, developerRevenueInBuyerCurrency: money("7", 0) }));
    assert.equal(result.event.revenue, 9.99);
    assert.equal(result.event.currency, "USD");
    assert.equal(result.event.transactionId, "GPA.1");
    assert.deepEqual(result.calls, ["GPA.1"]);
    assert.deepEqual(result.notification.order, { source: "orders.get", orderId: "GPA.1", currency: "USD", chargedAmount: 9.99, refundedAmount: 0,
      processedAt: new Date(time - 1000).toISOString() });
    assert.ok(!JSON.stringify(result).includes("private-token"));
    assert.ok(!JSON.stringify(result).includes("PRIVATE_POSTCODE"));
  }
});

test("nonfinancial lifecycle notifications skip order lookup", async () => {
  for (const type of [1, 3, 5, 7, 9, 12, 13, 17]) {
    const result = await run(type);
    assert.equal(result.event.revenue, null);
    assert.deepEqual(result.calls, []);
  }
});

test("an older subscription notification cannot claim a newer renewal order", async () => {
  const result = await run(2, order({ orderHistory: { processedEvent: { eventTime: new Date(time + 1000).toISOString() } } }));
  assert.equal(result.event.revenue, null);
  assert.equal(result.event.transactionId, null);
  assert.equal(result.notification.priceUnavailable, "newer_order");
});

test("order identity, token, product, money and processed state must be authoritative", async () => {
  for (const over of [{ orderId: "GPA.wrong" }, { purchaseToken: "wrong" }, { lineItems: [{ productId: "wrong" }] },
    { total: money("1", 1e9) }, { state: "PENDING" }, { orderHistory: {} }]) {
    await assert.rejects(run(4, order(over)));
  }
});

test("free trials carry a verified zero price and trial classification", async () => {
  const result = await run(4, order({ total: money("0", 0), lineItems: [{ productId: "premium", subscriptionDetails: { offerPhaseDetails: { freeTrialDetails: {} } } }] }));
  assert.equal(result.event.revenue, 0);
  assert.equal(result.event.type, "trial_started");
  assert.equal(result.event.isTrial, true);
});

test("partial refunds use only completed refund history through the notification time", async () => {
  const result = await run(4, order({ state: "PARTIALLY_REFUNDED", orderHistory: {
    processedEvent: { eventTime: new Date(time - 1000).toISOString() },
    partialRefundEvents: [
      { state: "PROCESSED_SUCCESSFULLY", processTime: new Date(time).toISOString(), refundDetails: { total: money("2", 0) } },
      { state: "PENDING", processTime: new Date(time).toISOString(), refundDetails: { total: money("1", 0) } },
      { state: "PROCESSED_SUCCESSFULLY", processTime: new Date(time + 1000).toISOString(), refundDetails: { total: money("3", 0) } },
    ],
  } }), purchase, true);
  assert.equal(result.event.revenue, -2);
  assert.equal((result.notification.order as any).refundedAmount, 2);
});

test("full refunds use exact history, including after purchase-token expiry", async () => {
  const result = await run(4, order({ state: "REFUNDED", orderHistory: {
    processedEvent: { eventTime: new Date(time - 1000).toISOString() },
    refundEvent: { eventTime: new Date(time).toISOString(), refundDetails: { total: money() } },
  } }), null, true);
  assert.equal(result.event.revenue, -9.99);
  assert.equal(result.event.productId, "premium");
  await assert.rejects(run(4, order(), purchase, true), "refund history must be available before acknowledging");
});

test("a full refund after partial refunds never exceeds the amount paid", async () => {
  for (const remaining of [money("7", 990000000), money()]) {
    const result = await run(4, order({ state: "REFUNDED", orderHistory: {
      processedEvent: { eventTime: new Date(time - 1000).toISOString() },
      partialRefundEvents: [{ state: "PROCESSED_SUCCESSFULLY", processTime: new Date(time - 500).toISOString(), refundDetails: { total: money("2", 0) } }],
      refundEvent: { eventTime: new Date(time).toISOString(), refundDetails: { total: remaining } },
    } }), purchase, true);
    assert.equal(result.event.revenue, -9.99);
  }
});

test("one-time products use charged quantity totals, not recurring or catalog prices", async () => {
  const message = parseGooglePush({ subscription: "projects/example/subscriptions/salebell", message: { messageId: "123", data: Buffer.from(JSON.stringify({
    version: "1.0", packageName: "com.example", eventTimeMillis: String(time),
    oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "private-token", sku: "premium" },
  })).toString("base64") } });
  const p = { orderId: "GPA.1", purchaseStateContext: { purchaseState: "PURCHASED" }, productLineItem: [{ productId: "premium", productOfferDetails: { quantity: 3 } }] };
  const normalized = await normalizeGooglePlayNotification(message, p);
  await enrichGoogleOrder(message, p, normalized, async () => order({ total: money("14", 970000000) }));
  assert.equal(normalized.event.revenue, 14.97);
});

test("zero-price trial refunds retain an authoritative zero rather than retrying forever", async () => {
  const result = await run(4, order({ state: "REFUNDED", total: money("0", 0), orderHistory: {
    processedEvent: { eventTime: new Date(time - 1000).toISOString() },
    refundEvent: { eventTime: new Date(time).toISOString(), refundDetails: { total: money("0", 0) } },
  } }), purchase, true);
  assert.equal(result.event.revenue, 0);
});

test("multi-item orders are fetched once; distinct latest orders are left unassigned", async () => {
  const p = { ...purchase, lineItems: [...purchase.lineItems, { productId: "addon", latestSuccessfulOrderId: "GPA.1" }] };
  const result = await run(2, order({ lineItems: [{ productId: "premium" }, { productId: "addon" }] }), p);
  assert.equal(result.event.revenue, 9.99);
  assert.equal(result.event.productId, null);
  assert.deepEqual(result.calls, ["GPA.1"]);
  const ambiguous = await run(2, order(), { ...p, lineItems: [...purchase.lineItems, { productId: "addon", latestSuccessfulOrderId: "GPA.2" }] });
  assert.deepEqual(ambiguous.calls, []);
  assert.equal(ambiguous.event.revenue, null);
});
