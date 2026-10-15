// Authenticated, wrapped Pub/Sub receiver. Route: /google-webhook/<app-key>.
// The acknowledgement follows durable recording; fan-out follows recording.
import { dispatch as defaultDispatch, type Delivery } from "../_shared/core/alerts.ts";
import { shouldPush, type PushDevice, type PushResult } from "../_shared/core/apns.ts";
import { bearer } from "../_shared/core/http.ts";
import { GooglePushVerificationError } from "../_shared/core/google_auth.ts";
import { googleDeliveryId, googlePurchaseTokenHash, GooglePayloadError, normalizeGooglePlayNotification, parseGooglePush, type GoogleNotification } from "../_shared/core/google_play.ts";
import { GooglePlayPurchaseUnavailableError } from "../_shared/core/google_play_api.ts";
import type { StoreEnvironment, StoreEvent } from "../_shared/core/events.ts";
import type { RecordResult } from "../apple-webhook/handler.ts";

export type GoogleApp = {
  id: string; name: string; packageName: string; enabled: boolean;
  audience: string; serviceAccountEmail: string; subscription: string;
  connectionVersion: string;
};
export type Deps = {
  lookupApp: (key: string) => Promise<GoogleApp | null>;
  verifyPush: (token: string, expected: { audience: string; serviceAccountEmail: string }) => Promise<void>;
  isDuplicate: (app: GoogleApp, eventId: string) => Promise<boolean>;
  loadPreviousEnvironment: (app: GoogleApp, tokenHash: string) => Promise<StoreEnvironment | null>;
  loadPurchase: (app: GoogleApp, notification: GoogleNotification) => Promise<Record<string, unknown>>;
  record: (input: { app: GoogleApp; event: StoreEvent; notification: Record<string, unknown> }) => Promise<RecordResult>;
  logDeliveries: (app: GoogleApp, event: StoreEvent, deliveries: Delivery[]) => Promise<void>;
  dispatch?: typeof defaultDispatch;
  push?: (devices: PushDevice[], app: GoogleApp, event: StoreEvent) => Promise<PushResult>;
  fetcher?: typeof fetch;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: () => number;
  log?: Pick<Console, "log" | "warn" | "error">;
};

const MAX_BODY = 128 * 1024;
const reply = (status: number, message: string) => Response.json({ message }, { status });
const retry = () => reply(503, "Unavailable; retry");
const acknowledge = () => new Response(null, { status: 204 });

async function readBody(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      bytes += value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); return null; }
      body += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export function createGoogleWebhook(deps: Deps) {
  const log = deps.log ?? console, now = deps.now ?? Date.now;
  const send = deps.dispatch ?? defaultDispatch;
  return async (req: Request): Promise<Response> => {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("google-webhook");
    const [key, ...rest] = index >= 0 ? parts.slice(index + 1) : [];
    if (!key || rest.length || !/^[A-Za-z0-9_-]{6,64}$/.test(key)) return reply(404, "Not found");
    if (req.method !== "POST") return reply(405, "POST required");
    const token = bearer(req);
    if (!token || token.length > 16 * 1024) return reply(401, "Unauthorized");
    let app: GoogleApp | null;
    try { app = await deps.lookupApp(key); }
    catch { log.error("google app lookup failed"); return retry(); }
    if (!app || !app.enabled) return reply(404, "Not found");
    const context = { app: app.id };
    try { await deps.verifyPush(token, { audience: app.audience, serviceAccountEmail: app.serviceAccountEmail }); }
    catch (error) {
      if (error instanceof GooglePushVerificationError) return reply(401, "Unauthorized");
      log.error("google push verification unavailable", context);
      return retry();
    }
    let message;
    try {
      const body = await readBody(req);
      if (body === null) return reply(413, "Payload too large");
      message = parseGooglePush(JSON.parse(body));
    } catch (error) {
      if (!(error instanceof GooglePayloadError) && !(error instanceof SyntaxError)) log.warn("google push body unreadable", context);
      return reply(400, "Invalid payload");
    }
    const n = message.notification;
    if (message.subscription !== app.subscription || n.packageName !== app.packageName) return reply(403, "Connection mismatch");
    if (n.eventTimeMillis > now() + 5 * 60_000) return reply(400, "Invalid event time");
    let event: StoreEvent, notification: Record<string, unknown>, result: RecordResult;
    try {
      const id = await googleDeliveryId(message.subscription, message.messageId);
      // This read is only an optimization: record() atomically resolves races.
      if (await deps.isDuplicate(app, id)) return acknowledge();
      let purchase: Record<string, unknown> | null = null;
      let previousEnvironment: StoreEnvironment | undefined;
      if ("purchaseToken" in n) {
        try { purchase = await deps.loadPurchase(app, n); }
        catch (error) {
          if (!(error instanceof GooglePlayPurchaseUnavailableError) || n.kind !== "voided") throw error;
          const known = await deps.loadPreviousEnvironment(app, await googlePurchaseTokenHash(n.purchaseToken));
          if (!known) throw error;
          previousEnvironment = known;
        }
      }
      ({ event, notification } = await normalizeGooglePlayNotification(message, purchase, previousEnvironment));
      result = await deps.record({ app, event, notification });
    } catch {
      // Fetch errors can contain a purchase-token URL. Never log raw errors.
      log.error("google purchase processing unavailable", context);
      return retry();
    }
    log.log("google store event", { ...context, fresh: result.fresh, type: event.type, environment: event.environment });
    const work: Promise<unknown>[] = [];
    if (result.fresh && result.active !== false) {
      if (result.channels.length) {
        work.push(Promise.resolve().then(() => send(result.channels, { name: app.name }, event, deps.fetcher ?? fetch, now()))
          .then(deliveries => deliveries.length ? deps.logDeliveries(app!, event, deliveries) : undefined)
          .catch(() => log.error("google alert dispatch failed", context)));
      }
      if (deps.push && result.devices?.length && shouldPush(event, now())) {
        work.push(Promise.resolve().then(() => deps.push!(result.devices!, app!, event))
          .catch(() => log.error("google push failed", context)));
      }
    }
    if (work.length) {
      const all = Promise.all(work);
      if (deps.waitUntil) deps.waitUntil(all);
      else await all;
    }
    return acknowledge();
  };
}
