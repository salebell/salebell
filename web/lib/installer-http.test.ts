import test from "node:test";
import assert from "node:assert/strict";
import { createInstallerHandler, publicStatus } from "./installer-http.ts";
import type { InstallerConfig } from "./installer-config.ts";
import type { InstallJob } from "./installer-types.ts";

const config: InstallerConfig = { origin: "https://install.example", vercelClientId: "oac_x", vercelSecret: "private", vercelSlug: "salebell", supabaseClientId: "client", supabaseSecret: "private", encryptionKey: "ab".repeat(32), controlUrl: "https://control.supabase.co", controlKey: "private", releaseRef: "a".repeat(40), supabaseProduct: "supabase", publicEnabled: false, cleanupSecret: "cleanup-private" };
const release = { id: "a".repeat(64), migrations: [], functions: [] };
test("disabled installer exposes no API", async () => {
  const handler = createInstallerHandler(null, release);
  assert.equal((await handler(new Request("https://install.example/api/deploy/start", { method: "POST" }), "start")).status, 404);
});
test("cross-origin mutations fail before accessing storage", async () => {
  let fetched = false;
  const handler = createInstallerHandler(config, release, async () => { fetched = true; throw new Error("should not run"); });
  const response = await handler(new Request("https://install.example/api/deploy/start", { method: "POST", headers: { origin: "https://attacker.example" } }), "start");
  assert.equal(response.status, 403); assert.equal(fetched, false);
});
test("status requires a valid session cookie and does not cache responses", async () => {
  const handler = createInstallerHandler(config, release);
  const response = await handler(new Request("https://install.example/api/deploy/status"), "status");
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("public status strips provider credentials, OAuth verifier and owner email", () => {
  const job: InstallJob = { id: "job", version: 0, phase: "functions", cursor: 2, createdAt: 0, expiresAt: Date.now() + 1000, ownerEmail: "private@example.com", vercel: { access: "secret-token", configurationId: "icfg_x" }, supabase: { access: "secret-token" }, pending: { provider: "supabase", hash: "h", expires: 100, verifier: "private-verifier" } };
  const status = JSON.stringify(publicStatus(job));
  assert.equal(status.includes("secret-token"), false); assert.equal(status.includes("private-verifier"), false); assert.equal(status.includes("private@example.com"), false);
});
test("cleanup rejects an incorrect bearer token without querying storage", async () => {
  const handler = createInstallerHandler(config, release, async () => { throw new Error("should not run"); });
  assert.equal((await handler(new Request("https://install.example/api/deploy/cleanup", { headers: { authorization: "Bearer wrong" } }), "cleanup")).status, 401);
});
test("revoked credentials expose reconnect actions even while stored tokens exist", () => {
  const job: InstallJob = { id: "job", version: 0, phase: "functions", cursor: 0, createdAt: 0, expiresAt: Date.now() + 1000, error: "provider_authorization", vercel: { access: "revoked", configurationId: "icfg_x" }, supabase: { access: "revoked" } };
  assert.equal(publicStatus(job).reconnect, true);
});
test("Vercel callback consumes its session-bound state once before exchanging provider credentials", async () => {
  let record: { id: string; version: number; document: unknown; credentials: unknown; hash: string; lease?: string } | null = null;
  let exchanges = 0;
  let rejectBinding = false;
  const handler = createInstallerHandler(config, release, async (input, init) => {
    const url = new URL(String(input));
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
    if (url.pathname.endsWith("/oauth/access_token")) { exchanges++; return Response.json({ access_token: "provider-private", installation_id: "icfg_x", team_id: "team_x" }); }
    if (url.pathname === "/v1/oauth/token") return Response.json({ access_token: "supabase-private", refresh_token: "refresh-private", expires_in: 3600 });
    if (url.pathname.includes("/integrations/configuration/")) return Response.json({ id: "icfg_x", integrationId: "oac_x", projects: ["prj_x"] });
    if (url.pathname.endsWith("/env") && init?.method === "GET") return Response.json({ envs: [{ key: "NEXT_PUBLIC_SUPABASE_URL", value: "https://abcdefghijklmnopqrst.supabase.co" }, { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: "public" }] });
    if (url.pathname.endsWith("/domains")) return Response.json({ domains: [{ name: "instance.vercel.app" }] });
    if (url.pathname === "/v9/projects/prj_x" && init?.method === "GET") return Response.json({ id: "prj_x", name: "salebell", link: { type: "github", repoId: 1 } });
    if (url.pathname === "/v1/projects/abcdefghijklmnopqrst") return Response.json({ id: "abcdefghijklmnopqrst", name: "database" });
    if (url.pathname.endsWith("/api-keys")) return Response.json([{ name: "anon", api_key: "public" }]);
    if (url.pathname === "/v6/deployments") return Response.json({ deployments: [{ uid: "dpl_clone", state: "READY" }] });
    if (url.pathname === "/v13/deployments/dpl_clone") return Response.json({ id: "dpl_clone", readyState: "READY", meta: { githubCommitSha: "b".repeat(40) } });
    if (url.pathname === "/api/instance-release") return Response.json({ release: release.id });
    return Response.json({});
  });
  const started = await handler(new Request("https://install.example/api/deploy/start", { method: "POST", headers: { origin: config.origin } }), "start");
  const cookie = started.headers.get("set-cookie")!.split(";")[0];
  const state = new URL((await started.json()).url).searchParams.get("external-id")!;
  const callback = `https://install.example/api/deploy/vercel-callback?code=once&configurationId=icfg_x&currentProjectId=prj_x&external-id=${state}`;
  assert.equal((await handler(new Request(callback, { headers: { cookie } }), "vercel-callback")).status, 303);
  assert.equal(exchanges, 1);
  const replay = await handler(new Request(callback, { headers: { cookie } }), "vercel-callback");
  assert.ok(replay.headers.get("location")?.includes("oauth_state_invalid"));
  assert.equal(exchanges, 1);
  const status = await handler(new Request("https://install.example/api/deploy/status", { headers: { cookie } }), "status");
  const publicBody = await status.text();
  assert.equal(publicBody.includes("provider-private"), false);
  assert.equal(JSON.parse(publicBody).needsSupabase, true);
  const connect = await handler(new Request("https://install.example/api/deploy/connect-supabase", { method: "POST", headers: { cookie, origin: config.origin } }), "connect-supabase");
  const supabaseState = new URL((await connect.json()).url).searchParams.get("state");
  const supabaseCallback = `https://install.example/api/deploy/supabase-callback?code=once&state=${supabaseState}`;
  assert.equal((await handler(new Request(supabaseCallback, { headers: { cookie } }), "supabase-callback")).status, 303);
  rejectBinding = true;
  const rejected = await handler(new Request("https://install.example/api/deploy/select", { method: "POST", headers: { cookie, origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_x" }) }), "select");
  assert.equal((await rejected.json()).error, "project_in_use");
  assert.equal((record as unknown as { document: { target?: unknown } }).document.target, undefined, "the error handler must not persist an unbound target");
  rejectBinding = false;
  const selected = await handler(new Request("https://install.example/api/deploy/select", { method: "POST", headers: { cookie, origin: config.origin, "content-type": "application/json" }, body: JSON.stringify({ projectId: "prj_x" }) }), "select");
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).phase, "validate");
  assert.equal((record as unknown as { document: { target: { revision: string } } }).document.target.revision, "b".repeat(40), "the clone's own commit is preserved instead of assuming upstream history");
});
