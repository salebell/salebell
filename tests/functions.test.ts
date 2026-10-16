import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestAlert } from "../supabase/functions/test-alert/handler.ts";
import { generateKeyPairSync } from "node:crypto";
import { createAppleTest } from "../supabase/functions/apple-test/handler.ts";
import { createDeleteAccount, type SoleOwned } from "../supabase/functions/delete-account/handler.ts";
import { createFxRefresh, toUsdPerUnit } from "../supabase/functions/fx-refresh/handler.ts";
import type { Channel } from "../supabase/functions/_shared/core/alerts.ts";
import { silent } from "./helpers.ts";

const APP = "6f1c1d5e-0000-4000-8000-000000000001";
const req = (body: unknown, jwt: string | null = "good") => new Request("https://x/functions/v1/fn", {
  method: "POST", body: JSON.stringify(body), headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
});
const getUser = async (jwt: string | null) => (jwt === "good" ? { id: "user-1", email: "a@example.com" } : null);
const noLimit = async () => 0;

// ---------- test-alert ----------

test("test-alert sends a test event to active channels and the caller's devices", async () => {
  const ch = (id: string, active: boolean, o: Partial<Channel> = {}) =>
    ({ id, kind: "ntfy", name: null, config: { topic: id }, events: ["refund"], environments: ["Sandbox"], enabled: true, active, ...o }) as Channel & { active: boolean };
  const dispatched: { ids: string[]; type: string; envs: string[][]; retries: number | undefined }[] = [];
  const logged: unknown[] = [];
  const handler = createTestAlert({
    getUser,
    rateLimit: noLimit,
    targets: async (appId, userId) => appId === APP && userId === "user-1"
      ? { app: { id: APP, name: "Café Timer" }, channels: [ch("c1", true), ch("c2", false)], devices: [{ token: "a".repeat(64), environment: "sandbox" }] }
      : null,
    dispatch: async (channels, _app, e, _f, _n, _s, retries) => {
      dispatched.push({ ids: channels.map((c) => c.id), type: e.type, envs: channels.map((c) => c.environments), retries });
      return channels.map((c) => ({ channelId: c.id, ok: true, status: 200, attempts: 1 }));
    },
    push: async (devices, _app, e) => ({ sent: devices.length, failed: 0, invalidTokens: [], type: e.type }),
    logDeliveries: async (...args) => { logged.push(args); },
    log: silent,
  });
  const res = await handler(req({ app_id: APP }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    deliveries: [{ channelId: "c1", ok: true, status: 200, error: null }, { channelId: "c2", ok: false, status: null, error: "paused_on_free" }],
    push: { sent: 1, failed: 0 },
  });
  assert.deepEqual(dispatched, [{ ids: ["c1"], type: "test", envs: [["Production"]], retries: 0 }], "one attempt; filters ignored; paused skipped");
  assert.equal(logged.length, 1);

  assert.equal((await handler(req({ app_id: "6f1c1d5e-0000-4000-8000-000000000002" }))).status, 404, "not a member");
  assert.equal((await handler(req({ app_id: "nope" }))).status, 400);
  assert.equal((await handler(req({ app_id: APP }, null))).status, 401);
  assert.equal((await handler(req({ app_id: APP, target: "email" }))).status, 400);
});

test("test-alert target push sends only to the caller's devices", async () => {
  let dispatched = 0, pushed = 0;
  const handler = createTestAlert({
    getUser,
    rateLimit: noLimit,
    targets: async () => ({ app: { id: APP, name: "X" }, channels: [{ id: "c1", kind: "ntfy", name: null, config: { topic: "t" }, events: null, environments: ["Production"], enabled: true, active: true }], devices: [{ token: "a".repeat(64), environment: "production" }] }),
    dispatch: async (channels) => { dispatched += channels.length; return []; },
    push: async (devices) => { pushed += devices.length; return { sent: devices.length, failed: 0, invalidTokens: [] }; },
    logDeliveries: async () => {},
    log: silent,
  });
  assert.deepEqual(await (await handler(req({ app_id: APP, target: "push" }))).json(), { deliveries: [], push: { sent: 1, failed: 0 } });
  assert.deepEqual([dispatched, pushed], [0, 1]);
});

