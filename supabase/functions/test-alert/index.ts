import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { apnsConfigFromEnv, createApnsClient } from "../_shared/core/apns.ts";
import { guardedFetch } from "../_shared/dns.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { createTestAlert, RATE_LIMIT } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);
const apnsConfig = apnsConfigFromEnv(env);
const apns = apnsConfig ? createApnsClient(apnsConfig) : null;

Deno.serve(createTestAlert({
  getUser: db.getUser,
  targets: (appId, userId) => db.rpc("test_alert_targets", { p_app_id: appId, p_user: userId }),
  logDeliveries: (appId, eventId, deliveries) =>
    db.rpc("log_alert_deliveries", { p_app_id: appId, p_event_id: eventId, p_deliveries: deliveries }),
  rateLimit: (userId) =>
    db.rpc<number>("consume_rate_limit", { p_key: `test-alert:${userId}`, p_limit: RATE_LIMIT.calls, p_window_seconds: RATE_LIMIT.windowSeconds }),
  fetcher: guardedFetch,
  push: apns
    ? async (devices, app, event) => {
      const result = await apns.send(devices, app, event);
      if (result.invalidTokens.length) await db.rpc("disable_push_devices", { p_tokens: result.invalidTokens });
      return result;
    }
    : undefined,
}));
