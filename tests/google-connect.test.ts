import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createGoogleConnect, type Deps } from "../supabase/functions/google-connect/handler.ts";
import { GoogleSetupError } from "../supabase/functions/_shared/core/google_cloud.ts";

const ACCOUNT = "aaaaaaaa-0000-4000-8000-000000000001", APP = "cccccccc-0000-4000-8000-000000000001", USER = "bbbbbbbb-0000-4000-8000-000000000001";
const credentials = { type: "service_account", project_id: "example-project", client_email: "receiver@example-project.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const app = { id: APP, account_id: ACCOUNT, store: "play_store", package_name: "com.example.app", webhook_key: "a".repeat(32), enabled: true,
  last_event_production_at: null, last_event_sandbox_at: null };
const connection = { topic: "projects/example-project/topics/salebell", subscription: "projects/example-project/subscriptions/salebell",
  audience: `https://api.example.com/functions/v1/google-webhook/${app.webhook_key}`, service_account_email: credentials.client_email, updated_at: "2026-10-14T10:00:00Z" };
const request = (body: unknown, token = "valid") => new Request("https://api.example.com/functions/v1/google-connect", {
  method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
function harness(over: Partial<Deps> = {}) {
  const saved: Parameters<Deps["save"]>[0][] = [], provisioned: unknown[] = [], discovered: unknown[] = [], logs: unknown[] = [];
  const handler = createGoogleConnect({
    getUser: async token => token === "valid" ? { id: USER } : null,
    app: async id => id === APP ? app : null,
    canManage: async accountId => accountId === ACCOUNT,
    rateLimit: async () => 0,
    status: async () => ({ ...connection, private_key: credentials.private_key }),
    save: async input => { saved.push(input); },
    remove: async () => true,
    provision: async (key, target) => { provisioned.push({ key, target }); return { topic: connection.topic!, subscription: connection.subscription, serviceAccountEmail: key.client_email }; },
    discover: async (key, cursor) => { discovered.push({ key, cursor }); return { apps: [{ package_name: "com.example.app", display_name: "Example app" }], next_cursor: "page-2" }; },
    publicApiUrl: "https://api.example.com", log: { error: (...args) => logs.push(args) }, ...over,
  });
  return { handler, saved, provisioned, discovered, logs };
}

test("discovery needs only a managed workspace and returns app metadata without saving the key", async () => {
  const h = harness({ app: async () => { throw new Error("discovery must not require an app row"); } });
  const response = await h.handler(request({ action: "discover", account_id: ACCOUNT, credentials, cursor: "page-1" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { apps: [{ package_name: "com.example.app", display_name: "Example app" }], next_cursor: "page-2" });
  assert.equal(h.discovered.length, 1);
  assert.deepEqual(h.discovered[0], { key: credentials, cursor: "page-1" });
  assert.equal(h.saved.length, 0);
  assert.equal(h.provisioned.length, 0);
});

test("discovery authenticates and authorizes the workspace before reading credentials or calling Google", async () => {
  const body = { action: "discover", account_id: ACCOUNT, credentials };
  assert.equal((await harness().handler(request(body, "invalid"))).status, 401);
  for (const patch of [{ account_id: "invalid" }, { account_id: APP }]) {
    const h = harness();
    const response = await h.handler(request({ ...body, ...patch }));
    assert.equal(response.status, patch.account_id === "invalid" ? 400 : 403);
    assert.equal(h.discovered.length, 0);
  }
  const h = harness({ canManage: async () => false });
  assert.equal((await h.handler(request({ ...body, credentials: "not a key" }))).status, 403);
  assert.equal(h.discovered.length, 0);
});

test("discovery bounds pagination, validates keys, and shares the operation rate limit", async () => {
  const body = { action: "discover", account_id: ACCOUNT, credentials };
  for (const patch of [{ cursor: 1 }, { cursor: "x".repeat(4097) }, { cursor: "bad\nvalue" }, { credentials: { ...credentials, private_key: "invalid" } }]) {
    const h = harness();
    assert.equal((await h.handler(request({ ...body, ...patch }))).status, 400);
    assert.equal(h.discovered.length, 0);
  }
  const limited = harness({ rateLimit: async () => 12 });
  const response = await limited.handler(request(body));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "12");
  assert.equal(limited.discovered.length, 0);
});

test("discovery allowlists metadata and sanitizes provider failures without exposing keys", async () => {
  const body = { action: "discover", account_id: ACCOUNT, credentials };
  const h = harness({ discover: async () => ({ apps: [{ package_name: "com.example.app", display_name: "Example app", private_key: credentials.private_key }], next_cursor: null, credentials }) });
  assert.deepEqual(await (await h.handler(request(body))).json(), { apps: [{ package_name: "com.example.app", display_name: "Example app" }], next_cursor: null });
  for (const [code, status] of [["google_api_not_enabled", 403], ["google_api_permission_denied", 403], ["google_invalid_credentials", 400], ["google_discovery_unavailable", 503]] as const) {
    const failed = harness({ discover: async () => { throw new GoogleSetupError(code); } });
    const response = await failed.handler(request(body));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(failed.saved.length, 0);
  }
  const failed = harness({ discover: async () => { throw new Error(credentials.private_key); } });
  assert.equal((await failed.handler(request(body))).status, 503);
  assert.ok(!JSON.stringify(failed.logs).includes("PRIVATE KEY"));
});

test("automatic setup binds the receiver server-side, encrypts credentials, and waits for real delivery", async () => {
  const h = harness();
  const response = await h.handler(request({ action: "configure", app_id: APP, credentials, mode: "automatic", audience: "https://attacker.example" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.verified, false);
  assert.equal(result.connection.audience, connection.audience);
  assert.equal(h.saved[0].userId, USER);
  assert.equal(h.saved[0].app.webhook_key, app.webhook_key);
  assert.equal(h.saved[0].credentials.private_key, credentials.private_key);
  assert.equal(h.provisioned.length, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE KEY"));
});

test("manual setup uses explicit Pub/Sub resources without cloud administration access", async () => {
  const h = harness();
  const response = await h.handler(request({ action: "configure", app_id: APP, credentials, mode: "manual", topic: connection.topic, subscription: connection.subscription }));
  assert.equal(response.status, 200);
  assert.equal(h.provisioned.length, 0);
  assert.equal(h.saved[0].subscription, connection.subscription);
  for (const patch of [{ topic: "invalid" }, { subscription: "invalid" }, { service_account_email: "not-an-account" }]) {
    assert.equal((await h.handler(request({ action: "configure", app_id: APP, credentials, mode: "manual", topic: connection.topic, subscription: connection.subscription, ...patch }))).status, 400);
  }
});

test("saved status allowlists metadata and verifies only notifications after configuration", async () => {
  assert.equal((await (await harness().handler(request({ action: "status", app_id: APP }))).json()).verified, false);
  const old = harness({ app: async () => ({ ...app, last_event_production_at: "2026-10-13T10:00:00Z" }) });
  assert.equal((await (await old.handler(request({ action: "status", app_id: APP }))).json()).verified, false);
  const fresh = harness({ app: async () => ({ ...app, last_event_sandbox_at: "2026-10-14T10:01:00Z" }) });
  const body = await (await fresh.handler(request({ action: "status", app_id: APP }))).json();
  assert.equal(body.verified, true);
  assert.ok(!JSON.stringify(body).includes("PRIVATE KEY"));
  const empty = harness({ status: async () => null });
  assert.deepEqual(await (await empty.handler(request({ action: "status", app_id: APP }))).json(), { connection: null, verified: false });
});

test("authentication, platform and membership checks precede key use or cloud mutation", async () => {
  const h = harness({ canManage: async () => false });
  const body = { action: "configure", app_id: APP, credentials, mode: "automatic" };
  assert.equal((await h.handler(request(body, "invalid"))).status, 401);
  assert.equal((await h.handler(request(body))).status, 403);
  assert.equal((await harness({ app: async () => ({ ...app, store: "app_store" }) }).handler(request(body))).status, 400);
  assert.equal((await harness().handler(request({ ...body, app_id: "invalid" }))).status, 400);
  assert.equal(h.provisioned.length, 0);
  assert.equal(h.saved.length, 0);
});

test("malformed keys, oversized requests and unsafe receiver configuration never reach Google", async () => {
  for (const patch of [{ type: "user" }, { project_id: "invalid project" }, { private_key: "secret" }, { client_email: "bad" },
    { private_key: generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() }]) {
    const h = harness();
    assert.equal((await h.handler(request({ action: "configure", app_id: APP, mode: "automatic", credentials: { ...credentials, ...patch } }))).status, 400);
    assert.equal(h.provisioned.length, 0);
  }
  const body = { action: "configure", app_id: APP, mode: "automatic", credentials };
  assert.equal((await harness().handler(request({ ...body, extra: "x".repeat(50000) }))).status, 413);
  assert.equal((await harness({ publicApiUrl: "http://localhost:54321" }).handler(request(body))).status, 503);
});

test("rate limiting and upstream errors are actionable without logging or reflecting secrets", async () => {
  const body = { action: "configure", app_id: APP, credentials, mode: "automatic" };
  assert.equal((await harness({ rateLimit: async () => 10 }).handler(request(body))).status, 429);
  const failure = harness({ save: async () => { throw new Error(credentials.private_key); } });
  assert.equal((await failure.handler(request(body))).status, 503);
  assert.ok(!JSON.stringify(failure.logs).includes("PRIVATE KEY"));
  for (const code of ["google_api_permission_denied", "google_api_not_enabled", "google_resource_conflict"]) {
    const h = harness({ provision: async () => { throw new GoogleSetupError(code); } });
    const response = await h.handler(request(body));
    assert.ok([403, 409].includes(response.status));
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(h.saved.length, 0);
  }
});

test("disconnect removes credentials using the verified caller, and stale app snapshots do not save", async () => {
  let removed: unknown;
  const h = harness({ remove: async (...args) => { removed = args; return true; } });
  assert.deepEqual(await (await h.handler(request({ action: "delete", app_id: APP }))).json(), { deleted: true });
  assert.deepEqual(removed, [APP, USER]);
  const stale = harness({ save: async () => { throw new Error('RPC failed: {"message":"preview_changed"}'); } });
  const response = await stale.handler(request({ action: "configure", app_id: APP, credentials, mode: "automatic" }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "preview_changed" });
});
