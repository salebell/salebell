import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { createGoogleConnect, RATE_LIMIT, type LocalApp } from "./handler.ts";

const db = serviceClientFromEnv(name => Deno.env.get(name));
Deno.serve(createGoogleConnect({
  getUser: db.getUser,
  publicApiUrl: Deno.env.get("SUPABASE_PUBLIC_URL") ?? Deno.env.get("SUPABASE_URL"),
  app: async id => (await db.select<LocalApp[]>(`apps?id=eq.${id}&select=id,account_id,store,package_name,webhook_key,enabled,last_event_production_at,last_event_sandbox_at`))[0] ?? null,
  canManage: async (accountId, userId) => (await db.select<unknown[]>(`account_members?account_id=eq.${accountId}&user_id=eq.${userId}&role=in.(owner,admin)&select=user_id`)).length > 0,
  status: (appId, userId) => db.rpc("google_connection_status", { p_app_id: appId, p_user: userId }),
  save: input => db.rpc("save_user_google_play_connection", {
    p_app_id: input.app.id, p_user: input.userId, p_package_name: input.app.package_name, p_webhook_key: input.app.webhook_key,
    p_audience: input.audience, p_topic: input.topic, p_subscription: input.subscription,
    p_service_account_email: input.serviceAccountEmail, p_credentials: input.credentials,
  }),
  remove: (appId, userId) => db.rpc("delete_user_google_play_connection", { p_app_id: appId, p_user: userId }),
  rateLimit: userId => db.rpc("consume_rate_limit", { p_key: `google-connect:${userId}`, p_limit: RATE_LIMIT.calls, p_window_seconds: RATE_LIMIT.windowSeconds }),
}));
