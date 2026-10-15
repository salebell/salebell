import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGooglePush, normalizeGooglePlayNotification } from "../supabase/functions/_shared/core/google_play.ts";

const subscription = "projects/example/subscriptions/salebell";
const base = { version: "1.0", packageName: "com.example.timer", eventTimeMillis: "1791970000000" };
const sub = (notificationType = 4) => ({ ...base, subscriptionNotification: { version: "1.0", notificationType, purchaseToken: "private-token" } });
const push = (payload: unknown, messageId = "123456") => ({ subscription, message: { messageId, data: Buffer.from(JSON.stringify(payload)).toString("base64") } });
const purchase = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ productId: "premium", latestSuccessfulOrderId: "GPA.latest", autoRenewingPlan: { recurringPrice: { currencyCode: "USD", units: "9" } } }] };

test("decodes current RTDN subscription schema without requiring subscriptionId", () => {
  const message = parseGooglePush(push(sub()));
  assert.equal(message.notification.kind, "subscription");
  assert.equal(message.notification.packageName, "com.example.timer");
  assert.equal(message.messageId, "123456");
});

test("rejects malformed envelopes, base64, timestamps and ambiguous notification variants", () => {
  for (const input of [null, [], {}, { message: {} }, { ...push(sub()), subscription: "bad" },
    { ...push(sub()), message: { messageId: "123", data: "%%%" } },
    push({ ...sub(), eventTimeMillis: "NaN" }), push({ ...sub(), eventTimeMillis: "9999999999999999" }),
    push({ ...sub(), testNotification: { version: "1.0" } }),
    push({ ...base, subscriptionNotification: { version: "1.0", notificationType: 4 } }),
    push({ ...base, subscriptionNotification: { version: "1.0", notificationType: "4", purchaseToken: "token" } }),
    push({ ...base, packageName: "not a package", testNotification: { version: "1.0" } }),
  ]) assert.throws(() => parseGooglePush(input));
});

test("delivery UUIDs deduplicate messages and remain scoped to the subscription", async () => {
  const message = parseGooglePush(push(sub()));
  const first = await normalizeGooglePlayNotification(message, purchase);
  const replay = await normalizeGooglePlayNotification(message, { ...purchase, latestOrderId: "newer" });
  const otherMessage = await normalizeGooglePlayNotification(parseGooglePush(push(sub(), "123457")), purchase);
  const otherSubscription = await normalizeGooglePlayNotification({ ...message, subscription: "projects/other/subscriptions/salebell" }, purchase);
  assert.match(first.event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.event.id, replay.event.id);
  assert.notEqual(first.event.id, otherMessage.event.id);
  assert.notEqual(first.event.id, otherSubscription.event.id);
});

test("subscription events have unknown revenue and do not attribute today's order to an older RTDN", async () => {
  const { event, notification } = await normalizeGooglePlayNotification(parseGooglePush(push(sub())), purchase);
  assert.equal(event.type, "purchase");
  assert.equal(event.store, "play_store");
  assert.equal(event.productId, "premium");
  assert.equal(event.revenue, null);
  assert.equal(event.currency, null);
  assert.equal(event.transactionId, null);
  assert.match(event.originalTransactionId!, /^google-play:[0-9a-f]{64}$/);
  assert.equal(event.storefront, null, "Google regionCode is not an alpha-3 storefront");
  assert.ok(!JSON.stringify({ event, notification }).includes("private-token"));
  assert.ok(!JSON.stringify(notification).includes("recurringPrice"));
});

test("normalizes subscription lifecycle and preserves unknown types", async () => {
  for (const [raw, type] of [[1, "other"], [2, "renewal"], [3, "cancellation"], [5, "billing_issue"], [6, "billing_issue"], [7, "uncancellation"], [9, "renewal_extended"], [12, "revoked"], [13, "expired"], [17, "product_change"], [18, "cancellation"], [19, "other"], [999, "other"]] as const) {
    const { event } = await normalizeGooglePlayNotification(parseGooglePush(push(sub(raw))), purchase);
    assert.equal(event.type, type, `subscription type ${raw}`);
    assert.equal(event.rawType, `SUBSCRIPTION_${raw}`);
  }
});

test("test purchases derive Sandbox from Google lookup and multi-line subscriptions stay unambiguous", async () => {
  const { event } = await normalizeGooglePlayNotification(parseGooglePush(push(sub())), { ...purchase, testPurchase: {}, lineItems: [{ productId: "a" }, { productId: "b" }] });
  assert.equal(event.environment, "Sandbox");
  assert.equal(event.productId, null);
  const pending = await normalizeGooglePlayNotification(parseGooglePush(push(sub())), { ...purchase, subscriptionState: "SUBSCRIPTION_STATE_PENDING" });
  assert.equal(pending.event.type, "other", "pending states must not count as purchases");
  await assert.rejects(normalizeGooglePlayNotification(parseGooglePush(push(sub())), {}));
});

test("one-time purchases validate SKU and paid state without inventing prices", async () => {
  const message = parseGooglePush(push({ ...base, oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "private-token", sku: "lifetime" } }));
  const product = { purchaseStateContext: { purchaseState: "PURCHASED" }, orderId: "GPA.product", productLineItem: [{ productId: "lifetime", productOfferDetails: { quantity: 2 } }], testPurchaseContext: { fopType: "TEST" } };
  const { event } = await normalizeGooglePlayNotification(message, product);
  assert.equal(event.type, "purchase");
  assert.equal(event.productId, "lifetime");
  assert.equal(event.transactionId, "GPA.product");
  assert.equal(event.environment, "Sandbox");
  assert.equal(event.revenue, null);
  const pending = await normalizeGooglePlayNotification(message, { ...product, purchaseStateContext: { purchaseState: "PENDING" } });
  assert.equal(pending.event.type, "other");
  await assert.rejects(normalizeGooglePlayNotification(message, { ...product, productLineItem: [{ productId: "wrong" }] }));
  const canceled = parseGooglePush(push({ ...base, oneTimeProductNotification: { version: "1.0", notificationType: 2, purchaseToken: "private-token", sku: "lifetime" } }));
  assert.equal((await normalizeGooglePlayNotification(canceled, product)).event.type, "other", "canceled pending purchases are not refunds");
});

test("voided purchases preserve refund kind and order while keeping refund amount unknown", async () => {
  const message = parseGooglePush(push({ ...base, voidedPurchaseNotification: { purchaseToken: "private-token", orderId: "GPA.refunded", productType: 1, refundType: 2 } }));
  const { event, notification } = await normalizeGooglePlayNotification(message, purchase);
  assert.equal(event.type, "refund");
  assert.equal(event.transactionId, "GPA.refunded");
  assert.equal(event.revenue, null);
  assert.equal(notification.refundType, 2);
});

test("delivery tests and pending refund reviews do not count purchases or execute refunds", async () => {
  const { event } = await normalizeGooglePlayNotification(parseGooglePush(push({ ...base, testNotification: { version: "1.0" } })), null);
  assert.equal(event.type, "test");
  assert.equal(event.revenue, null);
  const review = await normalizeGooglePlayNotification(parseGooglePush(push({ ...base, pendingRefundReviewNotification: { version: "1.0", pendingRefundToken: "secret-review-token", orderId: "GPA.review", refundReason: 7 } })), null);
  assert.equal(review.event.type, "other");
  assert.equal(review.event.rawType, "PENDING_REFUND_REVIEW");
  assert.ok(!JSON.stringify(review).includes("secret-review-token"));
});
