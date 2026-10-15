import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { GoogleSetupError } from "../supabase/functions/_shared/core/google_cloud.ts";
import { discoverGooglePlayApps } from "../supabase/functions/_shared/core/google_play_discovery.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = { type: "service_account", project_id: "example-project", client_email: "play@example-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), private_key_id: "example-key" };
const oauthUrl = "https://oauth2.googleapis.com/token";
const searchUrl = "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search?pageSize=100";
const t0 = Date.parse("2026-10-14T12:00:00Z");
const app = { name: "apps/1234567890123456789", packageName: "com.example.app", displayName: "Example App" };
type Call = { url: string; init?: RequestInit };
function server(respond: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init }; calls.push(call);
    return respond(call) ?? (call.url === oauthUrl
      ? Response.json({ access_token: "PRIVATE_ACCESS_TOKEN", token_type: "Bearer", expires_in: 3600 })
      : Response.json({ apps: [app] }));
  }) as typeof fetch;
  return { fetcher, calls };
}
async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof GoogleSetupError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.ok(!/PRIVATE|https:/.test(String(error)));
    return true;
  });
}

test("Play discovery exchanges a verifiable reporting-scoped assertion and returns allowlisted Unicode app metadata", async () => {
  const fake = server(call => call.url === searchUrl ? Response.json({ apps: [{ ...app, displayName: "  Café 日本語 🚀  ", private_key: "PRIVATE" }], nextPageToken: "opaque/+?= next 🚀" }) : undefined);
  assert.deepEqual(await discoverGooglePlayApps({ ...credentials, token_uri: "https://evil.example/token" } as typeof credentials, undefined,
    { fetcher: fake.fetcher, now: () => t0 }), { apps: [{ package_name: "com.example.app", display_name: "Café 日本語 🚀" }], next_cursor: "opaque/+?= next 🚀" });
  assert.deepEqual(fake.calls.map(call => call.url), [oauthUrl, searchUrl]);
  const form = new URLSearchParams(String(fake.calls[0].init?.body));
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, claims, signature] = form.get("assertion")!.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT", kid: "example-key" });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/playdeveloperreporting", aud: oauthUrl, iat: t0 / 1000, exp: t0 / 1000 + 3600 });
  assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")));
  assert.equal(fake.calls[1].init?.method, "GET");
  assert.equal(fake.calls[1].init?.body, undefined);
  assert.equal(new Headers(fake.calls[1].init?.headers).get("authorization"), "Bearer PRIVATE_ACCESS_TOKEN");
  for (const call of fake.calls) { assert.equal(call.init?.redirect, "error"); assert.ok(call.init?.signal instanceof AbortSignal); }
});

test("Play discovery keeps opaque pagination values in the query and never follows a cursor URL", async () => {
  const cursor = "https://evil.example/path?value=+/= 🚀#fragment";
  const fake = server();
  await discoverGooglePlayApps(credentials, cursor, { fetcher: fake.fetcher, now: () => t0 });
  assert.equal(fake.calls[1].url, searchUrl + "&pageToken=https%3A%2F%2Fevil.example%2Fpath%3Fvalue%3D%2B%2F%3D+%F0%9F%9A%80%23fragment");
  assert.equal(new URL(fake.calls[1].url).searchParams.get("pageToken"), cursor);
  const maximumCursor = "a".repeat(4096);
  const maximum = server();
  await discoverGooglePlayApps(credentials, maximumCursor, { fetcher: maximum.fetcher, now: () => t0 });
  assert.equal(new URL(maximum.calls[1].url).searchParams.get("pageToken"), maximumCursor);
});

test("Play discovery handles empty protobuf responses and service-account PEMs with escaped newlines", async () => {
  for (const body of [{}, { apps: [] }, { apps: [], nextPageToken: "" }]) {
    const fake = server(call => call.url === searchUrl ? Response.json(body) : undefined);
    const { private_key_id: _keyId, ...key } = credentials;
    assert.deepEqual(await discoverGooglePlayApps({ ...key, private_key: key.private_key.replace(/\n/g, "\\n") }, undefined,
      { fetcher: fake.fetcher, now: () => t0 }), { apps: [], next_cursor: null });
  }
});

test("Play discovery rejects invalid credentials and cursor inputs before contacting Google", async () => {
  for (const variant of [{ type: "authorized_user" }, { project_id: "../PRIVATE" }, { client_email: "person@example.com" },
    { private_key: "PRIVATE_BAD_KEY" }, { private_key_id: "PRIVATE/invalid" }]) {
    const fake = server();
    await rejectsCode(discoverGooglePlayApps({ ...credentials, ...variant }, undefined, { fetcher: fake.fetcher, now: () => t0 }), "google_invalid_credentials");
    assert.equal(fake.calls.length, 0);
  }
  for (const cursor of ["", "a".repeat(4097), "PRIVATE\nnext", "PRIVATE\u0000next", "PRIVATE\u007fnext"]) {
    const fake = server();
    await rejectsCode(discoverGooglePlayApps(credentials, cursor, { fetcher: fake.fetcher, now: () => t0 }), "google_invalid_cursor");
    assert.equal(fake.calls.length, 0);
  }
});

