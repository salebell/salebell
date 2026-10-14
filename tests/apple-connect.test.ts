import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { APPLE_API, createAppleConnect, type ConnectPreview, type Deps, type LocalApp, type PrepareForwarding } from "../supabase/functions/apple-connect/handler.ts";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const APP = "00000000-0000-4000-8000-000000000002";
const CREDENTIAL = "00000000-0000-4000-8000-000000000003";
const USER = "00000000-0000-4000-8000-000000000004";
const SITE = "https://salebell.vercel.app";
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
const key = { key_id: "ABCDE12345", issuer_id: "57246542-96fe-1a63-e053-0824d011072a", private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string };

function make(options: Partial<Deps> = {}, appPatch: Partial<LocalApp> = {}, applePatch: Record<string, unknown> = {}) {
  const app: LocalApp = { id: APP, account_id: ACCOUNT, bundle_id: "com.example.cafe", apple_app_id: 1234567890, webhook_key: "a".repeat(32), forward_url_production: null, forward_url_sandbox: null, ...appPatch };
  const attributes = { name: "Café Timer", bundleId: app.bundle_id, subscriptionStatusUrl: null, subscriptionStatusUrlForSandbox: null, subscriptionStatusUrlVersion: null, subscriptionStatusUrlVersionForSandbox: null, ...applePatch };
  const apple = { type: "apps", id: "1234567890", attributes };
  const calls: { url: string; init: RequestInit }[] = [];
  const prepared: PrepareForwarding[] = [];
  const events: string[] = [];
  const logs: unknown[][] = [];
  const deps: Deps = {
    getUser: async token => token === "test-token" ? { id: USER } : null,
    canManage: async (account, user) => account === ACCOUNT && user === USER,
    app: async id => id === APP ? { ...app } : null,
    receiverExists: async webhookKey => webhookKey === app.webhook_key,
    credentials: async (id, account, user) => id === CREDENTIAL && account === ACCOUNT && user === USER ? key : null,
    prepareForwarding: async args => {
      prepared.push(args); events.push("forwarding");
      app.forward_url_production = args.forwarding.production_url; app.forward_url_sandbox = args.forwarding.sandbox_url;
      return "ok";
    },
    rateLimit: async () => 0, siteUrl: SITE, supabaseUrl: SUPABASE, clock: () => 1_800_000_000_000,
    fetcher: (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      if (init.method === "PATCH") {
        events.push("patch");
        Object.assign(attributes, JSON.parse(String(init.body)).data.attributes);
        return Response.json({ data: apple });
      }
      return Response.json(String(url).includes("/v1/apps?") ? { data: [apple], links: { next: null } } : { data: apple });
    }) as typeof fetch,
    log: { error: (...args: unknown[]) => { logs.push(args); } },
    ...options,
  };
  const handler = createAppleConnect(deps);
  const invoke = (body: object, token: string | null = "test-token") => handler(new Request("https://edge.example/apple-connect", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const discovery = { action: "discover", account_id: ACCOUNT, credential_id: CREDENTIAL };
  const previewBody = { action: "preview", app_id: APP, credential_id: CREDENTIAL };
  const preview = async (): Promise<ConnectPreview> => {
    const response = await invoke(previewBody);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    return (await response.json()).preview;
  };
  return { app, apple, attributes, calls, prepared, events, logs, invoke, discovery, previewBody, preview };
}

test("Apple app discovery uses scoped saved credentials and a valid short-lived ASC JWT without bid", async () => {
  const m = make();
  const res = await m.invoke(m.discovery);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { apps: [{ apple_app_id: "1234567890", name: "Café Timer", bundle_id: "com.example.cafe", production_url: null, sandbox_url: null, production_version: null, sandbox_version: null }], next_cursor: null });
  assert.equal(m.calls.length, 1);
  const call = m.calls[0];
  assert.equal(new URL(call.url).origin, APPLE_API);
  assert.equal(new URL(call.url).searchParams.get("limit"), "200");
  assert.equal(call.init.redirect, "manual");
  const jwt = (call.init.headers as Record<string, string>).authorization.slice(7);
  const [header, payload, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "ES256", kid: key.key_id, typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iss: key.issuer_id, iat: 1_800_000_000, exp: 1_800_000_300, aud: "appstoreconnect-v1" });
  assert(verify("sha256", Buffer.from(`${header}.${payload}`), { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  assert.equal(m.prepared.length, 0);
  assert.equal(m.logs.length, 0);
});

test("saved credential is required, account-scoped, and cannot fall back to posted raw secrets", async () => {
  let loaded = 0;
  const m = make({ credentials: async (id, account, user) => { loaded++; assert.equal(id, CREDENTIAL); assert.equal(account, ACCOUNT); assert.equal(user, USER); return null; } });
  const response = await m.invoke({ ...m.discovery, ...key });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "credential_not_found" });
  assert.equal(loaded, 1);
  assert.equal(m.calls.length, 0);
  assert.equal((await m.invoke({ ...m.discovery, credential_id: undefined, ...key })).status, 400);
});

