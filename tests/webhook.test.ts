import { test } from "node:test";
import assert from "node:assert/strict";
import { type App, cachedLookup, createAppleWebhook, type Deps, DUPLICATE_FORWARDS, type RecordResult } from "../supabase/functions/apple-webhook/handler.ts";
import type { Channel, Delivery } from "../supabase/functions/_shared/core/alerts.ts";
import { b64, jws, silent, testRoots } from "./helpers.ts";

const KEY = "00000000000000000000000000000000"; // Synthetic webhook path, not a provider credential.
const app: App = { id: "app-1", name: "Café Timer", bundleId: "com.example.cafetimer", appleAppId: 1234567890, enabled: true };
const BT = app.bundleId;
const now = Date.now();
const tx = (o: object = {}) => jws({
  transactionId: "1", originalTransactionId: "1", bundleId: BT, productId: "com.example.cafetimer.premium.lifetime",
  purchaseDate: now, signedDate: now, environment: "Production", price: 499990, currency: "TRY", storefront: "TUR", ...o,
});
const notif = (data: object = {}, o: object = {}) => jws({
  notificationType: "ONE_TIME_CHARGE", notificationUUID: crypto.randomUUID(), signedDate: now,
  data: { bundleId: BT, environment: "Production", appAppleId: 1234567890, ...data }, ...o,
});
const post = (path: string, body: unknown) => new Request(`https://x.supabase.co/functions/v1/apple-webhook/${path}`,
  { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

function harness(over: Partial<Deps> = {}, channels: Channel[] = []) {
  const recorded: Parameters<Deps["record"]>[0][] = [];
  const logged: Delivery[][] = [];
  const dispatched: string[] = [];
  const handler = createAppleWebhook({
    roots: testRoots,
    log: silent,
    lookupApp: async (k) => (k === KEY ? app : null),
    record: async (input) => { recorded.push(input); return { fresh: true, channels }; },
    logDeliveries: async (_a, _e, d) => { logged.push(d); },
    dispatch: async (chs, _app, e) => { dispatched.push(e.type); return chs.map((c) => ({ channelId: c.id, ok: true })); },
    ...over,
  });
  return { handler, recorded, logged, dispatched };
}
const pushover: Channel = { id: "c1", kind: "pushover", config: {}, events: null, environments: ["Production"], enabled: true };

test("records a verified purchase and fans out alerts", async () => {
  const h = harness({}, [pushover]);
  const res = await h.handler(post(`${KEY}/production`, { signedPayload: notif({ signedTransactionInfo: tx() }) }));
  assert.equal(res.status, 200);
  assert.equal(h.recorded.length, 1);
  assert.equal(h.recorded[0].event.type, "purchase");
  assert.equal(h.recorded[0].event.revenue, 499.99);
  assert.equal(h.recorded[0].transaction?.transactionId, "1");
  assert.equal((h.recorded[0].notification.data as Record<string, unknown>).signedTransactionInfo, undefined, "no raw JWS stored");
  assert.deepEqual(h.dispatched, ["purchase"]);
  assert.equal(h.logged.length, 1);
});

test("duplicates are acknowledged and not re-alerted", async () => {
  const h = harness({ record: async () => ({ fresh: false, channels: [] }) }, [pushover]);
  const res = await h.handler(post(`${KEY}/production`, { signedPayload: notif() }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, "Duplicate ignored");
  assert.deepEqual(h.dispatched, []);
});

test("alert failures never fail Apple's delivery", async () => {
  const h = harness({ dispatch: async () => { throw new Error("pushover down"); } }, [pushover]);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200);
});

test("waitUntil receives background alert work", async () => {
  const pending: Promise<unknown>[] = [];
  const h = harness({ waitUntil: (p) => pending.push(p) }, [pushover]);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200);
  assert.equal(pending.length, 1);
  await pending[0];
  assert.equal(h.logged.length, 1);
});

test("unknown or disabled app keys are 404 without verifying", async () => {
  assert.equal((await harness().handler(post(`zzzzzzzzzzzz/production`, { signedPayload: notif() }))).status, 404);
  const disabled = harness({ lookupApp: async () => ({ ...app, enabled: false }) });
  assert.equal((await disabled.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 404);
  assert.equal((await harness().handler(post(`${KEY}/staging`, {}))).status, 404);
  assert.equal((await harness().handler(new Request(`https://x/functions/v1/apple-webhook/${KEY}/production`))).status, 405);
});

test("rejects another tenant's bundle, wrong environment, forged chains", async () => {
  const h = harness();
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif({ bundleId: "com.other" }) }))).status, 400);
  assert.equal((await h.handler(post(`${KEY}/sandbox`, { signedPayload: notif() }))).status, 400);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif({ appAppleId: 1 }) }))).status, 400);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif({ signedTransactionInfo: tx({ bundleId: "com.other" }) }) }))).status, 400);
  const forged = jws({ notificationType: "ONE_TIME_CHARGE", notificationUUID: crypto.randomUUID(), signedDate: now,
    data: { bundleId: BT, environment: "Production" } }, [b64("leaf"), b64("inter_evil")]);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: forged }))).status, 400);
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: "x".repeat(200_000) }))).status, 413);
  assert.equal(h.recorded.length, 0);
});