test("test-alert is rate limited per user and fails closed when the limiter errors", async () => {
  const keys: string[] = [];
  let calls = 0;
  const make = (rateLimit: (u: string) => Promise<number>) => createTestAlert({
    getUser,
    rateLimit,
    targets: async () => { calls++; return { app: { id: APP, name: "X" }, channels: [], devices: [] }; },
    logDeliveries: async () => {},
    log: silent,
  });
  const limited = await make(async (u) => { keys.push(u); return 42; })(req({ app_id: APP }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "42");
  assert.deepEqual(await limited.json(), { error: "rate_limited", retry_after: 42 });
  assert.deepEqual([keys, calls], [["user-1"], 0], "keyed by user, nothing sent");
  assert.equal((await make(async () => { throw new Error("db down"); })(req({ app_id: APP }))).status, 503);
  assert.equal(calls, 0, "limiter failure cannot fetch recipients or send alerts");
});

test("test-alert with channel_id tests only that channel and skips push", async () => {
  const C1 = "6f1c1d5e-0000-4000-8000-0000000000c1", C2 = "6f1c1d5e-0000-4000-8000-0000000000c2";
  const ch = (id: string) => ({ id, kind: "ntfy", name: null, config: { topic: id }, events: null, environments: ["Production"], enabled: true, active: true }) as Channel & { active: boolean };
  const dispatched: string[][] = [];
  let pushed = 0;
  const handler = createTestAlert({
    getUser,
    rateLimit: noLimit,
    targets: async () => ({ app: { id: APP, name: "X" }, channels: [ch(C1), ch(C2)], devices: [{ token: "a".repeat(64), environment: "production" }] }),
    dispatch: async (channels) => { dispatched.push(channels.map((c) => c.id)); return channels.map((c) => ({ channelId: c.id, ok: true, status: 200 })); },
    push: async (devices) => { pushed += devices.length; return { sent: devices.length, failed: 0, invalidTokens: [] }; },
    logDeliveries: async () => {},
    log: silent,
  });
  const res = await handler(req({ app_id: APP, channel_id: C2 }));
  assert.deepEqual(await res.json(), { deliveries: [{ channelId: C2, ok: true, status: 200, error: null }], push: { sent: 0, failed: 0 } });
  assert.deepEqual([dispatched, pushed], [[[C2]], 0]);
  assert.equal((await handler(req({ app_id: APP, channel_id: "6f1c1d5e-0000-4000-8000-0000000000c9" }))).status, 404, "channel of another app");
  assert.equal((await handler(req({ app_id: APP, channel_id: "nope" }))).status, 400);
});

test("test-alert reports when push is not configured", async () => {
  const handler = createTestAlert({
    getUser,
    rateLimit: noLimit,
    targets: async () => ({ app: { id: APP, name: "X" }, channels: [], devices: [{ token: "a".repeat(64), environment: "production" }] }),
    logDeliveries: async () => {},
    log: silent,
  });
  assert.deepEqual(await (await handler(req({ app_id: APP }))).json(), { deliveries: [], push: { sent: 0, failed: 0, error: "push_not_configured" } });
});

// ---------- delete-account ----------

function deletion(owned: SoleOwned[], cancel: ((id: string) => Promise<void>) | null) {
  const calls: string[] = [];
  const handler = createDeleteAccount({
    getUser,
    soleOwnedAccounts: async () => owned,
    cancelSubscription: cancel && (async (id) => { calls.push(`cancel:${id}`); await cancel(id); }),
    deleteAccounts: async (u) => { calls.push(`accounts:${u}`); return owned.length; },
    deleteUser: async (u) => { calls.push(`user:${u}`); },
    log: silent,
  });
  return { calls, handler };
}

test("delete-account cancels live subscriptions, then deletes accounts and the user", async () => {
  const h = deletion([
    { id: "a1", stripe_subscription_id: "sub_1", subscription_status: "active" },
    { id: "a2", stripe_subscription_id: "sub_2", subscription_status: "canceled" },
    { id: "a3", stripe_subscription_id: null, subscription_status: null },
  ], async () => {});
  const res = await h.handler(req({}));
  assert.deepEqual(await res.json(), { deleted: true, deleted_accounts: 3 });
  assert.deepEqual(h.calls, ["cancel:sub_1", "accounts:user-1", "user:user-1"]);
});

test("delete-account deletes nothing when cancelling fails", async () => {
  const h = deletion([{ id: "a1", stripe_subscription_id: "sub_1", subscription_status: "past_due" }], async () => { throw new Error("stripe down"); });
  assert.equal((await h.handler(req({}))).status, 502);
  assert.deepEqual(h.calls, ["cancel:sub_1"]);
  assert.equal((await deletion([], null).handler(req({}, "bad"))).status, 401);
  const free = deletion([{ id: "a1", stripe_subscription_id: null, subscription_status: null }], null);
  assert.equal((await free.handler(req({}))).status, 200, "Stripe config not needed without a subscription");
});

test("account deletion needs no Stripe for self-hosted accounts but preserves imported live subscription safety", async () => {
  const local = deletion([{ id: "local", stripe_subscription_id: null, subscription_status: null }], null);
  assert.equal((await local.handler(req({}))).status, 200);
  assert.deepEqual(local.calls, ["accounts:user-1", "user:user-1"]);

  const imported = deletion([{ id: "imported", stripe_subscription_id: "sub_live", subscription_status: "active" }], null);
  const res = await imported.handler(req({}));
  assert.deepEqual([res.status, (await res.json()).error], [503, "billing_not_configured"]);
  assert.deepEqual(imported.calls, []);
});

// ---------- fx-refresh ----------

test("fx-refresh converts to USD per unit, upserts, and is a no-op within 6 hours", async () => {
  const rates: Record<string, number> = { USD: 1, EUR: 0.8, JPY: 150, bad: 3, XXX: 0 };
  for (let i = 0; i < 120; i++) rates[`Q${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`] = 2;
  let last: string | null = null;
  let fetches = 0;
  const upserts: Record<string, number>[] = [];
  const now = Date.parse("2026-10-09T04:17:00Z");
  const handler = createFxRefresh({
    lastUpdated: async () => last,
    upsert: async (r) => { upserts.push(r); last = new Date(now).toISOString(); return Object.keys(r).length; },
    fetcher: (async (url: string) => { fetches++; assert.equal(url, "https://open.er-api.com/v6/latest/USD"); return Response.json({ result: "success", rates }); }) as unknown as typeof fetch,
    now: () => now,
    log: silent,
  });
  const first = await (await handler(new Request("https://x"))).json();
  assert.equal(first.refreshed, true);
  assert.deepEqual([upserts[0].USD, upserts[0].EUR, upserts[0].bad, upserts[0].XXX], [1, 1.25, undefined, undefined]);
  assert.ok(Math.abs(upserts[0].JPY - 1 / 150) < 1e-12);
  assert.equal((await (await handler(new Request("https://x"))).json()).refreshed, false);
  assert.equal(fetches, 1, "second call within 6h does not hit the source");
});

test("fx-refresh rejects a broken source without writing", async () => {
  let wrote = false;
  const handler = createFxRefresh({
    lastUpdated: async () => null,
    upsert: async () => { wrote = true; return 0; },
    fetcher: (async () => Response.json({ result: "error", "error-type": "quota" })) as unknown as typeof fetch,
    log: silent,
  });
  assert.equal((await handler(new Request("https://x"))).status, 502);
  assert.equal(wrote, false);
  assert.deepEqual(toUsdPerUnit({ EUR: 0.5, eur: 1, GBP: "x" }), { EUR: 2 });
});

// ---------- apple-test ----------

test("apple-test signs an App Store Server JWT and asks Apple for a TEST notification", async () => {
  const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const ISSUER = "57246542-96fe-1a63-e053-0824d011072a";
  const calls: { url: string; method: string; auth: string; redirect: RequestRedirect | undefined }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", auth: (init.headers as Record<string, string>).authorization, redirect: init.redirect });
    return String(url).endsWith("/test")
      ? Response.json({ testNotificationToken: "tok-1" })
      : Response.json({ firstSendAttemptResult: "SUCCESS" });
  }) as unknown as typeof fetch;
  const make = (f = fetcher) => createAppleTest({
    getUser, rateLimit: noLimit, fetcher: f, sleep: async () => {}, clock: () => 1_800_000_000_000, log: silent,
    bundleId: async (appId, userId) => appId === APP && userId === "user-1" ? "com.example.cafe" : null,
  });
  const body = { app_id: APP, environment: "sandbox", key_id: "ABCDE12345", issuer_id: ISSUER, private_key: p8 };

  const res = await make()(req(body));
  assert.deepEqual(await res.json(), { ok: true, delivery: "SUCCESS", attempts: [] });
  assert.equal(calls[0].url, "https://api.storekit-sandbox.apple.com/inApps/v1/notifications/test");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[1].url, "https://api.storekit-sandbox.apple.com/inApps/v1/notifications/test/tok-1");
  assert.deepEqual(calls.map((call) => call.redirect), ["error", "error"], "credential-bearing requests never follow redirects");
  const [h, p] = calls[0].auth.replace("Bearer ", "").split(".").slice(0, 2).map((x) => JSON.parse(Buffer.from(x, "base64url").toString()));
  assert.deepEqual(h, { alg: "ES256", kid: "ABCDE12345", typ: "JWT" });
  assert.deepEqual(p, { iss: ISSUER, iat: 1_800_000_000, exp: 1_800_000_300, aud: "appstoreconnect-v1", bid: "com.example.cafe" });

  await make()(req({ ...body, environment: "production" }));
  assert.equal(calls.at(-2)!.url, "https://api.storekit.apple.com/inApps/v1/notifications/test");

  const rejected = make((async () => new Response("", { status: 401 })) as unknown as typeof fetch);
  assert.deepEqual(await (await rejected(req(body))).json(), { ok: false, error: "apple_rejected_key" });

  const h2 = make();
  assert.equal((await h2(req({ ...body, app_id: "6f1c1d5e-0000-4000-8000-000000000002" }))).status, 404, "not a member");
  assert.equal((await h2(req({ ...body, private_key: "not a key" }))).status, 400);
  assert.equal((await h2(req({ ...body, key_id: "bad" }))).status, 400);
  assert.equal((await h2(req({ ...body, issuer_id: "bad" }))).status, 400);
  assert.equal((await h2(req({ ...body, environment: "prod" }))).status, 400);
  assert.equal((await h2(req(body, null))).status, 401);
});