test("app automation requires authenticated workspace owner/admin before decrypting or contacting Apple", async () => {
  let decrypted = false;
  const m = make({ canManage: async () => false, credentials: async () => { decrypted = true; return key; } });
  assert.equal((await m.invoke(m.discovery, null)).status, 401);
  assert.equal((await m.invoke(m.discovery)).status, 403);
  assert.equal((await m.invoke(m.previewBody)).status, 403);
  assert.equal(decrypted, false);
  assert.equal(m.calls.length, 0);
  assert.equal(m.prepared.length, 0);
});

test("invalid identifiers, keys and oversized bodies never reach Apple", async () => {
  const m = make();
  for (const body of [{ ...m.discovery, account_id: "bad" }, { ...m.discovery, credential_id: "bad" }, { ...m.previewBody, app_id: "bad" }, { ...m.discovery, action: "remove" }]) assert.equal((await m.invoke(body)).status, 400);
  assert.equal((await m.invoke({ ...m.discovery, padding: "x".repeat(20_000) })).status, 413);
  assert.equal((await make({ credentials: async () => ({ ...key, private_key: "bad" }) }).invoke(m.discovery)).status, 400);
  assert.equal(m.calls.length, 0);
});

test("discovery pagination encodes only an opaque cursor and rejects external next links", async () => {
  const m = make({ fetcher: (async (_url: unknown) => Response.json({ data: [], links: { next: `${APPLE_API}/v1/apps?cursor=abc%2Fdef` } })) as typeof fetch });
  assert.equal((await (await m.invoke(m.discovery)).json()).next_cursor, "abc/def");
  const normal = make();
  assert.equal((await normal.invoke({ ...normal.discovery, cursor: "abc/def?token=x" })).status, 200);
  assert.equal(new URL(normal.calls[0].url).searchParams.get("cursor"), "abc/def?token=x");
  const external = make({ fetcher: (async () => Response.json({ data: [], links: { next: "https://evil.example/apps?cursor=stolen" } })) as typeof fetch });
  assert.equal((await external.invoke(external.discovery)).status, 502);
});

