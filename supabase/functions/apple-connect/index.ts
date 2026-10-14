import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { loadAppleCredentials } from "../_shared/credentials.ts";
import { createAppleConnect, RATE_LIMIT, type LocalApp } from "./handler.ts";

const db = serviceClientFromEnv(name => Deno.env.get(name));

Deno.serve(createAppleConnect({
  getUser: db.getUser,
  siteUrl: Deno.env.get("SITE_URL"),
  supabaseUrl: Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL"),
  internalSupabaseUrl: Deno.env.get("SUPABASE_URL"),
  canManage: async (accountId, userId) => {
    const members = await db.select<unknown[]>(`account_members?account_id=eq.${accountId}&user_id=eq.${userId}&role=in.(owner,admin)&select=user_id`);
    return members.length > 0;
  },
  app: async appId => (await db.select<LocalApp[]>(`apps?id=eq.${appId}&select=id,account_id,bundle_id,apple_app_id,webhook_key,forward_url_production,forward_url_sandbox`))[0] ?? null,
  receiverExists: async webhookKey => (await db.select<{ id: string }[]>(`apps?webhook_key=eq.${webhookKey}&select=id&limit=1`)).length > 0,
  credentials: (credentialId, accountId, userId) => loadAppleCredentials(db, credentialId, accountId, userId),
  prepareForwarding: ({ app, userId, expected, forwarding }) => db.rpc("prepare_apple_connection", {
    p_app: app.id, p_user: userId, p_bundle_id: app.bundle_id, p_apple_app_id: String(app.apple_app_id), p_webhook_key: app.webhook_key,
    p_expected_production: expected.production_url, p_expected_sandbox: expected.sandbox_url,
    p_forward_production: forwarding.production_url, p_forward_sandbox: forwarding.sandbox_url,
  }),
  rateLimit: userId => db.rpc<number>("consume_rate_limit", { p_key: `apple-connect:${userId}`, p_limit: RATE_LIMIT.calls, p_window_seconds: RATE_LIMIT.windowSeconds }),
}));
