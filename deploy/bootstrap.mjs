import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = "http://api-gw:8000";
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.OWNER_EMAIL;
const password = readFileSync("/run/secrets/owner_password", "utf8").trim();

async function request(path, { key = anon, token = key, method = "GET", body, expected = 200, origin = api, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const accepted = Array.isArray(expected) ? expected : [expected];
  if (!accepted.includes(response.status)) {
    await response.body?.cancel();
    throw new Error(`${method} ${path.split("?")[0]} returned ${response.status}; expected ${expected}. Inspect the service logs.`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function ensureOwner() {
  // List existing users instead of resetting an owner's password during each upgrade.
  for (let page = 1; ; page++) {
    const data = await request(`/auth/v1/admin/users?page=${page}&per_page=1000`, { key: service });
    if (data.users?.some(user => user.email?.toLowerCase() === email.toLowerCase())) return;
    if (!data.users || data.users.length < 1000) break;
  }
  await request("/auth/v1/admin/users", {
    key: service, method: "POST", body: { email, password, email_confirm: true }, expected: 200,
  });
  console.log("Confirmed installation owner created. The password is retained in the private owner-password file.");
}

async function checkRealtime(token) {
  const socket = new WebSocket(`ws://api-gw:8000/realtime/v1/websocket?apikey=${anon}&vsn=1.0.0`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Realtime subscription timed out")); }, 20_000);
    socket.onopen = () => socket.send(JSON.stringify({
      topic: "realtime:installation-check", event: "phx_join", ref: "1",
      payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "INSERT", schema: "public", table: "store_events" }] }, access_token: token },
    }));
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Realtime WebSocket failed")); };
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.event !== "phx_reply") return;
      clearTimeout(timer);
      socket.close();
      if (message.payload?.status === "ok") resolve();
      else reject(new Error("Realtime rejected the authenticated subscription"));
    };
  });
}

async function check() {
  const settings = await request("/rest/v1/rpc/instance_settings", { method: "POST", body: {} });
  assert.equal(settings.deployment_mode, "self_hosted", "Database must run in self-hosted mode");
  assert.equal(settings.billing_enabled, false, "Self-hosted billing must be disabled");
  const session = await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  assert.ok(session.access_token, "Owner password sign-in must return a session");
  const accounts = await request("/rest/v1/accounts?select=id,name,plan", { token: session.access_token });
  assert.ok(accounts.length > 0, "Owner signup must provision a workspace");
  // Table SELECT is revoked from anon; PostgREST returns 401/403 rather than [] rows.
  await request("/rest/v1/accounts?select=id", { expected: [401, 403] });
  await request("/functions/v1/test-alert", { method: "POST", body: {}, expected: 401 });
  const [app] = await request("/rest/v1/apps", {
    token: session.access_token, method: "POST", expected: 201, headers: { Prefer: "return=representation" },
    body: { account_id: accounts[0].id, name: "Installation check", bundle_id: `com.example.installation.${crypto.randomUUID().replaceAll("-", "")}` },
  });
  try {
    // Exercises the actual Next rewrite, Edge Runtime dispatch and Apple payload rejection.
    await request(`/hooks/apple/${app.webhook_key}/production`, {
      origin: "http://web:3000", method: "POST", body: {}, expected: 400,
    });
  } finally {
    await request(`/rest/v1/apps?id=eq.${app.id}`, { token: session.access_token, method: "DELETE", expected: 204 });
  }
  await checkRealtime(session.access_token);
  await request("/auth/v1/logout?scope=local", { token: session.access_token, method: "POST", expected: 204 });
  console.log("Verified owner password sign-in, workspace provisioning, self-hosted mode, anonymous isolation, protected functions, Apple webhook proxy and authenticated Realtime.");
}

try {
  if (process.argv[2] === "up") await ensureOwner();
  await check();
} catch (error) {
  // Never print response bodies, tokens or submitted credentials.
  console.error(`Installation check failed: ${error.message}`);
  process.exitCode = 1;
}