test("preview derives targets server-side and preserves both existing V2 URLs", async () => {
  const m = make({}, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2", subscriptionStatusUrlForSandbox: "https://staging.example.com/apple", subscriptionStatusUrlVersionForSandbox: "V2" });
  const preview = await m.preview();
  assert.deepEqual(preview.target, { production_url: `${SITE}/hooks/apple/${m.app.webhook_key}/production`, sandbox_url: `${SITE}/hooks/apple/${m.app.webhook_key}/sandbox` });
  assert.deepEqual(preview.forwarding, { production_url: "https://api.example.com/apple", sandbox_url: "https://staging.example.com/apple" });
  assert.deepEqual(preview.expected_forwarding, { production_url: null, sandbox_url: null });
  assert.equal(preview.already_configured, false);
  assert.equal(m.prepared.length, 0);
});

test("when Apple sandbox URL is empty its production fallback is preserved for sandbox too", async () => {
  const m = make({}, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  assert.deepEqual((await m.preview()).forwarding, { production_url: "https://api.example.com/apple", sandbox_url: "https://api.example.com/apple" });
});

test("existing V1 destinations require manual setup because forwarding raw V2 would break them", async () => {
  const m = make({}, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V1" });
  const res = await m.invoke(m.previewBody);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "notification_v1_requires_manual_setup" });
  assert.equal(m.prepared.length, 0);
});

test("conflicting local forwarding is retained and automatic setup refuses to overwrite it", async () => {
  const m = make({}, { forward_url_production: "https://existing.example.com/apple" }, { subscriptionStatusUrl: "https://other.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const res = await m.invoke(m.previewBody);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "forwarding_conflict" });
  assert.equal(m.app.forward_url_production, "https://existing.example.com/apple");
  assert.equal(m.prepared.length, 0);
});

test("automatic forwarding refuses private destinations and other Salebell receiver URLs", async () => {
  for (const url of ["https://127.0.0.1/apple", "https://local.internal/apple", `${SITE}/hooks/apple/other/production`, "https://abcdefghijklmnopqrst.supabase.co/functions/v1/apple-webhook/other/production"]) {
    const m = make({}, {}, { subscriptionStatusUrl: url, subscriptionStatusUrlVersion: "V2" });
    const res = await m.invoke(m.previewBody);
    assert.equal(res.status, 409, url);
    assert.deepEqual(await res.json(), { error: "forwarding_requires_manual_setup" });
    assert.equal(m.prepared.length, 0);
  }
});

test("re-adding a deleted app replaces its old Salebell URLs without forwarding to them", async () => {
  const deletedKey = "b".repeat(32);
  const checked: string[] = [];
  const m = make({ receiverExists: async webhookKey => { checked.push(webhookKey); return false; } }, {}, {
    subscriptionStatusUrl: `${SITE}/hooks/apple/${deletedKey}/production`, subscriptionStatusUrlVersion: "V2",
    subscriptionStatusUrlForSandbox: `${SITE}/hooks/apple/${deletedKey}/sandbox`, subscriptionStatusUrlVersionForSandbox: "V2",
  });
  const preview = await m.preview();
  assert.deepEqual(preview.forwarding, { production_url: null, sandbox_url: null });
  assert.equal(preview.current.production_url, `${SITE}/hooks/apple/${deletedKey}/production`);
  assert.equal(preview.already_configured, false);
  assert.deepEqual(await (await m.invoke({ ...m.previewBody, action: "configure", preview })).json(), { configured: true, verified: false });
  assert(checked.length >= 2);
  assert(checked.every(webhookKey => webhookKey === deletedKey));
  assert.equal(m.attributes.subscriptionStatusUrl, preview.target.production_url);
  assert.equal(m.attributes.subscriptionStatusUrlForSandbox, preview.target.sandbox_url);
  assert.deepEqual(m.events, ["forwarding", "patch"]);
});

test("deleted direct Supabase receivers can be replaced and retain current forwarding", async () => {
  const deletedKey = "c".repeat(32);
  const m = make({}, { forward_url_production: "https://api.example.com/apple", forward_url_sandbox: "https://staging.example.com/apple" }, {
    subscriptionStatusUrl: `${SUPABASE}/functions/v1/apple-webhook/${deletedKey}/production`, subscriptionStatusUrlVersion: "V2",
  });
  const preview = await m.preview();
  assert.deepEqual(preview.forwarding, { production_url: "https://api.example.com/apple", sandbox_url: "https://staging.example.com/apple" });
  assert.deepEqual(await (await m.invoke({ ...m.previewBody, action: "configure", preview })).json(), { configured: true, verified: false });
  assert(m.calls.some(call => call.init.method === "PATCH"));
});

test("live Salebell receivers cannot be silently replaced during re-setup", async () => {
  const m = make({ receiverExists: async () => true }, {}, {
    subscriptionStatusUrl: `${SITE}/hooks/apple/${"b".repeat(32)}/production`, subscriptionStatusUrlVersion: "V2",
  });
  const response = await m.invoke(m.previewBody);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "forwarding_requires_manual_setup" });
  assert.equal(m.prepared.length, 0);
  assert(!m.calls.some(call => call.init.method === "PATCH"));
});

test("receiver recovery requires an exact valid receiver URL and a successful absence check", async () => {
  const receiver = `${SITE}/hooks/apple/${"b".repeat(32)}/production`;
  for (const url of [`${receiver}?destination=other`, `${receiver}#other`, `${receiver}/extra`, receiver.replace("b".repeat(32), "not-a-key")]) {
    let checked = false;
    const m = make({ receiverExists: async () => { checked = true; return false; } }, {}, { subscriptionStatusUrl: url, subscriptionStatusUrlVersion: "V2" });
    assert.equal((await m.invoke(m.previewBody)).status, 409, url);
    assert.equal(checked, false, url);
    assert.equal(m.prepared.length, 0);
  }
  const unavailable = make({ receiverExists: async () => { throw new Error("lookup unavailable"); } }, {}, { subscriptionStatusUrl: receiver, subscriptionStatusUrlVersion: "V2" });
  assert.equal((await unavailable.invoke(unavailable.previewBody)).status, 500);
  assert.equal(unavailable.prepared.length, 0);
  assert(!unavailable.calls.some(call => call.init.method === "PATCH"));
});

test("automatic setup preserves another Supabase project's notification receiver", async () => {
  for (const url of [
    "https://customer-project.supabase.co/functions/v1/apple-notifications",
    "https://customer-project.supabase.co/functions/v1/apple-webhook/customer/production",
  ]) {
    const m = make({}, {}, { subscriptionStatusUrl: url, subscriptionStatusUrlVersion: "V2" });
    const preview = await m.preview();
    assert.deepEqual(preview.forwarding, { production_url: url, sandbox_url: url });
    const response = await m.invoke({ ...m.previewBody, action: "configure", preview });
    assert.equal(response.status, 200, url);
    assert.equal(m.app.forward_url_production, url);
    assert.equal(m.app.forward_url_sandbox, url);
  }
});

test("a custom Supabase receiver hostname is guarded without rejecting neighboring projects", async () => {
  const own = make({ supabaseUrl: "https://edge.salebell.example" }, {}, {
    subscriptionStatusUrl: "https://edge.salebell.example/functions/v1/apple-webhook/old-key/production", subscriptionStatusUrlVersion: "V2",
  });
  assert.deepEqual(await (await own.invoke(own.previewBody)).json(), { error: "forwarding_requires_manual_setup" });
  const other = make({ supabaseUrl: "https://edge.salebell.example" }, {}, {
    subscriptionStatusUrl: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/apple-webhook/customer/production", subscriptionStatusUrlVersion: "V2",
  });
  assert.equal((await other.invoke(other.previewBody)).status, 200);
});

test("preview rejects an Apple ID or bundle mismatch and missing site configuration", async () => {
  const mismatch = make({}, {}, { bundleId: "com.someone.else" });
  assert.deepEqual(await (await mismatch.invoke(mismatch.previewBody)).json(), { error: "apple_app_mismatch" });
  const missing = make({ siteUrl: undefined });
  assert.equal((await missing.invoke(missing.previewBody)).status, 503);
  assert.equal(missing.calls.length, 0);
  const local = make({}, { apple_app_id: null });
  assert.equal((await local.invoke(local.previewBody)).status, 400);
});

test("configure saves forwarding before PATCH and explicitly saves V2 for both environments", async () => {
  const m = make({}, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const preview = await m.preview();
  const res = await m.invoke({ ...m.previewBody, action: "configure", preview });
  assert.deepEqual(await res.json(), { configured: true, verified: false });
  assert.deepEqual(m.events, ["forwarding", "patch"]);
  assert.equal(m.app.forward_url_production, "https://api.example.com/apple");
  assert.equal(m.app.forward_url_sandbox, "https://api.example.com/apple");
  assert.deepEqual(JSON.parse(String(m.calls.at(-1)!.init.body)), { data: { type: "apps", id: "1234567890", attributes: {
    subscriptionStatusUrl: preview.target.production_url, subscriptionStatusUrlForSandbox: preview.target.sandbox_url,
    subscriptionStatusUrlVersion: "V2", subscriptionStatusUrlVersionForSandbox: "V2",
  } } });
});

test("configure rejects stale Apple settings, changed local forwarding and edited target previews", async () => {
  for (const change of ["apple", "local", "target"] as const) {
    const m = make();
    const preview = await m.preview();
    if (change === "apple") Object.assign(m.attributes, { subscriptionStatusUrl: "https://new.example.com/apple", subscriptionStatusUrlVersion: "V2" });
    if (change === "local") m.app.forward_url_production = "https://new.example.com/apple";
    if (change === "target") preview.target.production_url = "https://evil.example.com/apple";
    const res = await m.invoke({ ...m.previewBody, action: "configure", preview });
    assert.equal(res.status, 409, change);
    assert.deepEqual(await res.json(), { error: "preview_changed" });
    assert.equal(m.prepared.length, 0);
    assert(!m.calls.some(c => c.init.method === "PATCH"));
  }
});

test("configure aborts if the locked forwarding RPC detects a concurrent app change", async () => {
  const m = make({ prepareForwarding: async () => "preview_changed" });
  const res = await m.invoke({ ...m.previewBody, action: "configure", preview: await m.preview() });
  assert.equal(res.status, 409);
  assert(!m.calls.some(c => c.init.method === "PATCH"));
});

test("deleting a saved credential after preview prevents configuration without a raw-key fallback", async () => {
  let active = true;
  const m = make({ credentials: async () => active ? key : null });
  const preview = await m.preview();
  active = false;
  const callsBefore = m.calls.length;
  const res = await m.invoke({ ...m.previewBody, action: "configure", preview, ...key });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "credential_not_found" });
  assert.equal(m.calls.length, callsBefore);
  assert.equal(m.prepared.length, 0);
});

