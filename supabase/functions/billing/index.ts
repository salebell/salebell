import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { loadInstanceSettings } from "../_shared/instance.ts";
import { billingConfigFromEnv, createBilling, type OwnerAccount } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);

Deno.serve(createBilling({
  billingEnabled: async () => (await loadInstanceSettings(db)).billing_enabled,
  config: billingConfigFromEnv(env),
  getUser: db.getUser,
  ownerAccount: async (userId, accountId) =>
    (await db.rpc<OwnerAccount[]>("billing_owner_account", { p_user: userId, p_account: accountId }))[0] ?? null,
  setCustomer: (accountId, customerId) => db.rpc<string>("set_stripe_customer", { p_account: accountId, p_customer: customerId }),
}));
