import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createAppleCredentials, type Deps, type SaveCredential } from "../supabase/functions/apple-credentials/handler.ts";
import { loadAppleCredentials, type AppleCredentialMetadata } from "../supabase/functions/_shared/credentials.ts";
import type { ServiceClient } from "../supabase/functions/_shared/supabase.ts";

const ACCOUNT = "aaaaaaaa-0000-4000-8000-000000000001";
const ID = "cccccccc-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";
const ISSUER = "dddddddd-0000-4000-8000-000000000001";
const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const row: AppleCredentialMetadata = { id: ID, label: "Studio", provider: "apple_connect", key_id: "ABCDE12345",
  issuer_id: ISSUER, created_at: "2026-10-13T12:00:00Z", updated_at: "2026-10-13T12:00:00Z" };
const body = { action: "save", account_id: ACCOUNT, label: "Studio", key_id: "ABCDE12345", issuer_id: ISSUER, private_key: p8 };
const request = (value: unknown, token = "good") => new Request("https://example.com/apple-credentials", {
  method: "POST", body: JSON.stringify(value), headers: { authorization: `Bearer ${token}` },
});
function setup(overrides: Partial<Deps> = {}) {
  const saved: SaveCredential[] = [];
  const removed: unknown[] = [];
  const deps: Deps = {
    getUser: async token => token === "good" ? { id: USER } : null,
    canManage: async account => account === ACCOUNT,
    rateLimit: async () => 0,
    list: async () => [{ ...row, private_key: "never_return_this", vault_secret_id: "never_return_this" } as AppleCredentialMetadata],
    save: async value => { saved.push(value); return { ...row, private_key: value.privateKey } as AppleCredentialMetadata; },
    remove: async (...args) => { removed.push(args); return true; },
    log: { error() {} },
    ...overrides,
  };
  return { handler: createAppleCredentials(deps), saved, removed };
}

test("saved Apple connections return metadata only on save and list", async () => {
  const h = setup();
  const res = await h.handler(request(body));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { credential: row });
  assert.equal(h.saved[0].privateKey, p8.trim());
  assert.equal(h.saved[0].userId, USER);
  assert.equal(h.saved[0].provider, "apple_connect");
  const list = await h.handler(request({ action: "list", account_id: ACCOUNT }));
  assert.deepEqual(await list.json(), { credentials: [row] });
});

test("saved connection replacement keeps its id and purchase testing has a separate provider", async () => {
  const h = setup();
  assert.equal((await h.handler(request({ ...body, credential_id: ID, provider: "apple_iap" }))).status, 200);
  assert.equal(h.saved[0].id, ID);
  assert.equal(h.saved[0].provider, "apple_iap");
  const deleted = await h.handler(request({ action: "delete", account_id: ACCOUNT, credential_id: ID }));
  assert.deepEqual(await deleted.json(), { deleted: true });
  assert.deepEqual(h.removed, [[ID, ACCOUNT, USER]]);
  assert.equal((await setup({ remove: async () => false }).handler(request({ action: "delete", account_id: ACCOUNT, credential_id: ID }))).status, 404);
});

test("credential management rejects unsigned, non-admin and other-account callers before storage", async () => {
  const h = setup();
  assert.equal((await h.handler(request(body, "invalid"))).status, 401);
  assert.equal((await h.handler(request({ ...body, account_id: "eeeeeeee-0000-4000-8000-000000000001" }))).status, 403);
  assert.equal((await setup({ canManage: async () => false }).handler(request(body))).status, 403);
  assert.equal(h.saved.length, 0);
});

test("malformed credential files and metadata are rejected without echoing the key", async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const h = setup();
  for (const patch of [
    { private_key: "secret-file-content" }, { private_key: rsa }, { private_key: "x".repeat(4_001) },
    { issuer_id: "invalid" }, { key_id: "invalid" }, { label: " " }, { credential_id: "invalid" },
    { provider: "apns" }, { account_id: "invalid" },
  ]) {
    const response = await h.handler(request({ ...body, ...patch }));
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /secret-file-content|BEGIN PRIVATE KEY/);
  }
  assert.equal(h.saved.length, 0);
});

test("credential request sizes are bounded and storage/limiter failures do not reveal secrets", async () => {
  const h = setup();
  assert.equal((await h.handler(request({ ...body, label: "x".repeat(21_000) }))).status, 400);
  for (const overrides of [
    { rateLimit: async () => { throw new Error(p8); } },
    { save: async () => { throw new Error(p8); } },
  ]) {
    const failing = setup(overrides);
    const response = await failing.handler(request(body));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "credential_storage_unavailable" });
  }
  const limited = await setup({ rateLimit: async () => 42 }).handler(request(body));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "42");
});

test("server credential loading binds id, workspace, caller and Apple service", async () => {
  let args: unknown;
  const db = { rpc: async (name: string, values: unknown) => { args = { name, values }; return null; } } as unknown as ServiceClient;
  assert.equal(await loadAppleCredentials(db, ID, ACCOUNT, USER, "apple_iap"), null);
  assert.deepEqual(args, { name: "load_apple_credential", values: { p_id: ID, p_account: ACCOUNT, p_user: USER, p_provider: "apple_iap" } });
});

test("known credential lifecycle errors are actionable without exposing database details", async () => {
  for (const [message, status] of [["credential_limit", 409], ["credential_not_found", 404], ["admin_required", 403]] as const) {
    const h = setup({ save: async () => { throw new Error(`RPC failed: ${JSON.stringify({ message, detail: p8 })}`); } });
    const response = await h.handler(request(body));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: message });
  }
});