test("a membership removal discovered by the guarded RPC prevents Apple mutation", async () => {
  const m = make({ prepareForwarding: async () => "forbidden" });
  const res = await m.invoke({ ...m.previewBody, action: "configure", preview: await m.preview() });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: "admin_required" });
  assert(!m.calls.some(c => c.init.method === "PATCH"));
});

test("an Apple URL change during forwarding preparation aborts PATCH and retains preserved forwarding", async () => {
  const m = make({ prepareForwarding: async args => {
    m.app.forward_url_production = args.forwarding.production_url;
    m.app.forward_url_sandbox = args.forwarding.sandbox_url;
    m.attributes.subscriptionStatusUrl = "https://changed.example.com/apple";
    return "ok";
  } }, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const preview = await m.preview();
  const response = await m.invoke({ ...m.previewBody, action: "configure", preview });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "preview_changed" });
  assert(!m.calls.some(c => c.init.method === "PATCH"));
  assert.equal(m.app.forward_url_production, "https://api.example.com/apple");
  assert.equal(m.app.forward_url_sandbox, "https://api.example.com/apple");
});

test("a local app change after forwarding preparation aborts PATCH without undoing preserved forwarding", async () => {
  const m = make({ prepareForwarding: async args => {
    m.app.forward_url_production = args.forwarding.production_url;
    m.app.forward_url_sandbox = args.forwarding.sandbox_url;
    m.app.webhook_key = "b".repeat(32);
    return "ok";
  } }, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const response = await m.invoke({ ...m.previewBody, action: "configure", preview: await m.preview() });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "preview_changed" });
  assert(!m.calls.some(c => c.init.method === "PATCH"));
  assert.equal(m.app.forward_url_production, "https://api.example.com/apple");
  assert.equal(m.app.forward_url_sandbox, "https://api.example.com/apple");
});

