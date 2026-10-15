import { test } from "node:test";
import assert from "node:assert/strict";
import { createGoogleWebhook, type GoogleApp, type Deps } from "../supabase/functions/google-webhook/handler.ts";
import { GooglePushVerificationError } from "../supabase/functions/_shared/core/google_auth.ts";
import { GooglePlayPurchaseUnavailableError } from "../supabase/functions/_shared/core/google_play_api.ts";
import { silent } from "./helpers.ts";

const key = "a".repeat(32);
const now = Date.now();
const app: GoogleApp = { id: "app-1", name: "Timer", packageName: "com.example.timer", enabled: true,
  connectionVersion: "aaaaaaaa-0000-4000-8000-000000000001",
  audience: "https://api.example.com/functions/v1/google-webhook/" + key, serviceAccountEmail: "push@example.iam.gserviceaccount.com", subscription: "projects/example/subscriptions/salebell" };
const payload = (over = {}) => ({ version: "1.0", packageName: app.packageName, eventTimeMillis: String(now), subscriptionNotification: { version: "1.0", notificationType: 4, purchaseToken: "private-token" }, ...over });
const envelope = (data: unknown = payload(), over = {}) => ({ subscription: app.subscription, message: { messageId: "123456", data: Buffer.from(JSON.stringify(data)).toString("base64") }, ...over });
const post = (body: unknown = envelope(), path = key, authorization: string | null = "Bearer signed-google-token") => new Request(`https://internal/functions/v1/google-webhook/${path}`, {
  method: "POST", headers: authorization ? { authorization } : {}, body: typeof body === "string" ? body : JSON.stringify(body),
});
function harness(over: Partial<Deps> = {}) {
  const recorded: Parameters<Deps["record"]>[0][] = [], order: string[] = [], dispatched: string[] = [];
  const handler = createGoogleWebhook({
    lookupApp: async () => { order.push("app"); return app; },
    verifyPush: async (token, expected) => { order.push("verify"); assert.equal(token, "signed-google-token"); assert.equal(expected.audience, app.audience); assert.equal(expected.serviceAccountEmail, app.serviceAccountEmail); },
    isDuplicate: async () => { order.push("dedupe"); return false; },
    loadPreviousEnvironment: async () => null,
    loadPurchase: async (a, n) => { order.push("purchase"); assert.equal(a.packageName, app.packageName); assert.ok("purchaseToken" in n); return { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ productId: "premium" }] }; },
    record: async input => { order.push("record"); recorded.push(input); return { fresh: true, active: true, channels: [{ id: "channel-1", kind: "slack", config: {}, environments: ["Production"], events: null, enabled: true }], devices: [{ token: "a".repeat(64), environment: "production" }] }; },
    logDeliveries: async () => { order.push("log"); },
    dispatch: async (_channels, _app, e) => { order.push("dispatch"); dispatched.push(e.type); return [{ channelId: "channel-1", ok: true }]; },
    push: async () => { order.push("push"); return { sent: 1, failed: 0, invalidTokens: [] }; },
    now: () => now, log: silent, ...over,
  });
  return { handler, recorded, order, dispatched };
}

test("authenticates, enriches and persists before acknowledging Google and sending alerts", async () => {
  const h = harness();
  assert.equal((await h.handler(post())).status, 204);
  assert.deepEqual(h.order.slice(0, 5), ["app", "verify", "dedupe", "purchase", "record"]);
  assert.deepEqual(h.dispatched, ["purchase"]);
  assert.ok(h.order.includes("push"));
  assert.ok(h.order.includes("log"));
  assert.equal(h.recorded[0].event.revenue, null);
  assert.ok(!JSON.stringify(h.recorded).includes("private-token"));
});

test("invalid Google authentication never decodes, looks up purchases or records events", async () => {
  const h = harness({ verifyPush: async () => { throw new GooglePushVerificationError(); } });
  assert.equal((await h.handler(post("invalid JSON"))).status, 401);
  assert.equal((await h.handler(post(envelope(), key, null))).status, 401);
  assert.equal(h.recorded.length, 0);
  assert.ok(!h.order.includes("purchase"));
});

test("rejects wrong package, subscription, malformed bodies and future timestamps before API calls", async () => {
  const h = harness();
  for (const body of [envelope(payload({ packageName: "com.other.app" })), envelope(payload(), { subscription: "projects/other/subscriptions/stolen" }), "invalid JSON", envelope(payload({ eventTimeMillis: String(now + 3600000) }))]) {
    assert.ok([400, 403].includes((await h.handler(post(body))).status));
  }
  assert.equal((await h.handler(post("x".repeat(128 * 1024 + 1)))).status, 413);
  assert.ok(!h.order.includes("purchase"));
  assert.equal(h.recorded.length, 0);
});