test("persistence and lookup failures return 503 so Apple retries", async () => {
  assert.equal((await harness({ record: async () => { throw new Error("db"); } }).handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 503);
  assert.equal((await harness({ lookupApp: async () => { throw new Error("db"); } }).handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 503);
});

test("summary notifications (no data) are accepted", async () => {
  const h = harness();
  const p = jws({ notificationType: "RENEWAL_EXTENSION", subtype: "SUMMARY", notificationUUID: crypto.randomUUID(), signedDate: now,
    summary: { bundleId: BT, environment: "Production", appAppleId: 1234567890 } });
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: p }))).status, 200);
  assert.equal(h.recorded[0].event.type, "renewal_extended");
});

// ---------- forwarding, push fan-out, plan gating ----------

const fwdApp: App = { ...app, forwardUrlProduction: "https://api.example.com/apple", forwardUrlSandbox: null };
const device = { token: "a".repeat(64), environment: "production" as const };

function full(over: Partial<Deps> = {}, result: Partial<RecordResult> = {}) {
  const forwarded: { url: string; body: string; contentType: string }[] = [];
  const pushed: { tokens: string[]; type: string }[] = [];
  const h = harness({
    lookupApp: async (k) => (k === KEY ? fwdApp : null),
    record: async () => ({ fresh: true, active: true, channels: [pushover], devices: [device], ...result }),
    forward: async (url, body, contentType) => { forwarded.push({ url, body, contentType }); return { ok: true, status: 200, ms: 1 }; },
    push: async (devices, _app, e) => { pushed.push({ tokens: devices.map((d) => d.token), type: e.type }); return { sent: devices.length, failed: 0, invalidTokens: [] }; },
    ...over,
  });
  return { ...h, forwarded, pushed };
}
const postRaw = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`https://x.supabase.co/functions/v1/apple-webhook/${path}`, { method: "POST", body, headers });

test("forwards the raw body unchanged to the environment's URL", async () => {
  const h = full();
  const body = JSON.stringify({ signedPayload: notif() }) + "\n";
  const res = await h.handler(postRaw(`${KEY}/production`, body, { "content-type": "application/json; charset=utf-8" }));
  assert.equal(res.status, 200);
  assert.deepEqual(h.forwarded, [{ url: "https://api.example.com/apple", body, contentType: "application/json; charset=utf-8" }]);
});

test("forwards duplicates, but never unverified, unconfigured or already-forwarded requests", async () => {
  const dup = full({}, { fresh: false, channels: [], devices: [] });
  await dup.handler(post(`${KEY}/production`, { signedPayload: notif() }));
  assert.equal(dup.forwarded.length, 1, "Apple retry of a recorded event still reaches the developer");
  assert.deepEqual([dup.dispatched, dup.pushed], [[], []]);

  const h = full();
  await h.handler(post(`${KEY}/production`, { signedPayload: notif({ bundleId: "com.other" }) }));
  await h.handler(postRaw(`${KEY}/production`, JSON.stringify({ signedPayload: notif() }), { "x-salebell-forwarded": "1" }));
  assert.equal(h.forwarded.length, 0, "rejected payloads and forwarding loops are not forwarded");

  const sandbox = jws({ notificationType: "TEST", notificationUUID: crypto.randomUUID(), signedDate: now,
    data: { bundleId: BT, environment: "Sandbox" } });
  await h.handler(post(`${KEY}/sandbox`, { signedPayload: sandbox }));
  assert.equal(h.forwarded.length, 0, "no sandbox forward URL configured");
});