test("a forwarding change after preparation aborts PATCH and retains the newer local destination", async () => {
  const m = make({ prepareForwarding: async args => {
    m.app.forward_url_production = "https://new.example.com/apple";
    m.app.forward_url_sandbox = args.forwarding.sandbox_url;
    return "ok";
  } }, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const response = await m.invoke({ ...m.previewBody, action: "configure", preview: await m.preview() });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "preview_changed" });
  assert(!m.calls.some(c => c.init.method === "PATCH"));
  assert.equal(m.app.forward_url_production, "https://new.example.com/apple");
});

test("already configured URLs are idempotent and preserve existing forwarding", async () => {
  const m = make({}, { forward_url_production: "https://api.example.com/apple" }, { subscriptionStatusUrl: `${SITE}/hooks/apple/${"a".repeat(32)}/production`, subscriptionStatusUrlForSandbox: `${SITE}/hooks/apple/${"a".repeat(32)}/sandbox`, subscriptionStatusUrlVersion: "V2", subscriptionStatusUrlVersionForSandbox: "V2" });
  const preview = await m.preview();
  assert.equal(preview.already_configured, true);
  assert.equal(preview.forwarding.production_url, "https://api.example.com/apple");
  assert.deepEqual(await (await m.invoke({ ...m.previewBody, action: "configure", preview })).json(), { configured: true, verified: false });
  assert(!m.calls.some(c => c.init.method === "PATCH"));
});

