// Store-neutral event model. Every store adapter (App Store and Google Play)
// normalises its native notifications into StoreEvent, and everything
// downstream (ledger, alerts, analytics, outbound webhooks) consumes only this.

export type Store = "app_store" | "play_store";
export type StoreEnvironment = "Production" | "Sandbox";

export type StoreEventType =
  | "purchase" // first paid purchase (one-time or subscription start)
  | "trial_started"
  | "intro_offer_started"
  | "renewal"
  | "resubscribe"
  | "billing_recovered"
  | "billing_issue"
  | "cancellation" // auto-renew turned off; access continues until expiry
  | "uncancellation"
  | "expired"
  | "refund"
  | "refund_declined"
  | "refund_reversed"
  | "revoked"
  | "product_change"
  | "price_increase"
  | "offer_redeemed"
  | "renewal_extended"
  | "consumption_request"
  | "test"
  | "other";

export type StoreEvent = {
  id: string; // store notification id (idempotency key)
  store: Store;
  environment: StoreEnvironment;
  type: StoreEventType;
  occurredAt: string; // ISO, when the store signed the event
  rawType: string; // e.g. DID_RENEW
  rawSubtype: string | null;
  productId: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  // Customer price in major units (Apple milliunits / 1000). Negative for refunds.
  revenue: number | null;
  currency: string | null;
  storefront: string | null; // ISO 3166-1 alpha-3
  appUserId: string | null; // appAccountToken, when the app sets one
  isTrial: boolean;
  isFamilyShared: boolean;
};

/** Event types that change money in or out. */
export const REVENUE_EVENTS: ReadonlySet<StoreEventType> = new Set([
  "purchase", "renewal", "resubscribe", "billing_recovered", "refund", "refund_reversed",
]);

// ---------- App Store Server Notifications V2 ----------

export type AppleTransaction = {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  price?: number; // milliunits
  currency?: string;
  storefront?: string;
  offerDiscountType?: string; // FREE_TRIAL | PAY_AS_YOU_GO | PAY_UP_FRONT
  offerType?: number;
  inAppOwnershipType?: string; // PURCHASED | FAMILY_SHARED
  appAccountToken?: string;
  [k: string]: unknown;
};

export type AppleNotification = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  signedDate?: number;
};

function appleType(n: AppleNotification, t: AppleTransaction | null): StoreEventType {
  const sub = n.subtype ?? "";
  const trial = t?.offerDiscountType === "FREE_TRIAL";
  const intro = !trial && (t?.offerDiscountType === "PAY_AS_YOU_GO" || t?.offerDiscountType === "PAY_UP_FRONT");
  switch (n.notificationType) {
    case "SUBSCRIBED":
      if (sub === "RESUBSCRIBE") return "resubscribe";
      return trial ? "trial_started" : intro ? "intro_offer_started" : "purchase";
    case "ONE_TIME_CHARGE":
      return "purchase";
    case "DID_RENEW":
      return sub === "BILLING_RECOVERY" ? "billing_recovered" : "renewal";
    case "DID_FAIL_TO_RENEW":
      return "billing_issue";
    case "DID_CHANGE_RENEWAL_STATUS":
      return sub === "AUTO_RENEW_DISABLED" ? "cancellation" : sub === "AUTO_RENEW_ENABLED" ? "uncancellation" : "other";
    case "DID_CHANGE_RENEWAL_PREF":
      return "product_change";
    case "EXPIRED":
    case "GRACE_PERIOD_EXPIRED":
      return "expired";
    case "REFUND":
      return "refund";
    case "REFUND_DECLINED":
      return "refund_declined";
    case "REFUND_REVERSED":
      return "refund_reversed";
    case "REVOKE":
      return "revoked";
    case "PRICE_INCREASE":
      return "price_increase";
    case "OFFER_REDEEMED":
      return "offer_redeemed";
    case "RENEWAL_EXTENDED":
    case "RENEWAL_EXTENSION":
      return "renewal_extended";
    case "CONSUMPTION_REQUEST":
      return "consumption_request";
    case "TEST":
      return "test";
    default:
      return "other";
  }
}

export function normalizeAppleNotification(
  n: AppleNotification,
  t: AppleTransaction | null,
  environment: StoreEnvironment,
): StoreEvent {
  const type = appleType(n, t);
  const trial = t?.offerDiscountType === "FREE_TRIAL";
  let revenue: number | null = null;
  if (t && typeof t.price === "number" && REVENUE_EVENTS.has(type) && !trial) {
    const amount = t.price / 1000;
    revenue = type === "refund" ? -amount : amount;
  }
  return {
    id: n.notificationUUID!,
    store: "app_store",
    environment,
    type,
    occurredAt: new Date(n.signedDate!).toISOString(),
    rawType: n.notificationType!,
    rawSubtype: n.subtype ?? null,
    productId: t?.productId ?? null,
    transactionId: t?.transactionId ?? null,
    originalTransactionId: t?.originalTransactionId ?? null,
    revenue,
    currency: t?.currency ?? null,
    storefront: t?.storefront ?? null,
    appUserId: t?.appAccountToken ?? null,
    isTrial: trial,
    isFamilyShared: t?.inAppOwnershipType === "FAMILY_SHARED",
  };
}
