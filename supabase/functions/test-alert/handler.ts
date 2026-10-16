// POST {app_id, target?: "all" | "push", channel_id?}: sends a synthetic "test" event.
//   target "all" (default): the app's channels and the caller's own devices
//   target "push": only the caller's devices
//   channel_id: only that channel (no push)
// One attempt per channel (no retry schedule), 10 calls per minute per user.
// Any member of the app's account may call it.
import { type Channel, type Delivery, dispatch as defaultDispatch } from "../_shared/core/alerts.ts";
import type { PushDevice, PushResult } from "../_shared/core/apns.ts";
import type { StoreEvent } from "../_shared/core/events.ts";
import { bearer, browserFunction, json, readJson } from "../_shared/core/http.ts";
import type { AuthUser } from "../_shared/supabase.ts";

type Targets = { app: { id: string; name: string }; channels: Array<Channel & { active: boolean }>; devices: PushDevice[] };

export const RATE_LIMIT = { calls: 10, windowSeconds: 60 };

export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  /** null unless the user is a member of the app's account. */
  targets: (appId: string, userId: string) => Promise<Targets | null>;
  logDeliveries: (appId: string, eventId: string, deliveries: Delivery[]) => Promise<void>;
  /** Seconds until the caller may retry; 0 when allowed. */
  rateLimit: (userId: string) => Promise<number>;
  /** undefined when APNs is not configured. */
  push?: (devices: PushDevice[], app: { id: string; name: string }, e: StoreEvent) => Promise<PushResult>;
  dispatch?: typeof defaultDispatch;
  /** Guarded fetch for channel destinations. */
  fetcher?: typeof fetch;
  log?: Pick<Console, "error">;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function testEvent(now = new Date()): StoreEvent {
  return {
    id: crypto.randomUUID(), store: "app_store", environment: "Production", type: "test", occurredAt: now.toISOString(),
    rawType: "SALEBELL_TEST", rawSubtype: null, productId: null, transactionId: null, originalTransactionId: null,
    revenue: null, currency: null, storefront: null, appUserId: null, isTrial: false, isFamilyShared: false,
  };
}

export function createTestAlert(deps: Deps) {
  const send = deps.dispatch ?? defaultDispatch;
  return browserFunction(async (req) => {
    const user = await deps.getUser(bearer(req));
    if (!user) return json(401, { error: "unauthorized" });
    const { app_id, channel_id, target = "all" } = await readJson(req);
    if (typeof app_id !== "string" || !UUID.test(app_id)) return json(400, { error: "app_id required" });
    if (target !== "all" && target !== "push") return json(400, { error: "target must be all or push" });
    if (channel_id !== undefined && (typeof channel_id !== "string" || !UUID.test(channel_id))) {
      return json(400, { error: "channel_id must be a uuid" });
    }

    const retryAfter = await deps.rateLimit(user.id).catch((e) => {
      deps.log?.error("rate limit check failed", { error: String(e) });
      return null;
    });
    if (retryAfter === null || !Number.isFinite(retryAfter) || retryAfter < 0) return json(503, { error: "rate_limit_unavailable" });
    if (retryAfter > 0) {
      return json(429, { error: "rate_limited", retry_after: retryAfter }, { "retry-after": String(retryAfter) });
    }

    const targets = await deps.targets(app_id, user.id);
    if (!targets) return json(404, { error: "app not found" });
    let channels = targets.channels;
    let devices = targets.devices;
    if (target === "push") channels = [];
    if (channel_id) {
      channels = channels.filter((c) => c.id === channel_id);
      if (!channels.length) return json(404, { error: "channel not found" });
      devices = [];
    }

    const event = testEvent();
    // A test proves the channel works, so it ignores the channel's event/environment filters.
    const active = channels.filter((c) => c.active).map((c) => ({ ...c, events: null, environments: ["Production"] }));
    const paused: Delivery[] = channels.filter((c) => !c.active)
      .map((c) => ({ channelId: c.id, ok: false, error: "paused_on_free" }));
    const [sent, push] = await Promise.all([
      active.length ? send(active, { name: targets.app.name }, event, deps.fetcher ?? fetch, Date.now(), undefined, 0) : Promise.resolve([]),
      devices.length && deps.push
        ? deps.push(devices, targets.app, event)
        : Promise.resolve({ sent: 0, failed: 0, invalidTokens: [] } as PushResult),
    ]);
    if (sent.length) await deps.logDeliveries(app_id, event.id, sent).catch((e) => deps.log?.error("log failed", { error: String(e) }));
    return json(200, {
      deliveries: [...sent, ...paused].map(({ channelId, ok, status, error }) => ({ channelId, ok, status: status ?? null, error: error ?? null })),
      push: { sent: push.sent, failed: push.failed, ...(deps.push ? {} : { error: "push_not_configured" }) },
    });
  }, deps.log);
}