test("failed Apple configuration retains prepared forwarding and reports unknown remote state", async () => {
  const m = make({}, {}, { subscriptionStatusUrl: "https://api.example.com/apple", subscriptionStatusUrlVersion: "V2" });
  const preview = await m.preview();
  const failing = createAppleConnect({
    getUser: async () => ({ id: USER }), canManage: async () => true, app: async () => m.app, credentials: async () => key,
    receiverExists: async () => true,
    rateLimit: async () => 0, siteUrl: SITE,
    prepareForwarding: async args => { m.app.forward_url_production = args.forwarding.production_url; m.app.forward_url_sandbox = args.forwarding.sandbox_url; return "ok"; },
    fetcher: (async (_url: unknown, init: RequestInit) => { if (init?.method === "PATCH") throw new Error(`secret ${key.private_key}`); return Response.json({ data: m.apple }); }) as typeof fetch,
    log: { error() { throw new Error("Secret-bearing exception must not be logged"); } },
  });
  const res = await failing(new Request("https://edge.example", { method: "POST", headers: { authorization: "Bearer test-token" }, body: JSON.stringify({ ...m.previewBody, action: "configure", preview }) }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "apple_configuration_unconfirmed" });
  assert.equal(m.app.forward_url_production, "https://api.example.com/apple");
});

test("rate limiting fails closed and prevents decryption/network activity", async () => {
  let loaded = false;
  const m = make({ rateLimit: async () => { throw new Error("database unavailable"); }, credentials: async () => { loaded = true; return key; } });
  assert.equal((await m.invoke({ ...m.previewBody, action: "configure", preview: {} })).status, 503);
  assert.equal(loaded, false);
  assert.equal(m.calls.length, 0);
  const limited = make({ rateLimit: async () => 12 });
  const response = await limited.invoke(limited.discovery);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "12");
});

test("Apple rejects and upstream exceptions return generic errors without reflecting or logging secrets", async () => {
  for (const [status, code] of [[401, "apple_rejected_key"], [403, "apple_permission_denied"], [429, "apple_rate_limited"]] as const) {
    const m = make({ fetcher: (async () => Response.json({ errors: [{ detail: key.private_key }] }, { status })) as typeof fetch });
    assert.deepEqual(await (await m.invoke(m.discovery)).json(), { error: code });
    assert.equal(m.logs.length, 0);
  }
  const m = make({ credentials: async () => { throw new Error(key.private_key); } });
  assert.deepEqual(await (await m.invoke(m.discovery)).json(), { error: "internal_error" });
  assert.deepEqual(m.logs, [["apple-connect request failed"]]);
});
