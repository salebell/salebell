import { test } from "node:test";
import assert from "node:assert/strict";
import { createPushRelayProxy } from "./push-relay-proxy.ts";

const env = (values: Record<string, string | undefined> = {}) => (name: string) => values[name];
const config = { SALEBELL_PUSH_RELAY_ENABLED: "true", SUPABASE_URL: "https://managed.supabase.co" };
const request = (body = '{"action":"deliver","capability":"secret"}') => new Request("https://salebell.vercel.app/api/push-relay", { method: "POST", headers: { "content-type": "application/json" }, body });

test("relay proxy is disabled unless private operator flag is explicitly true", async () => {
  for (const values of [{}, { NEXT_PUBLIC_SALEBELL_PUSH_RELAY_ENABLED: "true" }]) {
    const response = await createPushRelayProxy(env(values), async () => { throw new Error("must not fetch"); })(request());
    assert.equal(response.status, 404);
  }
});

test("proxy forwards original bounded body only to its own managed relay", async () => {
  const body = '{ "action": "enroll", "installation_id": "id", "backend": "https://attacker.example" }';
  const proxy = createPushRelayProxy(env(config), async (url, init) => {
    assert.equal(String(url), "https://managed.supabase.co/functions/v1/push-relay");
    assert.equal(init?.body, body);
    assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { "content-type": "application/json" });
    return Response.json({ challenge_id: "10000000-0000-4000-8000-000000000001" }, { status: 202 });
  });
  const response = await proxy(request(body));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { challenge_id: "10000000-0000-4000-8000-000000000001" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("proxy rejects oversized, malformed and non-JSON requests before upstream", async () => {
  const proxy = createPushRelayProxy(env(config), async () => { throw new Error("must not fetch"); });
  assert.equal((await proxy(request("x".repeat(16_385)))).status, 413);
  assert.equal((await proxy(request("bad json"))).status, 400);
  assert.equal((await proxy(new Request("https://relay", { method: "POST", body: "{}" }))).status, 415);
});

test("proxy sanitizes upstream failures, redirects, unexpected fields and thrown errors", async () => {
  for (const reply of [() => new Response("private DB password", { status: 500 }), () => new Response(null, { status: 302, headers: { location: "https://attacker" } }), () => Response.json({ sent: 1, failed: 0, token: "private token" }), () => { throw new Error("private credentials"); }]) {
    const response = await createPushRelayProxy(env(config), async () => reply())(request());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "relay_unavailable" });
  }
});

test("proxy does not expose upstream rejection details", async () => {
  const response = await createPushRelayProxy(env(config), async () => Response.json({ error: "private capability" }, { status: 403 }))(request());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "relay_rejected" });
});
