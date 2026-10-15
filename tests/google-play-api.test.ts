import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createGooglePlayClient, GooglePlayPurchaseUnavailableError } from "../supabase/functions/_shared/core/google_play_api.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const private_key = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const credentials = { client_email: "play@example.iam.gserviceaccount.com", private_key, private_key_id: "play-key" };
const t0 = Date.parse("2026-10-14T12:00:00Z");
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

test("Play client distinguishes expired purchase tokens without exposing their value", async () => {
  for (const status of [404, 410, 503]) {
    const server = apiServer(url => url === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 })
      : new Response("private-token", { status }));
    const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
    await assert.rejects(client.getSubscription("com.example", "private-token"), error => {
      assert.equal(error instanceof GooglePlayPurchaseUnavailableError, status === 410);
      assert.ok(!String(error).includes("private-token"));
      return true;
    });
  }
});
function apiServer(respond: (url: string, init?: RequestInit) => Response | Promise<Response> = (url) =>
  url === "https://oauth2.googleapis.com/token"
    ? Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 })
    : Response.json({ kind: "purchase", orderId: "GPA.1234" })) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return await respond(String(url), init); }) as unknown as typeof fetch;
  return { fetcher, calls };
}

test("Play client exchanges a verifiable scoped RS256 assertion and uses both v2 purchase endpoints", async () => {
  const server = apiServer();
  const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
  assert.deepEqual(await client.getSubscription("com.example/app", "purchase/+?token#"), { kind: "purchase", orderId: "GPA.1234" });
  assert.deepEqual(await client.getProduct("com.example/app", "purchase/+?token#"), { kind: "purchase", orderId: "GPA.1234" });
  assert.deepEqual(server.calls.map((call) => call.url), [
    "https://oauth2.googleapis.com/token",
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example%2Fapp/purchases/subscriptionsv2/tokens/purchase%2F%2B%3Ftoken%23",
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example%2Fapp/purchases/productsv2/tokens/purchase%2F%2B%3Ftoken%23",
  ]);
  const tokenRequest = server.calls[0].init!;
  assert.equal(tokenRequest.method, "POST");
  assert.equal(new Headers(tokenRequest.headers).get("content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(tokenRequest.body as string);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, payload, signature] = form.get("assertion")!.split(".");
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT", kid: "play-key" });
  assert.deepEqual(decode(payload), { iss: credentials.client_email, scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token", iat: t0 / 1000, exp: t0 / 1000 + 3600 });
  assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")));
  for (const call of server.calls) {
    assert.equal(call.init?.redirect, "error");
    assert.ok(call.init?.signal instanceof AbortSignal);
  }
  for (const call of server.calls.slice(1)) {
    assert.equal(call.init?.method, "GET");
    assert.equal(new Headers(call.init?.headers).get("authorization"), "Bearer oauth-secret");
  }
});

test("Play client caches OAuth tokens, refreshes before expiry and shares concurrent exchanges", async () => {
  let now = t0, exchanges = 0;
  const server = apiServer((url) => url === "https://oauth2.googleapis.com/token"
    ? Response.json({ access_token: `oauth-${++exchanges}`, token_type: "Bearer", expires_in: 3600 }) : Response.json({ orderId: "GPA.1" }));
  const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => now });
  await Promise.all([client.getProduct("com.example", "one"), client.getSubscription("com.example", "two")]);
  now += 3500_000;
  await client.getProduct("com.example", "three");
  assert.equal(exchanges, 1);
  now += 40_000;
  await client.getProduct("com.example", "four");
  assert.equal(exchanges, 2);
  assert.equal(new Headers(server.calls.at(-1)!.init?.headers).get("authorization"), "Bearer oauth-2");
});

test("Play client retrieves charged order details with escaped identifiers and shared OAuth", async () => {
  const server = apiServer();
  const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
  await client.getProduct("com.example/app", "token");
  assert.deepEqual(await client.getOrder("com.example/app", "GPA.order/+?#"), { kind: "purchase", orderId: "GPA.1234" });
  assert.equal(server.calls.length, 3);
  assert.equal(server.calls[2].url, "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example%2Fapp/orders/GPA.order%2F%2B%3F%23");
  assert.equal(new Headers(server.calls[2].init?.headers).get("authorization"), "Bearer oauth-secret");
});

test("order failures never leak purchase tokens, customer data or upstream errors", async () => {
  for (const status of [401, 403, 404, 410, 429, 503]) {
    const server = apiServer(url => url === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 })
      : new Response("PRIVATE_CUSTOMER", { status }));
    const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
    await assert.rejects(client.getOrder("com.example", "GPA.PRIVATE_ORDER"), error => error instanceof Error
      && !/PRIVATE|oauth-secret|https:/.test(String(error)));
  }
});

