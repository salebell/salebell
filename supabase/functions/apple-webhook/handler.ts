// Multi-tenant App Store Server Notifications V2 receiver.
// Route: /apple-webhook/<app-key>/<production|sandbox>
// Runtime-agnostic; index.ts wires Supabase persistence and Deno.serve.
import { AppleJwsVerificationError, type TrustedRoots, verifyAppleJws } from "../_shared/core/apple_jws.ts";
import { type AppleNotification, type AppleTransaction, normalizeAppleNotification, type StoreEnvironment, type StoreEvent } from "../_shared/core/events.ts";
import { type Channel, type Delivery, dispatch as defaultDispatch } from "../_shared/core/alerts.ts";
import { type PushDevice, type PushResult, shouldPush } from "../_shared/core/apns.ts";
import { FORWARDED_HEADER, forwardRaw, type ForwardResult } from "../_shared/core/forward.ts";

export type App = {
  id: string; name: string; bundleId: string; appleAppId: number | null; enabled: boolean;
  forwardUrlProduction?: string | null; forwardUrlSandbox?: string | null;
};

/** active=false: the app is beyond its plan's limit, so alerts and pushes pause (recording and forwarding continue). */
export type RecordResult = { fresh: boolean; active?: boolean; channels: Channel[]; devices?: PushDevice[] };

export type Deps = {
  roots: TrustedRoots;
  lookupApp: (key: string) => Promise<App | null>;
  /** Atomically stores event + ledger row. fresh=false for a replayed notification id. */
  record: (input: { app: App; event: StoreEvent; notification: Record<string, unknown>; transaction: AppleTransaction | null }) =>
    Promise<RecordResult>;
  logDeliveries: (app: App, event: StoreEvent, deliveries: Delivery[]) => Promise<void>;
  dispatch?: typeof defaultDispatch;
  /** APNs fan-out; undefined when APNs is not configured (pushes are skipped). */
  push?: (devices: PushDevice[], app: App, event: StoreEvent) => Promise<PushResult>;
  forward?: (url: string, body: string, contentType: string) => Promise<ForwardResult>;
  /** Guarded fetch for customer destinations (alert channels and forward URLs). */
  fetcher?: typeof fetch;
  /**
   * Whether an Apple retry of an already-recorded notification may be forwarded again
   * (DUPLICATE_FORWARDS per notificationUUID). Fails open. Undefined: always.
   */
  allowDuplicateForward?: (appId: string, notificationUUID: string) => Promise<boolean>;
  now?: () => number;
  /** Keeps background work alive after the response (EdgeRuntime.waitUntil). */
  waitUntil?: (p: Promise<unknown>) => void;
  log?: Pick<Console, "log" | "warn" | "error">;
};

type Payload = AppleNotification & {
  data?: { bundleId?: string; appAppleId?: number; environment?: string; signedTransactionInfo?: string; signedRenewalInfo?: string; [k: string]: unknown };
  summary?: { bundleId?: string; appAppleId?: number; environment?: string; [k: string]: unknown };
  externalPurchaseToken?: { bundleId?: string; appAppleId?: number; [k: string]: unknown };
  [k: string]: unknown;
};
type Signed = { bundleId?: string; environment?: string; signedDate?: number; [k: string]: unknown };

const MAX_BODY = 128 * 1024;
const reply = (status: number, message: string) => Response.json({ message }, { status });

function parseRoute(url: string): { key: string; environment: StoreEnvironment } | null {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const i = parts.indexOf("apple-webhook");
  const [key, env, ...rest] = i >= 0 ? parts.slice(i + 1) : [];
  if (!key || rest.length || !/^[A-Za-z0-9_-]{6,64}$/.test(key)) return null;
  const environment = env === "production" ? "Production" : env === "sandbox" ? "Sandbox" : null;
  return environment ? { key, environment } : null;
}

async function readBody(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return body + decoder.decode();
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
}

export const DUPLICATE_FORWARDS = { max: 3, windowSeconds: 3600 };

/**
 * Caches found apps for ttlMs (disabling an app takes effect within that time). Misses are
 * never cached, so random keys can't grow the map, and it holds at most max entries.
 */
export function cachedLookup(
  load: (key: string) => Promise<App | null>,
  { ttlMs = 60_000, max = 1000, now = Date.now }: { ttlMs?: number; max?: number; now?: () => number } = {},
) {
  const cache = new Map<string, { app: App; until: number }>();
  return async (key: string): Promise<App | null> => {
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.app;
    cache.delete(key);
    const app = await load(key);
    if (app) {
      if (cache.size >= max) cache.delete(cache.keys().next().value!);
      cache.set(key, { app, until: now() + ttlMs });
    }
    return app;
  };
}

