import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createGooglePushVerifier, GooglePushVerificationError } from "../supabase/functions/_shared/core/google_auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "google-key", alg: "RS256", use: "sig" };
const t0 = Date.parse("2026-10-14T12:00:00Z");
const expected = { audience: "https://example.com/google-webhook", serviceAccountEmail: "pubsub@example.iam.gserviceaccount.com" };
const claims = { iss: "https://accounts.google.com", aud: expected.audience, email: expected.serviceAccountEmail,
  email_verified: true, iat: t0 / 1000 - 10, exp: t0 / 1000 + 3590 };
const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const input = `${enc({ alg: "RS256", kid: "google-key", typ: "JWT", ...header })}.${enc({ ...claims, ...overrides })}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
}
function keyServer(response: () => Response = () => Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=120" } })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return response(); }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test("Google push verifies a real RSA signature using only the fixed Google key endpoint", async () => {
  const server = keyServer();
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => t0 });
  await verify(jwt({}, { jku: "https://attacker.example/keys", x5u: "https://attacker.example/cert" }), expected);
  await verify(jwt({ iss: "accounts.google.com" }), expected);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].url, "https://www.googleapis.com/oauth2/v3/certs");
  assert.equal(server.calls[0].init?.redirect, "error");
  assert.ok(server.calls[0].init?.signal instanceof AbortSignal);
});

test("Google push rejects tampered RSA payloads and signatures", async () => {
  const server = keyServer();
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => t0 });
  const [header, payload, signature] = jwt().split(".");
  await assert.rejects(verify(`${header}.${enc({ ...claims, sub: "attacker" })}.${signature}`, expected), GooglePushVerificationError);
  await assert.rejects(verify(`${header}.${payload}.${Buffer.alloc(256).toString("base64url")}`, expected), GooglePushVerificationError);
});

test("Google push rejects wrong identity and invalid token times before requesting keys", async () => {
  const server = keyServer();
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => t0 });
  const invalidClaims = [
    { iss: "https://attacker.example" }, { aud: "https://wrong.example" }, { aud: [expected.audience] },
    { email: "other@example.iam.gserviceaccount.com" }, { email_verified: false }, { email_verified: "true" },
    { exp: t0 / 1000 }, { exp: "9999999999" }, { exp: null }, { iat: t0 / 1000 + 61 },
    { iat: -1 }, { iat: null }, { iat: t0 / 1000 + 30, exp: t0 / 1000 + 20 },
  ];
  for (const invalid of invalidClaims) await assert.rejects(verify(jwt(invalid), expected), GooglePushVerificationError, JSON.stringify(invalid));
  assert.equal(server.calls.length, 0);
});

test("Google push rejects malformed and unsupported JWTs without network requests", async () => {
  const server = keyServer();
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => t0 });
  for (const invalid of ["", "a.b", "a.b.c.d", "!!.??.**", "a".repeat(20_000), jwt({}, { alg: "none" }),
    jwt({}, { alg: "HS256" }), jwt({}, { kid: "" }), jwt({}, { crit: ["unrecognized"] }), jwt({}, { b64: false })]) {
    await assert.rejects(verify(invalid, expected), GooglePushVerificationError);
  }
  assert.equal(server.calls.length, 0);
});

test("Google push caches keys only until max-age minus Age and shares concurrent fetches", async () => {
  let now = t0;
  const server = keyServer(() => Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=120", age: "30" } }));
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => now });
  await Promise.all([verify(jwt(), expected), verify(jwt(), expected), verify(jwt(), expected)]);
  assert.equal(server.calls.length, 1);
  now += 89_000;
  await verify(jwt(), expected);
  assert.equal(server.calls.length, 1);
  now += 1000;
  await verify(jwt(), expected);
  assert.equal(server.calls.length, 2);
});

test("Google push obeys no-store and bounds excessively long key cache lifetime", async () => {
  const noStore = keyServer(() => Response.json({ keys: [jwk] }, { headers: { "cache-control": "no-store, max-age=999999" } }));
  const verifyUncached = createGooglePushVerifier({ fetcher: noStore.fetcher, now: () => t0 });
  await verifyUncached(jwt(), expected);
  await verifyUncached(jwt(), expected);
  assert.equal(noStore.calls.length, 2);
  let now = t0;
  const longCache = keyServer(() => Response.json({ keys: [jwk] }, { headers: { "cache-control": "max-age=999999" } }));
  const verify = createGooglePushVerifier({ fetcher: longCache.fetcher, now: () => now });
  await verify(jwt(), expected);
  now += 7 * 3600_000;
  await verify(jwt({ iat: now / 1000 - 10, exp: now / 1000 + 3590 }), expected);
  assert.equal(longCache.calls.length, 2);
});

test("Google push rejects unknown key IDs and does not refetch fresh keys for untrusted IDs", async () => {
  const server = keyServer();
  const verify = createGooglePushVerifier({ fetcher: server.fetcher, now: () => t0 });
  await verify(jwt(), expected);
  await assert.rejects(verify(jwt({}, { kid: "attacker-key" }), expected), GooglePushVerificationError);
  await assert.rejects(verify(jwt({}, { kid: "another-attacker-key" }), expected), GooglePushVerificationError);
  assert.equal(server.calls.length, 1);
});

test("Google key fetch outages and malformed key sets are sanitized retryable errors", async () => {
  const responses = [
    () => new Response("LEAKED_TOKEN", { status: 503 }),
    () => new Response(null, { status: 302, headers: { location: "https://attacker.example" } }),
    () => new Response("not JSON"), () => Response.json({ keys: [] }),
    () => Response.json({ keys: [{ ...jwk, n: "broken" }] }),
    () => Response.json({ keys: Array.from({ length: 33 }, (_, i) => ({ ...jwk, kid: `key-${i}` })) }),
    () => { throw new Error("LEAKED_TOKEN https://secret.example"); },
  ];
  for (const response of responses) {
    const verify = createGooglePushVerifier({ fetcher: keyServer(response).fetcher, now: () => t0 });
    await assert.rejects(verify(jwt(), expected), (error) => error instanceof Error && !(error instanceof GooglePushVerificationError)
      && !/LEAKED|secret|broken|https:/.test(String(error)));
  }
});
