// Charged customer prices from orders.get, never catalog/recurring prices.
// Raw orders contain tokens and buyer addresses: only allowlisted totals survive.
import type { StoreEvent } from "./events.ts";
import type { GooglePushMessage } from "./google_play.ts";

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 255 && !/[\x00-\x1f\x7f]/.test(v);
const invalid = (): never => { throw new Error("google_order_invalid"); };
const timestamp = (v: unknown): number => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) return invalid();
  return Date.parse(v);
};

/** Match the shared ledger's numeric(14,3), rounding once using integer arithmetic. */
export function googleMoneyMilliunits(value: unknown): number {
  const m = object(value);
  if (!m || typeof m.currencyCode !== "string" || !/^[A-Z]{3}$/.test(m.currencyCode)) return invalid();
  const units = m.units ?? "0", nanos = m.nanos ?? 0;
  if (typeof units !== "string" || !/^\d{1,11}$/.test(units) || !Number.isInteger(nanos) || (nanos as number) < 0 || (nanos as number) >= 1e9) return invalid();
  const milli = BigInt(units) * 1000n + (BigInt(nanos as number) + 500000n) / 1000000n;
  if (milli > 99999999999999n) return invalid();
  return Number(milli);
}

export async function enrichGoogleOrder(
  message: GooglePushMessage,
  purchase: Record<string, unknown> | null,
  normalized: { event: StoreEvent; notification: Record<string, unknown> },
  loadOrder: (orderId: string) => Promise<Record<string, unknown>>,
): Promise<void> {
  const { event, notification } = normalized, n = message.notification;
  if (!["purchase", "renewal", "refund"].includes(event.type) || !("purchaseToken" in n)) return;
  let orderId: string;
  if (n.kind === "voided") orderId = n.orderId;
  else if (n.kind === "product" && text(purchase?.orderId)) orderId = purchase.orderId;
  else if (n.kind === "subscription" && Array.isArray(purchase?.lineItems)) {
    const ids = purchase.lineItems.map(item => object(item)?.latestSuccessfulOrderId);
    if (!ids.length || ids.some(id => !text(id)) || new Set(ids).size !== 1) {
      notification.priceUnavailable = "ambiguous_order";
      return;
    }
    orderId = ids[0] as string;
  } else {
    notification.priceUnavailable = "missing_order";
    return;
  }
  const order = await loadOrder(orderId);
  if (order.orderId !== orderId || order.purchaseToken !== n.purchaseToken ||
    !["PROCESSED", "PENDING_REFUND", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.state as string)) return invalid();
  const items = Array.isArray(order.lineItems) ? order.lineItems.map(object) : [];
  if (!items.length || items.length > 100 || items.some(item => !text(item?.productId))) return invalid();
  if (event.type !== "refund") {
    const purchaseItems = n.kind === "subscription" ? purchase?.lineItems : purchase?.productLineItem;
    const products = new Set(Array.isArray(purchaseItems) ? purchaseItems.map(item => object(item)?.productId) : []);
    if (items.some(item => !products.has(item!.productId))) return invalid();
  }
  const history = object(order.orderHistory);
  const processedAt = timestamp(object(history?.processedEvent)?.eventTime);
  // A delayed RTDN can resolve to a later subscription renewal. Never assign it
  // that later charge; the later notification will record its own order.
  // One-time purchases identify their exact order above; Google's processing
  // timestamp can slightly follow the RTDN timestamp for that same charge.
  if (n.kind === "subscription" && event.type !== "refund" && processedAt > n.eventTimeMillis) {
    notification.priceUnavailable = "newer_order";
    return;
  }
  const charged = googleMoneyMilliunits(order.total), currency = object(order.total)!.currencyCode as string;
  let refunded = 0;
  const addRefund = (value: unknown) => {
    if (object(value)?.currencyCode !== currency) return invalid();
    refunded += googleMoneyMilliunits(value);
  };
  if (event.type === "refund") {
    let completed = false;
    const partials = history?.partialRefundEvents ?? [];
    if (!Array.isArray(partials) || partials.length > 10000) return invalid();
    for (const raw of partials) {
      const partial = object(raw);
      if (partial?.state === "PROCESSED_SUCCESSFULLY" && timestamp(partial.processTime) <= n.eventTimeMillis) {
        addRefund(object(partial.refundDetails)?.total);
        completed = true;
      }
    }
    const full = object(history?.refundEvent);
    if (full && timestamp(full.eventTime) <= n.eventTimeMillis) {
      const total = object(full.refundDetails)?.total;
      if (object(total)?.currencyCode !== currency) return invalid();
      const fullAmount = googleMoneyMilliunits(total);
      // A full-order total already includes prior partial refunds; a remaining
      // refund amount instead adds to them. Both must reconcile to the charge.
      if (order.state === "REFUNDED" && fullAmount === charged) refunded = charged;
      else refunded += fullAmount;
      if (order.state === "REFUNDED" && refunded !== charged) return invalid();
      completed = true;
    }
    if (!completed || refunded > charged) return invalid();
  }
  event.transactionId = orderId;
  event.productId = items.length === 1 ? items[0]!.productId as string : null;
  event.currency = currency;
  const amount = event.type === "refund" ? -refunded : charged;
  event.revenue = amount === 0 ? 0 : amount / 1000;
  const trial = items.every(item => {
    const details = object(item?.subscriptionDetails);
    return details?.offerPhase === "FREE_TRIAL" || object(object(details?.offerPhaseDetails)?.freeTrialDetails) !== null;
  });
  if (event.type === "purchase" && charged === 0 && trial) {
    event.type = "trial_started";
    event.isTrial = true;
  }
  notification.order = { source: "orders.get", orderId, currency, chargedAmount: charged / 1000,
    refundedAmount: refunded / 1000, processedAt: new Date(processedAt).toISOString() };
}