export function createAppleWebhook(deps: Deps) {
  const log = deps.log ?? console;
  const send = deps.dispatch ?? defaultDispatch;
  const fetcher = deps.fetcher ?? fetch;
  const forward = deps.forward ?? ((url, body, contentType) => forwardRaw(url, body, contentType, fetcher));
  const now = deps.now ?? Date.now;

  return async (req: Request): Promise<Response> => {
    const route = parseRoute(req.url);
    if (!route) return reply(404, "Not found");
    if (req.method !== "POST") return reply(405, "POST required");
    const { environment } = route;

    let app: App | null;
    try {
      app = await deps.lookupApp(route.key);
    } catch (error) {
      log.error("app lookup failed", { error: String(error) });
      return reply(503, "Unavailable; retry");
    }
    if (!app || !app.enabled) return reply(404, "Not found");
    const ctx = { app: app.id, environment };

    const raw = await readBody(req);
    if (raw === null) return reply(413, "Payload too large");
    let signedPayload: unknown;
    try {
      signedPayload = JSON.parse(raw)?.signedPayload;
    } catch {
      return reply(400, "Invalid JSON");
    }
    if (typeof signedPayload !== "string") return reply(400, "Missing signedPayload");

    let n: Payload;
    let transaction: (AppleTransaction & Signed) | null = null;
    let renewal: Signed | null = null;
    const reject = (reason: string, extra: Record<string, unknown> = {}) => {
      log.error("apple notification rejected", { ...ctx, reason, ...extra });
      return reply(400, "Rejected");
    };
    try {
      n = await verifyAppleJws<Payload>(signedPayload, deps.roots);
      const scope = n.data ?? n.summary ?? n.externalPurchaseToken;
      if (!n.notificationUUID || !n.notificationType || typeof n.signedDate !== "number" || !scope) return reject("unsupported_payload");
      if (scope.bundleId !== app.bundleId) return reject("bundle_mismatch", { bundleId: scope.bundleId });
      const scopeEnv = "environment" in scope ? scope.environment : undefined;
      if (scopeEnv !== undefined && scopeEnv !== environment) return reject("environment_mismatch", { got: scopeEnv });
      if (environment === "Production" && app.appleAppId != null && scope.appAppleId !== undefined && scope.appAppleId !== app.appleAppId) {
        return reject("app_apple_id_mismatch");
      }
      if (n.data?.signedTransactionInfo) transaction = await verifyAppleJws(n.data.signedTransactionInfo, deps.roots);
      if (n.data?.signedRenewalInfo) renewal = await verifyAppleJws(n.data.signedRenewalInfo, deps.roots);
      if (transaction && (transaction.environment !== environment || transaction.bundleId !== app.bundleId)) return reject("transaction_mismatch");
      if (renewal && renewal.environment !== environment) return reject("renewal_mismatch");
    } catch (error) {
      if (error instanceof AppleJwsVerificationError) return reject(error.reason);
      log.error("apple verification error", { ...ctx, error: String(error) });
      return reply(503, "Unavailable; retry");
    }

    const usable = transaction && transaction.transactionId && transaction.originalTransactionId && transaction.productId &&
        transaction.purchaseDate && transaction.signedDate ? transaction : null;
    const event = normalizeAppleNotification(n, usable, environment);
    const scope = n.data ?? n.summary ?? n.externalPurchaseToken ?? {};
    const { signedTransactionInfo: _t, signedRenewalInfo: _r, ...data } = n.data ?? {};
    const notification = { ...n, data: { ...data, bundleId: scope.bundleId, environment, transaction, renewal } };

    let result: RecordResult;
    try {
      result = await deps.record({ app, event, notification, transaction: usable });
    } catch (error) {
      log.error("persistence failed", { ...ctx, error: String(error) });
      return reply(503, "Unavailable; retry");
    }

    log.log("store event", {
      ...ctx, fresh: result.fresh, type: event.type, raw: event.rawType, subtype: event.rawSubtype,
      product: event.productId, revenue: event.revenue, currency: event.currency, storefront: event.storefront,
    });

    // Forwarding, alerts and pushes never affect Apple's response: the event is already durable.
    // Duplicates are forwarded too (Apple only retries when an earlier delivery looked failed),
    // but at most DUPLICATE_FORWARDS times per notificationUUID, so replays can't be amplified.
    const work: Promise<unknown>[] = [];
    const forwardUrl = environment === "Production" ? app.forwardUrlProduction : app.forwardUrlSandbox;
    if (forwardUrl && !req.headers.has(FORWARDED_HEADER)) {
      const allowed = result.fresh || !deps.allowDuplicateForward
        ? Promise.resolve(true)
        : deps.allowDuplicateForward(app.id, n.notificationUUID!).catch(() => true);
      work.push(allowed
        .then(async (ok) => {
          if (!ok) return log.warn("duplicate forward throttled", ctx);
          const r = await forward(forwardUrl, raw, req.headers.get("content-type") ?? "application/json");
          (r.ok ? log.log : log.warn)("forwarded", { ...ctx, ok: r.ok, status: r.status, error: r.error, ms: r.ms });
        })
        .catch((error) => log.error("forward failed", { ...ctx, error: String(error) })));
    }
    if (result.fresh && result.active !== false) {
      if (result.channels.length) {
        work.push(send(result.channels, { name: app.name }, event, fetcher)
          .then((deliveries) => deliveries.length ? deps.logDeliveries(app!, event, deliveries) : undefined)
          .catch((error) => log.error("alert dispatch failed", { ...ctx, error: String(error) })));
      }
      const devices = result.devices ?? [];
      if (devices.length && shouldPush(event, now())) {
        if (deps.push) {
          work.push(deps.push(devices, app, event)
            .then((r) => log.log("push", { ...ctx, sent: r.sent, failed: r.failed, invalid: r.invalidTokens.length }))
            .catch((error) => log.error("push failed", { ...ctx, error: String(error) })));
        } else {
          log.warn("push skipped: APNs not configured", ctx);
        }
      }
    } else if (result.fresh) {
      log.log("alerts paused: app beyond plan limit", ctx);
    }
    if (work.length) {
      const all = Promise.all(work);
      if (deps.waitUntil) deps.waitUntil(all);
      else await all;
    }
    return reply(200, result.fresh ? "Recorded" : "Duplicate ignored");
  };
}
