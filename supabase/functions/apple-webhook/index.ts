// Supabase Edge Function entrypoint. Configure in App Store Connect (Version 2):
//   https://<project>.supabase.co/functions/v1/apple-webhook/<app-key>/production
//   https://<project>.supabase.co/functions/v1/apple-webhook/<app-key>/sandbox
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { loadTrustedRoots } from "../_shared/core/apple_jws.ts";
import { APPLE_ROOT_CA_G3 } from "../_shared/core/apple_roots.ts";
import { apnsConfigFromEnv, createApnsClient } from "../_shared/core/apns.ts";
import { guardedFetch } from "../_shared/dns.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { cachedLookup, createAppleWebhook, DUPLICATE_FORWARDS, type RecordResult } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);
const apnsConfig = apnsConfigFromEnv(env);
const apns = apnsConfig ? createApnsClient(apnsConfig) : null;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type AppRow = {
  id: string; name: string; bundle_id: string; apple_app_id: number | null; enabled: boolean;
  forward_url_production: string | null; forward_url_sandbox: string | null;
};

Deno.serve(createAppleWebhook({
  roots: loadTrustedRoots([APPLE_ROOT_CA_G3]),
  // Warm instances cache found apps for a minute.
  lookupApp: cachedLookup(async (appKey) => {
    const [r] = await db.rpc<AppRow[]>("webhook_app", { p_key: appKey });
    return r
      ? {
        id: r.id, name: r.name, bundleId: r.bundle_id, appleAppId: r.apple_app_id, enabled: r.enabled,
        forwardUrlProduction: r.forward_url_production, forwardUrlSandbox: r.forward_url_sandbox,
      }
      : null;
  }),
  record: ({ app, event, notification, transaction }) =>
    db.rpc<RecordResult>("record_store_event", { p_app_id: app.id, p_event: event, p_payload: notification, p_transaction: transaction }),
  logDeliveries: (app, event, deliveries) =>
    db.rpc("log_alert_deliveries", { p_app_id: app.id, p_event_id: event.id, p_deliveries: deliveries }),
  push: apns
    ? async (devices, app, event) => {
      const result = await apns.send(devices, app, event);
      if (result.invalidTokens.length) await db.rpc("disable_push_devices", { p_tokens: result.invalidTokens });
      return result;
    }
    : undefined,
  fetcher: guardedFetch,
  allowDuplicateForward: async (appId, uuid) =>
    await db.rpc<number>("consume_rate_limit", {
      p_key: `fwd:${appId}:${uuid}`, p_limit: DUPLICATE_FORWARDS.max, p_window_seconds: DUPLICATE_FORWARDS.windowSeconds,
    }) === 0,
  waitUntil: typeof EdgeRuntime !== "undefined" ? (p) => EdgeRuntime.waitUntil(p) : undefined,
}));