test("Play client accepts service-account PEMs with escaped newlines and no key ID", async () => {
  const server = apiServer();
  const client = createGooglePlayClient({ client_email: credentials.client_email, private_key: private_key.replace(/\n/g, "\\n") },
    { fetcher: server.fetcher, now: () => t0 });
  await client.getProduct("com.example", "token");
  const assertion = new URLSearchParams(server.calls[0].init?.body as string).get("assertion")!;
  assert.deepEqual(decode(assertion.split(".")[0]), { alg: "RS256", typ: "JWT" });
});

test("Play client treats every failed purchase lookup as retryable without exposing tokens or response bodies", async () => {
  for (const status of [302, 400, 401, 403, 404, 429, 500, 503]) {
    const server = apiServer((url) => url === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 })
      : new Response("PRIVATE_RESPONSE", { status }));
    const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
    await assert.rejects(client.getProduct("com.example", "PRIVATE_PURCHASE_TOKEN"), (error) => error instanceof Error
      && !/PRIVATE|oauth-secret|https:/.test(String(error)));
  }
});

test("Play client sanitizes failed OAuth exchanges and invalid success payloads", async () => {
  const responses = [
    () => new Response("PRIVATE_RESPONSE", { status: 401 }), () => new Response(null, { status: 302 }),
    () => new Response("not JSON"), () => Response.json({ access_token: "oauth-secret" }),
    () => Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 0 }),
    () => Response.json({ access_token: "oauth-secret", token_type: "Basic", expires_in: 3600 }),
    () => { throw new Error("PRIVATE_RESPONSE https://example.com/?token=oauth-secret"); },
  ];
  for (const response of responses) {
    const server = apiServer(response);
    const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
    await assert.rejects(client.getSubscription("com.example", "PRIVATE_PURCHASE_TOKEN"), (error) => error instanceof Error
      && !/PRIVATE|oauth-secret|https:/.test(String(error)));
    assert.equal(server.calls.length, 1);
  }
});

test("Play client retries a failed exchange on the next lookup and discards rejected access tokens", async () => {
  let exchanges = 0, lookups = 0;
  const server = apiServer((url) => {
    if (url === "https://oauth2.googleapis.com/token") {
      exchanges++;
      return exchanges === 1 ? new Response("unavailable", { status: 503 })
        : Response.json({ access_token: `oauth-${exchanges}`, token_type: "Bearer", expires_in: 3600 });
    }
    return ++lookups === 1 ? new Response("unauthorized", { status: 401 }) : Response.json({ orderId: "GPA.1" });
  });
  const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
  await assert.rejects(client.getProduct("com.example", "token"));
  await assert.rejects(client.getProduct("com.example", "token"));
  assert.deepEqual(await client.getProduct("com.example", "token"), { orderId: "GPA.1" });
  assert.equal(exchanges, 3);
});

test("Play client sanitizes malformed credentials, invalid purchase payloads and network failures", async () => {
  const server = apiServer();
  const client = createGooglePlayClient({ ...credentials, private_key: "PRIVATE_KEY_BAD" }, { fetcher: server.fetcher, now: () => t0 });
  await assert.rejects(client.getProduct("com.example", "PRIVATE_TOKEN"), (error) => error instanceof Error && !/PRIVATE/.test(String(error)));
  assert.equal(server.calls.length, 0);
  for (const response of [() => Response.json([]), () => Response.json(null), () => new Response("not JSON"),
    () => { throw new Error("PRIVATE_TOKEN https://example.com"); }]) {
    const server = apiServer((url) => url === "https://oauth2.googleapis.com/token"
      ? Response.json({ access_token: "oauth-secret", token_type: "Bearer", expires_in: 3600 }) : response());
    const client = createGooglePlayClient(credentials, { fetcher: server.fetcher, now: () => t0 });
    await assert.rejects(client.getProduct("com.example", "PRIVATE_TOKEN"), (error) => error instanceof Error
      && !/PRIVATE|oauth-secret|https:/.test(String(error)));
  }
});