test("validates routes and methods and rejects unknown or disabled connections", async () => {
  assert.equal((await harness().handler(post(envelope(), `${key}/production`))).status, 404);
  assert.equal((await harness().handler(new Request(`https://api/functions/v1/google-webhook/${key}`))).status, 405);
  assert.equal((await harness({ lookupApp: async () => null }).handler(post())).status, 404);
  assert.equal((await harness({ lookupApp: async () => ({ ...app, enabled: false }) }).handler(post())).status, 404);
});

test("previously durable duplicates skip API lookup and alerts", async () => {
  const h = harness({ isDuplicate: async () => true, loadPurchase: async () => { throw new Error("Google down"); } });
  assert.equal((await h.handler(post())).status, 204);
  assert.equal(h.recorded.length, 0);
  assert.deepEqual(h.dispatched, []);
});

test("concurrent duplicate records never repeat alerts", async () => {
  const h = harness({ record: async () => ({ fresh: false, channels: [] }) });
  assert.equal((await h.handler(post())).status, 204);
  assert.deepEqual(h.dispatched, []);
  assert.ok(!h.order.includes("push"));
});

test("lookup, key-fetch, duplicate check, Play API and persistence failures remain retryable", async () => {
  for (const dependency of ["lookupApp", "verifyPush", "isDuplicate", "loadPurchase", "record"] as const) {
    const h = harness({ [dependency]: async () => { throw new Error("private-token must not be logged"); } });
    assert.equal((await h.handler(post())).status, 503, dependency);
    assert.deepEqual(h.dispatched, []);
  }
});

test("delivery tests skip purchase lookup and remain separate from purchases", async () => {
  const h = harness();
  const data = { version: "1.0", packageName: app.packageName, eventTimeMillis: String(now), testNotification: { version: "1.0" } };
  assert.equal((await h.handler(post(envelope(data)))).status, 204);
  assert.ok(!h.order.includes("purchase"));
  assert.equal(h.recorded[0].event.type, "test");
});

test("late voided purchases can use a previously verified environment when Google returns 410", async () => {
  const data = { version: "1.0", packageName: app.packageName, eventTimeMillis: String(now), voidedPurchaseNotification: { purchaseToken: "private-token", orderId: "GPA.old", productType: 1, refundType: 1 } };
  const h = harness({ loadPurchase: async () => { throw new GooglePlayPurchaseUnavailableError(); },
    loadPreviousEnvironment: async (a, tokenHash) => { assert.equal(a.id, app.id); assert.match(tokenHash, /^[0-9a-f]{64}$/); return "Sandbox"; } });
  assert.equal((await h.handler(post(envelope(data)))).status, 204);
  assert.equal(h.recorded[0].event.type, "refund");
  assert.equal(h.recorded[0].event.environment, "Sandbox");
  assert.equal(h.recorded[0].event.productId, null);
  assert.equal(h.recorded[0].event.transactionId, "GPA.old");
  assert.equal(h.recorded[0].event.revenue, null);
  assert.deepEqual(h.recorded[0].notification.purchase, { lookupUnavailable: true });
  const unknown = harness({ loadPurchase: async () => { throw new GooglePlayPurchaseUnavailableError(); } });
  assert.equal((await unknown.handler(post(envelope(data)))).status, 503, "unknown environments must not be guessed");
  assert.equal(unknown.recorded.length, 0);
  assert.equal((await h.handler(post())).status, 503, "normal subscription errors still require an API lookup");
});

test("plan limits suppress alerts, while post-persistence fan-out failures never fail Google's request", async () => {
  const paused = harness({ record: async () => ({ fresh: true, active: false, channels: [], devices: [] }) });
  assert.equal((await paused.handler(post())).status, 204);
  assert.deepEqual(paused.dispatched, []);
  const failing = harness({ dispatch: async () => { throw new Error("channel down"); }, push: async () => { throw new Error("APNs down"); } });
  assert.equal((await failing.handler(post())).status, 204);
});

test("background fan-out does not delay acknowledgement and stale events do not push", async () => {
  const pending: Promise<unknown>[] = [];
  let release!: () => void;
  const h = harness({ waitUntil: p => pending.push(p), dispatch: () => new Promise(resolve => { release = () => resolve([]); }) });
  assert.equal((await h.handler(post())).status, 204);
  assert.equal(pending.length, 1);
  release();
  await pending[0];
  const stale = harness();
  assert.equal((await stale.handler(post(envelope(payload({ eventTimeMillis: String(now - 7 * 3600000) }))))).status, 204);
  assert.ok(!stale.order.includes("push"));
});
