import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createPushDelivery } from "../supabase/functions/_shared/core/push-delivery.ts";
import { testEvent, createTestAlert } from "../supabase/functions/test-alert/handler.ts";

const app = { id: "10000000-0000-4000-8000-000000000001", name: "Timer" };
const capability = "a".repeat(64);
const device = { token: capability, environment: "production" as const, transport: "relay" as const };
const env = (values: Record<string, string> = {}) => (name: string) => values[name];
const db = { rpc: async <T>() => [] as T };
const key = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const apnsEnv = { APNS_KEY_P8: key, APNS_KEY_ID: "KEY", APNS_TEAM_ID: "TEAM", APNS_TOPIC: "app.test" };

test("relay works without APNs credentials and sends one capability per bounded request", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const push = createPushDelivery(env(), db, async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json({ sent: 1, failed: 0 });
  })!;
  const event = testEvent();
  assert.deepEqual(await push([device, { ...device, token: "b".repeat(64) }], app, event), { sent: 2, failed: 0, invalidTokens: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://salebell.vercel.app/api/push-relay");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { action: "deliver", capability, notification_id: event.id, title: "🔔 Timer", body: "Salebell test alert" });
  assert.equal(calls[0].init?.redirect, "error");
});

test("invalid capability and unknown transports fail without a network request", async () => {
  const push = createPushDelivery(env(), db, async () => { throw new Error("must not fetch"); })!;
  assert.deepEqual(await push([{ ...device, token: "not-a-capability" }, { ...device, transport: "other" } as never], app, testEvent()), { sent: 0, failed: 2, invalidTokens: [] });
});

test("relay rejections, malformed acknowledgements and network failures never fall back to APNs", async () => {
  for (const response of [() => Response.json({ error: "revoked" }, { status: 403 }), () => Response.json({ sent: 2, failed: 0 }), () => new Response("bad json"), () => { throw new Error("offline"); }]) {
    let calls = 0;
    const push = createPushDelivery(env(apnsEnv), db, async () => { calls++; return response(); })!;
    assert.deepEqual(await push([device], app, testEvent()), { sent: 0, failed: 1, invalidTokens: [] });
    assert.equal(calls, 1);
  }
});

test("mixed transports remain separate and dead direct tokens are disabled", async () => {
  const disabled: unknown[] = [];
  const push = createPushDelivery(env(apnsEnv), { rpc: async <T>(name: string, args: unknown) => { disabled.push([name, args]); return 1 as T; } }, async url => String(url).includes("push-relay") ? Response.json({ sent: 1, failed: 0 }) : Response.json({ reason: "BadDeviceToken" }, { status: 400 }))!;
  assert.deepEqual(await push([device, { token: "c".repeat(64), environment: "sandbox" }], app, testEvent()), { sent: 1, failed: 1, invalidTokens: ["c".repeat(64)] });
  assert.deepEqual(disabled, [["disable_push_devices", { p_tokens: ["c".repeat(64)] }]]);
});

test("managed shared app blocks every legacy direct registration, including phones not yet enrolled", async () => {
  const urls: string[] = [];
  const push = createPushDelivery(env({ ...apnsEnv, SALEBELL_PUSH_RELAY_ENABLED: "true" }), { rpc: async <T>(name: string, args: Record<string, unknown>) => { assert.equal(name, "relay_owned_tokens"); assert.deepEqual(args, { p_tokens: ["b".repeat(64), "c".repeat(64)] }); return ["b".repeat(64)] as T; } }, async url => { urls.push(String(url)); return new Response(null); })!;
  assert.deepEqual(await push([{ token: "b".repeat(64), environment: "production" }, { token: "c".repeat(64), environment: "production", transport: "apns" }], app, testEvent()), { sent: 0, failed: 2, invalidTokens: [] });
  assert.equal(urls.length, 0);
});

test("managed legacy sends stay blocked without depending on token inventory availability", async () => {
  for (const result of [null, {}, "bad", "throw"]) {
    const urls: string[] = [];
    const push = createPushDelivery(env({ ...apnsEnv, SALEBELL_PUSH_RELAY_ENABLED: "true" }), { rpc: async <T>() => { if (result === "throw") throw new Error("db unavailable"); return result as T; } }, async url => { urls.push(String(url)); return Response.json({ sent: 1, failed: 0 }); })!;
    assert.deepEqual(await push([device, { token: "b".repeat(64), environment: "production" }], app, testEvent()), { sent: 1, failed: 1, invalidTokens: [] });
    assert.deepEqual(urls, ["https://salebell.vercel.app/api/push-relay"]);
  }
});

test("operator relay URL rejects insecure or credential-bearing destinations", () => {
  for (const url of ["http://example.com/relay", "https://secret@example.com/relay", "https://example.com/relay#secret", "invalid"]) {
    assert.throws(() => createPushDelivery(env({ SALEBELL_PUSH_RELAY_URL: url }), db));
  }
});

test("oversized relay acknowledgement is cancelled instead of consuming an unbounded response", async () => {
  let cancelled = false;
  let reads = 0;
  const push = createPushDelivery(env(), db, async () => new Response(new ReadableStream({
    pull(controller) { if (reads++ < 3) controller.enqueue(new Uint8Array(2048)); else controller.close(); },
    cancel() { cancelled = true; },
  })))!;
  assert.deepEqual(await push([device], app, testEvent()), { sent: 0, failed: 1, invalidTokens: [] });
  assert.equal(cancelled, true);
});

test("test alert limiter outage fails closed before targets or dispatch", async () => {
  const handler = createTestAlert({ getUser: async () => ({ id: app.id }), rateLimit: async () => { throw new Error("private db detail"); }, targets: async () => { throw new Error("must not fetch targets"); }, logDeliveries: async () => {} });
  const response = await handler(new Request("https://backend/test-alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ app_id: app.id }) }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "rate_limit_unavailable" });
});
