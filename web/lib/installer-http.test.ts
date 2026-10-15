import test from "node:test";
import assert from "node:assert/strict";
import { createInstallerHandler, publicStatus } from "./installer-http.ts";
import type { InstallerConfig } from "./installer-config.ts";
import type { InstallJob } from "./installer-types.ts";

const config: InstallerConfig = { origin: "https://install.example", supabaseClientId: "client", supabaseSecret: "private", encryptionKey: "ab".repeat(32), controlUrl: "https://control.supabase.co", controlKey: "private", releaseRef: "a".repeat(40), supabaseProduct: "supabase", publicEnabled: false, cleanupSecret: "cleanup-private" };
const release = { id: "a".repeat(64), migrations: [], functions: [] };
const site = "https://instance.vercel.app";
const ref = "abcdefghijklmnopqrst";
const info = { release: release.id, mode: "self_hosted", setup: true, origin: site, installerOrigin: config.origin, supabaseUrl: `https://${ref}.supabase.co`, publicKey: "public" };
function fixture() {
  let record: { id: string; version: number; document: InstallJob; credentials: unknown; hash: string; lease?: string } | null = null;
  let exchanges = 0, mutations = 0, rejectBinding = false, mismatch = false;
  const handler = createInstallerHandler(config, release, async (input, init) => {
    const url = new URL(String(input));
    assert.notEqual(url.hostname, "api.vercel.com", "the installer requires no Vercel API credentials");
    if (url.hostname === "control.supabase.co") {
      const action = url.pathname.split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      if (action === "installer_rate_limit") return Response.json(0);
      if (action === "installer_create") { record = { id: body.p_id, version: 0, document: body.p_document, credentials: body.p_credentials, hash: body.p_hash }; return Response.json(null); }
      if (!record || record.hash !== body.p_hash) return Response.json(null);
      if (action === "installer_acquire") { record.version++; record.lease = body.p_lease; }
      if (action === "installer_save") {
        if (body.p_project_ref && rejectBinding) return Response.json({ message: "project_in_use" }, { status: 400 });
        if (body.p_version !== record.version || body.p_lease !== record.lease) return Response.json(null);
        record.document = body.p_document; record.credentials = body.p_credentials; record.version++; record.lease = undefined;
      }
      return Response.json(record);
    }
    if (url.pathname === "/v1/oauth/token") {
      exchanges++;
      const body = new URLSearchParams(String(init?.body));
      assert.ok(body.get("code_verifier"));
      assert.equal(body.get("redirect_uri"), `${config.origin}/api/deploy/supabase-callback`);
      return Response.json({ access_token: "supabase-private", refresh_token: "refresh-private", expires_in: 3600 });
    }
    if (url.pathname === "/api/instance-release") {
      assert.equal(new Headers(init?.headers).get("authorization"), null, "no provider credential reaches the website");
      return Response.json(info);
    }
    if (url.pathname === `/v1/projects/${ref}`) return Response.json({ id: ref, name: "database" });
    if (url.pathname.endsWith("/api-keys")) return Response.json([{ name: "anon", api_key: mismatch ? "wrong" : "public" }, { type: "secret", api_key: "sb_secret_admin" }]);
    if (url.pathname.endsWith("/functions")) return Response.json([]);
    if (url.pathname.endsWith("/database/query")) {
      mutations++;
      const query = JSON.parse(String(init?.body)).query;
      if (query.startsWith("select to_regclass")) return Response.json([{ installed: null }]);
      if (query.startsWith("select exists")) return Response.json([{ occupied: false }]);
      return Response.json([]);
    }
    if (url.pathname.endsWith("/config/auth") || url.pathname.endsWith("/secrets")) { mutations++; return Response.json({}); }
    if (url.pathname === "/api/instance-health") return Response.json({ release: release.id, mode: "self_hosted", origin: site });
    if (url.pathname.startsWith("/hooks/")) return new Response(null, { status: 404 });
    if (url.pathname === "/auth/v1/admin/users") return Response.json(init?.method === "POST" ? {} : { users: [] });
    if (url.pathname === "/auth/v1/token") return Response.json({ access_token: "user-private", user: { id: "user-id", email: "owner@example.com" } });
    if (url.pathname === "/rest/v1/accounts") return Response.json([{ id: "account-id" }]);
    if (url.pathname === "/functions/v1/test-alert") return new Response(null, { status: 400 });
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  let cookie = "";
  async function call(action: string, body?: Record<string, unknown>, query = "") {
    const response = await handler(new Request(`${config.origin}/api/deploy/${action}${query}`, {
      method: body ? "POST" : "GET", headers: { cookie, origin: config.origin, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), action);
    if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
    return response;
  }
  async function connect() {
    await call("start", { site });
    const response = await call("connect-supabase", { site });
    const url = new URL((await response.json()).url);
    assert.equal(url.origin, "https://api.supabase.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    return `?code=once&state=${url.searchParams.get("state")}`;
  }
  return { call, connect, get record() { return record; }, get exchanges() { return exchanges; }, get mutations() { return mutations; }, set rejectBinding(v: boolean) { rejectBinding = v; }, set mismatch(v: boolean) { mismatch = v; } };
}
test("disabled installer and removed Vercel OAuth endpoints expose no API", async () => {
  const disabled = createInstallerHandler(null, release);
  assert.equal((await disabled(new Request(`${config.origin}/api/deploy/start`, { method: "POST" }), "start")).status, 404);
  const handler = createInstallerHandler(config, release);
  for (const action of ["connect-vercel", "vercel-callback", "projects"]) assert.equal((await handler(new Request(`${config.origin}/api/deploy/${action}`), action)).status, 404);
});
test("cross-origin mutations fail before accessing storage", async () => {
  let fetched = false;
  const handler = createInstallerHandler(config, release, async () => { fetched = true; throw new Error("should not run"); });
  const response = await handler(new Request(`${config.origin}/api/deploy/start`, { method: "POST", headers: { origin: "https://attacker.example" } }), "start");
  assert.equal(response.status, 403); assert.equal(fetched, false);
});
test("status requires a valid session cookie and does not cache responses", async () => {
  const response = await fixture().call("status");
  assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("public status strips provider credentials, OAuth verifier and owner email", () => {
  const job: InstallJob = { id: "job", version: 0, phase: "functions", cursor: 2, createdAt: 0, expiresAt: Date.now() + 1000, ownerEmail: "private@example.com", supabase: { access: "secret-token" }, pending: { provider: "supabase", hash: "h", expires: 100, verifier: "private-verifier" } };
  const status = JSON.stringify(publicStatus(job));
  assert.equal(status.includes("secret-token"), false); assert.equal(status.includes("private-verifier"), false); assert.equal(status.includes("private@example.com"), false);
  assert.equal(publicStatus({ ...job, error: "provider_authorization" }).reconnect, true);
});
test("cleanup rejects an incorrect bearer token without querying storage", async () => {
  const handler = createInstallerHandler(config, release, async () => { throw new Error("should not run"); });
  assert.equal((await handler(new Request(`${config.origin}/api/deploy/cleanup`, { headers: { authorization: "Bearer wrong" } }), "cleanup")).status, 401);
});
test("start creates a native deploy link with no shared Vercel integration", async () => {
  const response = await fixture().call("start", {});
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  assert.equal(url.origin, "https://vercel.com"); assert.equal(url.searchParams.has("integration-ids"), false);
  assert.ok(response.headers.get("set-cookie")?.includes("HttpOnly; Secure; SameSite=Lax"));
});
test("Supabase callback consumes session-bound PKCE state once before exchanging credentials", async () => {
  const f = fixture(); const query = await f.connect();
  assert.equal((await f.call("supabase-callback", undefined, query)).status, 303);
  assert.equal(f.exchanges, 1);
  const replay = await f.call("supabase-callback", undefined, query);
  assert.ok(replay.headers.get("location")?.includes("oauth_state_invalid")); assert.equal(f.exchanges, 1);
  assert.equal((await (await f.call("status")).text()).includes("supabase-private"), false);
});
test("mismatched public keys and failed unique bindings cannot persist a target or mutate a backend", async () => {
  const f = fixture(); const query = await f.connect(); await f.call("supabase-callback", undefined, query);
  f.mismatch = true;
  assert.equal((await (await f.call("select", { site })).json()).error, "project_mismatch");
  f.mismatch = false; f.rejectBinding = true;
  assert.equal((await (await f.call("select", { site })).json()).error, "project_in_use");
  assert.equal(f.record?.document.target, undefined); assert.equal(f.mutations, 0);
  f.rejectBinding = false;
  assert.equal((await (await f.call("select", { site })).json()).phase, "validate");
});
test("authorized setup reaches owner completion without any Vercel token and removes temporary credentials", async () => {
  const f = fixture(); const query = await f.connect(); await f.call("supabase-callback", undefined, query);
  assert.equal((await (await f.call("select", { site })).json()).phase, "validate");
  let phase = "validate";
  for (let i = 0; i < 10 && phase !== "owner"; i++) {
    const response = await f.call("advance", {}); assert.equal(response.status, 200);
    phase = (await response.json()).phase;
  }
  assert.equal(phase, "owner"); assert.ok(f.mutations > 0);
  const result = await f.call("owner", { email: "owner@example.com", password: "correct-password-123" });
  assert.equal(result.status, 200); assert.equal((await result.json()).phase, "complete");
  assert.equal(f.record?.credentials, null);
});
test("site selection cannot change the address authorized in the connection flow", async () => {
  const f = fixture(); const query = await f.connect(); await f.call("supabase-callback", undefined, query);
  const response = await f.call("select", { site: "https://different.vercel.app" });
  assert.equal((await response.json()).error, "project_mismatch"); assert.equal(f.mutations, 0);
});
