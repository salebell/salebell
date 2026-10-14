import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAppleNotification } from "../supabase/functions/_shared/core/events.ts";

const n = (notificationType: string, subtype?: string) => ({ notificationType, subtype, notificationUUID: "u", signedDate: 1791392086569 });
const tx = (o: object = {}) => ({ transactionId: "1", originalTransactionId: "1", productId: "p.lifetime", price: 499990, currency: "TRY", storefront: "TUR", ...o });

test("maps Apple notification types to store-neutral events", () => {
  const cases: Array<[string, string | undefined, object | null, string]> = [
    ["ONE_TIME_CHARGE", undefined, tx(), "purchase"],
    ["SUBSCRIBED", "INITIAL_BUY", tx(), "purchase"],
    ["SUBSCRIBED", "INITIAL_BUY", tx({ offerDiscountType: "FREE_TRIAL", price: 0 }), "trial_started"],
    ["SUBSCRIBED", "INITIAL_BUY", tx({ offerDiscountType: "PAY_AS_YOU_GO" }), "intro_offer_started"],
    ["SUBSCRIBED", "RESUBSCRIBE", tx(), "resubscribe"],
    ["DID_RENEW", undefined, tx(), "renewal"],
    ["DID_RENEW", "BILLING_RECOVERY", tx(), "billing_recovered"],
    ["DID_FAIL_TO_RENEW", "GRACE_PERIOD", tx(), "billing_issue"],
    ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", tx(), "cancellation"],
    ["DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_ENABLED", tx(), "uncancellation"],
    ["EXPIRED", "VOLUNTARY", tx(), "expired"],
    ["GRACE_PERIOD_EXPIRED", undefined, tx(), "expired"],
    ["REFUND", undefined, tx(), "refund"],
    ["REVOKE", undefined, tx(), "revoked"],
    ["CONSUMPTION_REQUEST", undefined, tx(), "consumption_request"],
    ["TEST", undefined, null, "test"],
    ["SOMETHING_NEW", undefined, null, "other"],
  ];
  for (const [type, sub, t, expected] of cases) {
    assert.equal(normalizeAppleNotification(n(type, sub), t as never, "Production").type, expected, `${type}/${sub}`);
  }
});

test("revenue: purchases positive, refunds negative, trials and non-revenue events null", () => {
  assert.equal(normalizeAppleNotification(n("ONE_TIME_CHARGE"), tx(), "Production").revenue, 499.99);
  assert.equal(normalizeAppleNotification(n("REFUND"), tx(), "Production").revenue, -499.99);
  assert.equal(normalizeAppleNotification(n("SUBSCRIBED", "INITIAL_BUY"), tx({ offerDiscountType: "FREE_TRIAL", price: 0 }), "Production").revenue, null);
  assert.equal(normalizeAppleNotification(n("EXPIRED"), tx(), "Production").revenue, null);
  assert.equal(normalizeAppleNotification(n("DID_FAIL_TO_RENEW"), tx(), "Production").revenue, null);
});

test("carries identity fields", () => {
  const e = normalizeAppleNotification(n("ONE_TIME_CHARGE"), tx({ appAccountToken: "user-1", inAppOwnershipType: "FAMILY_SHARED" }), "Sandbox");
  assert.deepEqual([e.id, e.store, e.environment, e.appUserId, e.isFamilyShared, e.occurredAt],
    ["u", "app_store", "Sandbox", "user-1", true, "2026-10-07T16:54:46.569Z"]);
});