test("apple-test uses a saved purchase-testing connection without returning its key", async () => {
  const credentialId = "cccccccc-0000-4000-8000-000000000001";
  const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const loaded: unknown[] = [];
  let sent = 0;
  const handler = createAppleTest({
    getUser, rateLimit: noLimit, log: silent, sleep: async () => {},
    bundleId: async () => "com.example.cafe",
    savedCredentials: async (...args) => {
      loaded.push(args);
      return { key_id: "ABCDE12345", issuer_id: "57246542-96fe-1a63-e053-0824d011072a", private_key: p8 };
    },
    fetcher: (async () => ++sent === 1 ? Response.json({ testNotificationToken: "token" }) : Response.json({ firstSendAttemptResult: "SUCCESS" })) as typeof fetch,
  });
  const res = await handler(req({ app_id: APP, environment: "sandbox", credential_id: credentialId }));
  assert.deepEqual(await res.json(), { ok: true, delivery: "SUCCESS", attempts: [] });
  assert.deepEqual(loaded, [[credentialId, APP, "user-1"]]);
  assert.equal(sent, 2);
});

test("apple-test prefers the latest modern send attempt over the deprecated initial result", async () => {
  const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const newer = 1_800_000_003_000, older = 1_800_000_000_000;
  let sent = 0;
  const handler = createAppleTest({
    getUser, rateLimit: noLimit, log: silent, sleep: async () => {}, bundleId: async () => "com.example.cafe",
    fetcher: (async () => ++sent === 1 ? Response.json({ testNotificationToken: "private-test-token" }) : Response.json({
      firstSendAttemptResult: "UNSUCCESSFUL_HTTP_RESPONSE_CODE",
      signedPayload: "private-signed-payload",
      sendAttempts: [
        { attemptDate: newer, sendAttemptResult: "SUCCESS", httpStatusCode: 200, responseBody: "private-response" },
        { attemptDate: older, sendAttemptResult: "UNSUCCESSFUL_HTTP_RESPONSE_CODE" },
      ],
    })) as typeof fetch,
  });
  const res = await handler(req({ app_id: APP, environment: "production", key_id: "ABCDE12345",
    issuer_id: "57246542-96fe-1a63-e053-0824d011072a", private_key: p8 }));
  assert.deepEqual(await res.json(), {
    ok: true, delivery: "SUCCESS", attempts: [
      { attemptDate: newer, sendAttemptResult: "SUCCESS" },
      { attemptDate: older, sendAttemptResult: "UNSUCCESSFUL_HTTP_RESPONSE_CODE" },
    ],
  }, "only attempt date/result are exposed; status bodies, tokens and payloads stay private");
});

