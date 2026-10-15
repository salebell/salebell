// Google RTDN decoding and normalization. Purchase tokens are used only for API
// lookups; stored events contain a one-way hash and an allowlisted API snapshot.
import type { StoreEnvironment, StoreEvent, StoreEventType } from "./events.ts";

type NotificationBase = { packageName: string; eventTimeMillis: number };
export type GoogleNotification = NotificationBase & (
  | { kind: "subscription"; notificationType: number; purchaseToken: string }
  | { kind: "product"; notificationType: number; purchaseToken: string; sku: string }
  | { kind: "voided"; purchaseToken: string; orderId: string; productType: 1 | 2; refundType: number }
  | { kind: "refund_review"; orderId: string; refundReason: number }
  | { kind: "test" }
);
export type GooglePushMessage = { messageId: string; subscription: string; notification: GoogleNotification };
export class GooglePayloadError extends Error {
  constructor() { super("invalid_google_payload"); }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown, max = 4096): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const invalid = (): never => { throw new GooglePayloadError(); };

export function parseGooglePush(value: unknown): GooglePushMessage {
  const envelope = object(value);
  const message = object(envelope?.message);
  if (!string(envelope?.subscription, 512) || !/^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/.test(envelope.subscription) ||
    !string(message?.messageId, 200) || !string(message?.data, 128 * 1024) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) return invalid();
  let body: Record<string, unknown> | null;
  try {
    const bytes = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
    body = object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch { return invalid(); }
  if (!body || !string(body.version, 32) || !string(body.packageName, 255) ||
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(body.packageName)) return invalid();
  const rawTime = body.eventTimeMillis;
  if (typeof rawTime !== "number" && (typeof rawTime !== "string" || !/^\d{1,16}$/.test(rawTime))) return invalid();
  const eventTimeMillis = Number(rawTime);
  if (!Number.isSafeInteger(eventTimeMillis) || eventTimeMillis < 0 || !Number.isFinite(new Date(eventTimeMillis).getTime())) return invalid();
  const variants = ["subscriptionNotification", "oneTimeProductNotification", "voidedPurchaseNotification", "pendingRefundReviewNotification", "testNotification"];
  const present = variants.filter(key => Object.hasOwn(body!, key));
  if (present.length !== 1) return invalid();
  const data = object(body[present[0]]);
  if (!data) return invalid();
  const base = { packageName: body.packageName, eventTimeMillis };
  let notification: GoogleNotification;
  switch (present[0]) {
    case "subscriptionNotification":
    case "oneTimeProductNotification": {
      if (!string(data.version, 32) || !integer(data.notificationType) || !string(data.purchaseToken)) return invalid();
      if (present[0] === "oneTimeProductNotification") {
        if (!string(data.sku, 255)) return invalid();
        notification = { ...base, kind: "product", notificationType: data.notificationType, purchaseToken: data.purchaseToken, sku: data.sku };
      } else notification = { ...base, kind: "subscription", notificationType: data.notificationType, purchaseToken: data.purchaseToken };
      break;
    }
    case "voidedPurchaseNotification":
      if (!string(data.purchaseToken) || !string(data.orderId, 255) || ![1, 2].includes(data.productType as number) || !integer(data.refundType)) return invalid();
      notification = { ...base, kind: "voided", purchaseToken: data.purchaseToken, orderId: data.orderId, productType: data.productType as 1 | 2, refundType: data.refundType };
      break;
    case "pendingRefundReviewNotification":
      if (!string(data.version, 32) || !string(data.pendingRefundToken) || !string(data.orderId, 255) || !integer(data.refundReason)) return invalid();
      notification = { ...base, kind: "refund_review", orderId: data.orderId, refundReason: data.refundReason };
      break;
    default:
      if (!string(data.version, 32)) return invalid();
      notification = { ...base, kind: "test" };
  }
  return { messageId: message.messageId, subscription: envelope.subscription, notification };
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
export const googlePurchaseTokenHash = async (token: string): Promise<string> => hex(await digest(token));

/** SHA-256-based UUIDv8, scoped to Pub/Sub subscription and message id. */
export async function googleDeliveryId(subscription: string, messageId: string): Promise<string> {
  const bytes = (await digest(JSON.stringify(["google-play-rtdn", subscription, messageId]))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const SUBSCRIPTION_TYPES: Readonly<Record<number, StoreEventType>> = {
  // RECOVERED (1) also means resumed from pause, so it proves no payment.
  2: "renewal", 3: "cancellation", 4: "purchase", 5: "billing_issue", 6: "billing_issue",
  7: "uncancellation", 8: "price_increase", 9: "renewal_extended", 12: "revoked", 13: "expired",
  // PRICE_CHANGE_UPDATED (19) also covers decreases/canceled changes.
  17: "product_change", 18: "cancellation", 22: "price_increase",
};

export async function normalizeGooglePlayNotification(
  message: GooglePushMessage, purchase: Record<string, unknown> | null, previousEnvironment?: StoreEnvironment,
): Promise<{ event: StoreEvent; notification: Record<string, unknown> }> {
  const n = message.notification;
  const isSubscription = n.kind === "subscription" || (n.kind === "voided" && n.productType === 1);
  let type: StoreEventType = "other", rawType: string, productId: string | null = null, orderId: string | null = null;
  let isTest = false;
  const notification: Record<string, unknown> = {
    messageId: message.messageId, subscription: message.subscription, kind: n.kind,
    packageName: n.packageName, eventTimeMillis: n.eventTimeMillis,
  };
  if ("purchaseToken" in n) {
    notification.purchaseTokenHash = await googlePurchaseTokenHash(n.purchaseToken);
    if (!purchase && (n.kind !== "voided" || !previousEnvironment)) throw new Error("google_purchase_missing");
    if (!purchase) notification.purchase = { lookupUnavailable: true };
  }
  if ("purchaseToken" in n && purchase) {
    const state = isSubscription ? purchase.subscriptionState : object(purchase.purchaseStateContext)?.purchaseState;
    const rawItems = isSubscription ? purchase.lineItems : purchase.productLineItem;
    if (!string(state, 100) || !Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw new Error("google_purchase_invalid");
    const items = rawItems.map(item => object(item));
    if (items.some(item => !string(item?.productId, 255))) throw new Error("google_purchase_invalid");
    const productIds = items.map(item => item!.productId as string);
    if (n.kind === "product" && !productIds.includes(n.sku)) throw new Error("google_product_mismatch");
    productId = n.kind === "product" ? n.sku : productIds.length === 1 ? productIds[0] : null;
    isTest = object(isSubscription ? purchase.testPurchase : purchase.testPurchaseContext) !== null;
    const latestOrderId = isSubscription && items.length === 1 ? items[0]?.latestSuccessfulOrderId : purchase.orderId;
    const snapshot: Record<string, unknown> = { state, productIds, isTest };
    if (string(latestOrderId, 255)) snapshot.latestOrderId = latestOrderId;
    if (string(purchase.regionCode, 2)) snapshot.regionCode = purchase.regionCode;
    notification.purchase = snapshot;
    if (n.kind === "subscription") {
      type = SUBSCRIPTION_TYPES[n.notificationType] ?? "other";
      // RTDN is a change signal, and an API lookup is the current snapshot. No
      // historical order/price or trial status is inferred from this snapshot.
      if (type === "purchase" && state !== "SUBSCRIPTION_STATE_ACTIVE") type = "other";
    } else if (n.kind === "product") {
      type = n.notificationType === 1 && state === "PURCHASED" ? "purchase" : "other";
      orderId = string(purchase.orderId, 255) ? purchase.orderId : null;
    }
  }
  switch (n.kind) {
    case "subscription": rawType = `SUBSCRIPTION_${n.notificationType}`; break;
    case "product": rawType = `ONE_TIME_PRODUCT_${n.notificationType}`; break;
    case "voided":
      rawType = "VOIDED_PURCHASE"; type = "refund"; orderId = n.orderId;
      notification.refundType = n.refundType; notification.productType = n.productType;
      break;
    case "refund_review":
      rawType = "PENDING_REFUND_REVIEW"; orderId = n.orderId;
      notification.refundReason = n.refundReason;
      break;
    case "test": rawType = "TEST"; type = "test"; break;
  }
  if ("notificationType" in n) notification.notificationType = n.notificationType;
  if (orderId) notification.orderId = orderId;
  return {
    event: {
      id: await googleDeliveryId(message.subscription, message.messageId), store: "play_store",
      environment: previousEnvironment ?? (isTest ? "Sandbox" : "Production"), type, occurredAt: new Date(n.eventTimeMillis).toISOString(),
      rawType, rawSubtype: null, productId, transactionId: orderId,
      originalTransactionId: typeof notification.purchaseTokenHash === "string" ? `google-play:${notification.purchaseTokenHash}` : null,
      revenue: null, currency: null, storefront: null, appUserId: null, isTrial: false, isFamilyShared: false,
    },
    notification,
  };
}
