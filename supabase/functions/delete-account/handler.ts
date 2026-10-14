// POST: deletes the caller's auth user and every account where they are the sole
// owner (App Store Review Guideline 5.1.1(v)). Active Stripe subscriptions of those
// accounts are cancelled first so nobody keeps paying for a deleted workspace.
import { bearer, browserFunction, json } from "../_shared/core/http.ts";
import type { AuthUser } from "../_shared/supabase.ts";

export type SoleOwned = { id: string; stripe_subscription_id: string | null; subscription_status: string | null };

export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  soleOwnedAccounts: (userId: string) => Promise<SoleOwned[]>;
  /** null when Stripe is not configured. */
  cancelSubscription: ((id: string) => Promise<void>) | null;
  deleteAccounts: (userId: string) => Promise<number>;
  deleteUser: (userId: string) => Promise<void>;
  log?: Pick<Console, "log" | "error">;
};

const ENDED = new Set(["canceled", "incomplete_expired"]);

export function createDeleteAccount(deps: Deps) {
  const log = deps.log ?? console;
  return browserFunction(async (req) => {
    const user = await deps.getUser(bearer(req));
    if (!user) return json(401, { error: "unauthorized" });

    const owned = await deps.soleOwnedAccounts(user.id);
    const live = owned.filter((a) => a.stripe_subscription_id && !ENDED.has(a.subscription_status ?? ""));
    if (live.length) {
      if (!deps.cancelSubscription) return json(503, { error: "billing_not_configured", message: "Could not cancel your subscription. Contact support." });
      try {
        for (const a of live) await deps.cancelSubscription(a.stripe_subscription_id!);
      } catch (error) {
        log.error("subscription cancel failed", { user: user.id, error: String(error) });
        return json(502, { error: "cancel_failed", message: "Could not cancel your subscription. Nothing was deleted; try again." });
      }
    }
    const deletedAccounts = await deps.deleteAccounts(user.id);
    await deps.deleteUser(user.id);
    log.log("account deleted", { user: user.id, deletedAccounts });
    return json(200, { deleted: true, deleted_accounts: deletedAccounts });
  }, log);
}