test("apple-test bounds and sanitizes delivery metadata without mistaking missing status for success", async () => {
  const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const body = { app_id: APP, environment: "sandbox", key_id: "ABCDE12345",
    issuer_id: "57246542-96fe-1a63-e053-0824d011072a", private_key: p8 };
  const run = async (status: unknown, httpStatus = 200) => {
    let sent = 0;
    const handler = createAppleTest({
      getUser, rateLimit: noLimit, log: silent, sleep: async () => {}, bundleId: async () => "com.example.cafe",
      fetcher: (async () => ++sent === 1 ? Response.json({ testNotificationToken: "token" }) : Response.json(status, { status: httpStatus })) as typeof fetch,
    });
    return (await handler(req(body))).json();
  };

  assert.deepEqual(await run({ sendAttempts: [
    { attemptDate: -1, sendAttemptResult: "SUCCESS" },
    { attemptDate: "not-a-date", sendAttemptResult: "TLS_ISSUE" },
    { attemptDate: 1.5, sendAttemptResult: "private-arbitrary-value" },
    ...Array.from({ length: 6 }, () => ({ sendAttemptResult: "NO_RESPONSE" })),
  ], signedPayload: p8, firstSendAttemptResult: "SUCCESS" }), {
    ok: true, delivery: "NO_RESPONSE", attempts: [
      { attemptDate: null, sendAttemptResult: "SUCCESS" },
      { attemptDate: null, sendAttemptResult: "TLS_ISSUE" },
      { attemptDate: null, sendAttemptResult: "UNKNOWN" },
      { attemptDate: null, sendAttemptResult: "NO_RESPONSE" },
      { attemptDate: null, sendAttemptResult: "NO_RESPONSE" },
      { attemptDate: null, sendAttemptResult: "NO_RESPONSE" },
    ],
  });
  assert.deepEqual(await run({ sendAttempts: [], firstSendAttemptResult: "TIMED_OUT" }), { ok: true, delivery: "TIMED_OUT", attempts: [] }, "legacy status remains compatible");
  assert.deepEqual(await run({ sendAttempts: [null, 7, {}, []] }), { ok: true, delivery: null, attempts: [] });
  assert.deepEqual(await run(null), { ok: true, delivery: null, attempts: [] });
  assert.deepEqual(await run({ errorCode: 4040008 }, 404), { ok: true, delivery: null, attempts: [] }, "status may not be available yet");
});

test("deleted or unavailable saved testing keys cannot fall back to posted credentials", async () => {
  const body = { app_id: APP, environment: "sandbox", credential_id: "cccccccc-0000-4000-8000-000000000001",
    private_key: "do_not_use_this", key_id: "ABCDE12345", issuer_id: "57246542-96fe-1a63-e053-0824d011072a" };
  const make = (savedCredentials: NonNullable<Parameters<typeof createAppleTest>[0]["savedCredentials"]>) => createAppleTest({
    getUser, rateLimit: noLimit, log: silent, bundleId: async () => "com.example.cafe", savedCredentials,
    fetcher: (async () => { assert.fail("Deleted credentials must not contact Apple"); }) as typeof fetch,
  });
  const missing = await make(async () => null)(req(body));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "credential_not_found" });
  const unavailable = await make(async () => { throw new Error("sensitive_key_value"); })(req(body));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "credential_storage_unavailable" });
});