test("Play discovery classifies structured API-disabled errors and hides every upstream detail", async () => {
  for (const [status, body, code] of [
    [403, { error: { message: "PRIVATE SERVICE_DISABLED https://evil.example" } }, "google_api_permission_denied"],
    [403, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com" }] } }, "google_api_not_enabled"],
    [401, { error: { message: "PRIVATE_ACCESS_TOKEN" } }, "google_discovery_unavailable"],
    [429, { error: { message: "PRIVATE" } }, "google_discovery_unavailable"],
    [503, { error: { message: "PRIVATE" } }, "google_discovery_unavailable"],
    [302, { error: { message: "PRIVATE https://evil.example" } }, "google_discovery_unavailable"],
  ] as const) {
    const fake = server(call => call.url === searchUrl ? Response.json(body, { status }) : undefined);
    await rejectsCode(discoverGooglePlayApps(credentials, undefined, { fetcher: fake.fetcher, now: () => t0 }), code);
  }
});

test("Play discovery rejects malformed app lists and returns no partially validated page", async () => {
  for (const body of [null, [], { apps: null }, { apps: {} }, { apps: [app, { ...app, packageName: "PRIVATE/path" }] },
    { apps: Array.from({ length: 101 }, () => app) }, { apps: [app, app] },
    { apps: [{ ...app, name: "https://evil.example/PRIVATE" }] }, { apps: [{ ...app, name: "apps/../PRIVATE" }] },
    { apps: [{ ...app, displayName: "x".repeat(501) }] }, { apps: [{ ...app, displayName: " " }] },
    { apps: [{ ...app, displayName: "PRIVATE\u0000" }] }, { apps: [{ ...app, packageName: "com.1invalid" }] },
    { apps: [{ ...app, packageName: "a." + "b".repeat(254) }] },
    { nextPageToken: 1 }, { nextPageToken: "x".repeat(4097) }, { nextPageToken: "PRIVATE\n" },
  ]) {
    const fake = server(call => call.url === searchUrl ? Response.json(body) : undefined);
    await rejectsCode(discoverGooglePlayApps(credentials, undefined, { fetcher: fake.fetcher, now: () => t0 }), "google_discovery_unavailable");
    assert.equal(fake.calls.length, 2);
  }
  const fake = server(call => call.url.startsWith(searchUrl) ? Response.json({ apps: [app], nextPageToken: "same-cursor" }) : undefined);
  await rejectsCode(discoverGooglePlayApps(credentials, "same-cursor", { fetcher: fake.fetcher, now: () => t0 }), "google_discovery_unavailable");
});

test("Play discovery sanitizes failed OAuth, invalid token responses and network failures", async () => {
  for (const [response, code] of [
    [() => new Response("PRIVATE", { status: 400 }), "google_invalid_credentials"],
    [() => new Response("PRIVATE", { status: 401 }), "google_invalid_credentials"],
    [() => new Response("PRIVATE", { status: 503 }), "google_discovery_unavailable"],
    [() => Response.json({ access_token: "PRIVATE_ACCESS_TOKEN" }), "google_discovery_unavailable"],
    [() => Response.json({ access_token: "PRIVATE_ACCESS_TOKEN", token_type: "Basic", expires_in: 3600 }), "google_discovery_unavailable"],
    [() => Response.json({ access_token: "PRIVATE_ACCESS_TOKEN", token_type: "Bearer", expires_in: 0 }), "google_discovery_unavailable"],
    [() => { throw new Error("PRIVATE https://evil.example"); }, "google_discovery_unavailable"],
  ] as const) {
    const fake = server(call => call.url === oauthUrl ? response() : undefined);
    await rejectsCode(discoverGooglePlayApps(credentials, undefined, { fetcher: fake.fetcher, now: () => t0 }), code);
    assert.equal(fake.calls.length, 1);
  }
});

test("Play discovery bounds response parsing for malformed JSON, oversized bodies and oversized content lengths", async () => {
  for (const response of [() => new Response("PRIVATE not JSON"), () => new Response("x".repeat(262145)),
    () => new Response("{}", { headers: { "content-length": "262145" } }),
    () => { throw new Error("PRIVATE https://evil.example"); }]) {
    const fake = server(call => call.url === searchUrl ? response() : undefined);
    await rejectsCode(discoverGooglePlayApps(credentials, undefined, { fetcher: fake.fetcher, now: () => t0 }), "google_discovery_unavailable");
    assert.equal(fake.calls.length, 2);
  }
});
