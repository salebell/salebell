import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { loadAppleCredentials } from "../_shared/credentials.ts";
import { createAppleTest, RATE_LIMIT } from "./handler.ts";

const db = serviceClientFromEnv((name) => Deno.env.get(name));

Deno.serve(createAppleTest({
  getUser: db.getUser,
  bundleId: async (appId, userId) => {
    const [app] = await db.select<{ bundle_id: string; account_id: string }[]>(`apps?id=eq.${appId}&select=bundle_id,account_id`);
    if (!app) return null;
    const member = await db.select<unknown[]>(`account_members?account_id=eq.${app.account_id}&user_id=eq.${userId}&select=user_id`);
    return member.length ? app.bundle_id : null;
  },
  savedCredentials: async (credentialId, appId, userId) => {
    const [app] = await db.select<{ account_id: string }[]>(`apps?id=eq.${appId}&select=account_id`);
    if (!app) return null;
    const members = await db.select<unknown[]>(`account_members?account_id=eq.${app.account_id}&user_id=eq.${userId}&role=in.(owner,admin)&select=user_id`);
    return members.length ? loadAppleCredentials(db, credentialId, app.account_id, userId, "apple_iap") : null;
  },
  rateLimit: (userId) =>
    db.rpc<number>("consume_rate_limit", { p_key: `apple-test:${userId}`, p_limit: RATE_LIMIT.calls, p_window_seconds: RATE_LIMIT.windowSeconds }),
}));
