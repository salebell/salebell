import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { createDeleteAccount, type SoleOwned } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);
const stripeKey = env("STRIPE_SECRET_KEY");

Deno.serve(createDeleteAccount({
  getUser: db.getUser,
  soleOwnedAccounts: (userId) => db.rpc<SoleOwned[]>("sole_owned_accounts", { p_user: userId }),
  cancelSubscription: stripeKey
    ? async (id) => {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE", headers: { authorization: `Bearer ${stripeKey}` }, signal: AbortSignal.timeout(15_000),
      });
      // 404: already gone on Stripe's side.
      if (!res.ok && res.status !== 404) throw new Error(`stripe cancel HTTP ${res.status}`);
      await res.body?.cancel();
    }
    : null,
  deleteAccounts: (userId) => db.rpc<number>("delete_sole_owned_accounts", { p_user: userId }),
  deleteUser: async (userId) => { await db.deleteUser(userId); },
}));
