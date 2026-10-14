import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { apnsConfigFromEnv, createApnsClient, createProviderToken, shouldPush, TOKEN_TTL_MS } from "../supabase/functions/_shared/core/apns.ts";
import type { StoreEvent } from "../supabase/functions/_shared/core/events.ts";
import { silent } from "./helpers.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const p8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const cfg = { keyP8: p8, keyId: "ABC123DEFG", teamId: "TEAM123456", topic: "com.salebell.salebell" };
const t0 = Date.parse("2026-10-09T12:00:00Z");
const event = (o: Partial<StoreEvent> = {}): StoreEvent => ({
  id: "6f1c1d5e-0000-4000-8000-000000000001", store: "app_store", environment: "Production", type: "purchase",
  occurredAt: new Date(t0).toISOString(), rawType: "ONE_TIME_CHARGE", rawSubtype: null, productId: "com.example.app.pro",
  transactionId: "T1", originalTransactionId: "T1", revenue: 4.99, currency: "USD", storefront: "USA", appUserId: null,
  isTrial: false, isFamilyShared: false, ...o,
});
const app = { id: "app-uuid-1", name: "Café Timer" };
const tok = (c: string) => c.repeat(64);
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

test("provider token is a verifiable ES256 JWT with kid, iss and iat", async () => {
  const jwt = await createProviderToken(cfg, t0);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(decode(h), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(decode(p), { iss: "TEAM123456", iat: t0 / 1000 });
  const sig = Buffer.from(s, "base64url");
  assert.equal(sig.length, 64, "raw r||s signature");
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig));
  // Pasted as one line with escaped newlines (how dashboards often store it) still works.
  const oneLine = await createProviderToken({ ...cfg, keyP8: p8.replace(/\n/g, "\\n") }, t0);
  const [h2, p2, s2] = oneLine.split(".");
  assert.ok(verify("sha256", Buffer.from(`${h2}.${p2}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s2, "base64url")));
});

function fakeApns(respond: (url: string) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(url); }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("sends alert pushes per device environment with sound and thread id", async () => {
  const { calls, fetcher } = fakeApns(() => new Response(null, { status: 200 }));
  const client = createApnsClient(cfg, fetcher, () => t0, silent);
  const r = await client.send([{ token: tok("a"), environment: "production" }, { token: tok("b"), environment: "sandbox" }], app, event());
  assert.deepEqual(r, { sent: 2, failed: 0, invalidTokens: [] });
  assert.deepEqual(calls.map((c) => c.url), [
    `https://api.push.apple.com/3/device/${tok("a")}`, `https://api.sandbox.push.apple.com/3/device/${tok("b")}`,
  ]);
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h["apns-topic"], "com.salebell.salebell");
  assert.equal(h["apns-push-type"], "alert");
  assert.match(h.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.aps.sound, "chaching.caf");
  assert.equal(body.aps["thread-id"], "app-uuid-1");
  assert.deepEqual([body.app_id, body.event_id, body.type], ["app-uuid-1", "6f1c1d5e-0000-4000-8000-000000000001", "purchase"]);
  assert.match(body.aps.alert.title, /^💰 Café Timer · US\$4\.99$/u);
  assert.equal(body.aps.alert.body, "Purchase · app.pro · USA");
});

test("410 and BadDeviceToken mark tokens invalid; other failures do not", async () => {
  const { fetcher } = fakeApns((url) => {
    if (url.endsWith(tok("a"))) return Response.json({ reason: "Unregistered" }, { status: 410 });
    if (url.endsWith(tok("b"))) return Response.json({ reason: "BadDeviceToken" }, { status: 400 });
    if (url.endsWith(tok("c"))) return Response.json({ reason: "TooManyRequests" }, { status: 429 });
    return new Response(null, { status: 200 });
  });
  const client = createApnsClient(cfg, fetcher, () => t0, silent);
  const devices = ["a", "b", "c", "d"].map((c) => ({ token: tok(c), environment: "production" as const }));
  const r = await client.send(devices, app, event());
  assert.deepEqual([r.sent, r.failed, r.invalidTokens.sort()], [1, 3, [tok("a"), tok("b")]]);
});

test("provider token is cached ~50 minutes, then refreshed", async () => {
  let now = t0;
  const { calls, fetcher } = fakeApns(() => new Response(null, { status: 200 }));
  const client = createApnsClient(cfg, fetcher, () => now, silent);
  const d = [{ token: tok("a"), environment: "production" as const }];
  const auth = () => (calls.at(-1)!.init.headers as Record<string, string>).authorization;
  await client.send(d, app, event());
  const first = auth();
  now += 49 * 60_000;
  await client.send(d, app, event());
  assert.equal(auth(), first, "reused within the TTL");
  now = t0 + TOKEN_TTL_MS + 1;
  await client.send(d, app, event());
  assert.notEqual(auth(), first, "refreshed after the TTL");
  assert.equal(decode(auth().split(" ")[1].split(".")[1]).iat, Math.floor(now / 1000));
});

test("network errors count as failures without throwing", async () => {
  const fetcher = (async () => { throw new Error("h2 reset"); }) as unknown as typeof fetch;
  const r = await createApnsClient(cfg, fetcher, () => t0, silent).send([{ token: tok("a"), environment: "sandbox" }], app, event());
  assert.deepEqual(r, { sent: 0, failed: 1, invalidTokens: [] });
});

test("push rules and config", () => {
  assert.equal(shouldPush(event(), t0), true);
  assert.equal(shouldPush(event({ type: "expired" }), t0), false);
  assert.equal(shouldPush(event({ occurredAt: "2026-10-01T00:00:00Z" }), t0), false, "no pushes for replays");
  assert.equal(shouldPush(event({ type: "test", occurredAt: "2026-10-01T00:00:00Z" }), t0), true);
  assert.equal(apnsConfigFromEnv(() => undefined), null);
  assert.deepEqual(apnsConfigFromEnv((k) => ({ APNS_KEY_P8: "k", APNS_KEY_ID: "i", APNS_TEAM_ID: "t", APNS_TOPIC: "b" })[k]),
    { keyP8: "k", keyId: "i", teamId: "t", topic: "b" });
});
