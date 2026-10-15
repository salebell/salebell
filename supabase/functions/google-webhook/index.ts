// Cloud and self-hosted URL:
// https://<api-host>/functions/v1/google-webhook/<app-key>
// Pub/Sub must use wrapped delivery with the configured OIDC audience/account.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { apnsConfigFromEnv, createApnsClient } from "../_shared/core/apns.ts";
import { createGooglePushVerifier } from "../_shared/core/google_auth.ts";
import { createGooglePlayClient, type GoogleServiceAccount } from "../_shared/core/google_play_api.ts";
import type { StoreEnvironment } from "../_shared/core/events.ts";
import { guardedFetch } from "../_shared/dns.ts";
import { serviceClientFromEnv } from "../_shared/supabase.ts";
import { createGoogleWebhook } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const db = serviceClientFromEnv(env);
const apnsConfig = apnsConfigFromEnv(env);
const apns = apnsConfig ? createApnsClient(apnsConfig) : null;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

type AppRow = {
  id: string; name: string; package_name: string; enabled: boolean;
  audience: string; service_account_email: string; subscription: string;
  connection_version: string;
};
// A bounded per-worker cache reuses OAuth tokens. Credentials are loaded on every
// new delivery so replacement/removal takes effect without an instance restart.
const clients = new Map<string, { credentials: string; client: ReturnType<typeof createGooglePlayClient> }>();

async function playClient(appId: string) {
  const credentials = await db.rpc<GoogleServiceAccount | null>("load_google_play_credentials", { p_app_id: appId });
  if (!credentials) { clients.delete(appId); throw new Error("google_credentials_missing"); }
  const identity = JSON.stringify(credentials);
  let cached = clients.get(appId);
  if (!cached || cached.credentials !== identity) {
    if (clients.size >= 100) clients.delete(clients.keys().next().value!);
    cached = { credentials: identity, client: createGooglePlayClient(credentials) };
    clients.set(appId, cached);
  }
  return cached.client;
}

Deno.serve(createGoogleWebhook({
  lookupApp: async key => {
    const [row] = await db.rpc<AppRow[]>("google_webhook_app", { p_key: key });
    return row ? { id: row.id, name: row.name, packageName: row.package_name, enabled: row.enabled,
      audience: row.audience, serviceAccountEmail: row.service_account_email, subscription: row.subscription,
      connectionVersion: row.connection_version } : null;
  },
  verifyPush: createGooglePushVerifier(),
  isDuplicate: async (app, eventId) => {
    const rows = await db.select<{ id: string }[]>(`store_events?select=id&app_id=eq.${encodeURIComponent(app.id)}&id=eq.${encodeURIComponent(eventId)}&limit=1`);
    return rows.length > 0;
  },
  loadPreviousEnvironment: async (app, tokenHash) => {
    const rows = await db.select<{ environment: StoreEnvironment }[]>(`store_events?select=environment&app_id=eq.${encodeURIComponent(app.id)}&store=eq.play_store&original_transaction_id=eq.google-play:${tokenHash}&order=received_at.desc&limit=1`);
    return rows[0]?.environment ?? null;
  },
  loadPurchase: async (app, notification) => {
    const client = await playClient(app.id);
    if (!("purchaseToken" in notification)) throw new Error("google_purchase_token_missing");
    return notification.kind === "subscription" || (notification.kind === "voided" && notification.productType === 1)
      ? client.getSubscription(app.packageName, notification.purchaseToken)
      : client.getProduct(app.packageName, notification.purchaseToken);
  },
  loadOrder: async (app, orderId) => (await playClient(app.id)).getOrder(app.packageName, orderId),
  record: ({ app, event, notification }) => db.rpc("record_google_play_event", { p_app_id: app.id, p_event: event, p_payload: notification,
    p_connection_version: app.connectionVersion }),
  logDeliveries: (app, event, deliveries) => db.rpc("log_alert_deliveries", { p_app_id: app.id, p_event_id: event.id, p_deliveries: deliveries }),
  push: apns ? async (devices, app, event) => {
    const result = await apns.send(devices, app, event);
    if (result.invalidTokens.length) await db.rpc("disable_push_devices", { p_tokens: result.invalidTokens });
    return result;
  } : undefined,
  fetcher: guardedFetch,
  waitUntil: typeof EdgeRuntime !== "undefined" ? p => EdgeRuntime.waitUntil(p) : undefined,
}));
