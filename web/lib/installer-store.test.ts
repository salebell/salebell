import test from "node:test";
import assert from "node:assert/strict";
import { InstallerStore } from "./installer-store.ts";
import type { InstallJob } from "./installer-types.ts";

const config = { controlUrl: "https://control.supabase.co", controlKey: "sb_secret_private", encryptionKey: "ab".repeat(32) };
test("control storage encrypts provider credentials and never sends a secret key as a bearer JWT", async () => {
  let checked = false;
  const store = new InstallerStore(config, async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), null);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_document.supabase, undefined);
    assert.equal(body.p_document.pending, undefined);
    assert.equal(String(init?.body).includes("provider-token"), false);
    checked = true;
    return Response.json({ ...body.p_document, version: 1 });
  });
  const job: InstallJob = { id: "72b256b8-1426-4ac3-8d3a-9a77d85fae1f", version: 0, phase: "clone", cursor: 0, createdAt: 100, expiresAt: 100000, supabase: { access: "provider-token" } };
  await store.create(job, "hash");
  assert.ok(checked);
});
test("missing session and CAS conflict fail closed", async () => {
  const store = new InstallerStore(config, async () => Response.json(null));
  await assert.rejects(store.read("72b256b8-1426-4ac3-8d3a-9a77d85fae1f", "wrong"), /session_expired/);
  await assert.rejects(store.acquire("72b256b8-1426-4ac3-8d3a-9a77d85fae1f", "wrong"), /busy_or_expired/);
});