test("Apple retries of one notification are forwarded at most DUPLICATE_FORWARDS times", async () => {
  const budget = new Map<string, number>();
  const keys: string[] = [];
  const allowDuplicateForward = async (appId: string, uuid: string) => {
    keys.push(`${appId}:${uuid}`);
    const used = (budget.get(uuid) ?? 0) + 1;
    budget.set(uuid, used);
    return used <= DUPLICATE_FORWARDS.max;
  };
  const dup = full({ allowDuplicateForward }, { fresh: false, channels: [], devices: [] });
  const body = { signedPayload: notif() };
  for (let i = 0; i < 5; i++) await dup.handler(post(`${KEY}/production`, body));
  assert.equal(dup.forwarded.length, 3);
  assert.equal(new Set(keys).size, 1, "budget is per app and notificationUUID");

  const fresh = full({ allowDuplicateForward: async () => false });
  await fresh.handler(post(`${KEY}/production`, { signedPayload: notif() }));
  assert.equal(fresh.forwarded.length, 1, "first delivery is never throttled");

  const broken = full({ allowDuplicateForward: async () => { throw new Error("db"); } }, { fresh: false, channels: [], devices: [] });
  await broken.handler(post(`${KEY}/production`, { signedPayload: notif() }));
  assert.equal(broken.forwarded.length, 1, "fails open");
});

test("app lookups cache hits only, bounded", async () => {
  const loads: string[] = [];
  let t = 0;
  const lookup = cachedLookup(async (k) => { loads.push(k); return k.startsWith("good") ? { ...fwdApp, id: k } : null; },
    { ttlMs: 1000, max: 2, now: () => t });
  await lookup("good1"); await lookup("good1");
  await lookup("miss"); await lookup("miss");
  assert.deepEqual(loads, ["good1", "miss", "miss"], "misses are not cached");
  await lookup("good2"); await lookup("good3"); // evicts good1
  await lookup("good1");
  t = 1001;
  await lookup("good1");
  assert.deepEqual(loads.slice(3), ["good2", "good3", "good1", "good1"], "bounded and expires");
});

test("forward failures and slow servers never change Apple's response", async () => {
  const h = full({ forward: async () => { throw new Error("boom"); } });
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200);
  const persistFail = full({ record: async () => { throw new Error("db"); } });
  assert.equal((await persistFail.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 503);
  assert.equal(persistFail.forwarded.length, 0, "not forwarded until recorded (Apple retries)");

  const pending: Promise<unknown>[] = [];
  let release!: () => void;
  const slow = full({
    waitUntil: (p) => pending.push(p),
    forward: () => new Promise((r) => { release = () => r({ ok: true, status: 200, ms: 10_000 }); }),
  });
  assert.equal((await slow.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200, "responds before the forward finishes");
  assert.equal(pending.length, 1);
  release();
  await pending[0];
});

test("pushes fresh money events to the returned devices", async () => {
  const h = full();
  await h.handler(post(`${KEY}/production`, { signedPayload: notif({ signedTransactionInfo: tx() }) }));
  assert.deepEqual(h.pushed, [{ tokens: [device.token], type: "purchase" }]);
  assert.deepEqual(h.dispatched, ["purchase"]);
});

test("no push for quiet event types or when APNs is not configured", async () => {
  const quiet = full();
  const expired = jws({ notificationType: "EXPIRED", subtype: "VOLUNTARY", notificationUUID: crypto.randomUUID(), signedDate: now,
    data: { bundleId: BT, environment: "Production", appAppleId: 1234567890 } });
  await quiet.handler(post(`${KEY}/production`, { signedPayload: expired }));
  assert.deepEqual(quiet.pushed, []);

  const unconfigured = full({ push: undefined });
  assert.equal((await unconfigured.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200);
  assert.deepEqual(unconfigured.dispatched, ["purchase"], "channels still alerted");
});

test("apps beyond the plan limit record and forward, but alerts and pushes pause", async () => {
  const h = full({}, { active: false });
  const res = await h.handler(post(`${KEY}/production`, { signedPayload: notif() }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).message, "Recorded");
  assert.equal(h.forwarded.length, 1, "forwarding is on every plan");
  assert.deepEqual([h.dispatched, h.pushed], [[], []]);
});

test("push failures never fail Apple's delivery", async () => {
  const h = full({ push: async () => { throw new Error("apns down"); } });
  assert.equal((await h.handler(post(`${KEY}/production`, { signedPayload: notif() }))).status, 200);
  assert.deepEqual(h.dispatched, ["purchase"]);
});
