import test from "node:test";
import assert from "node:assert/strict";
import { finishOwner } from "./installer-owner.ts";
import type { InstallJob } from "./installer-types.ts";

const make = (): InstallJob => ({ id: "72b256b8-1426-4ac3-8d3a-9a77d85fae1f", version: 1, phase: "owner", cursor: 0, createdAt: 1, expiresAt: Date.now() + 100000, ownerEmail: "owner@example.com", target: { projectName: "salebell", supabaseRef: "abcdefghijklmnopqrst", supabaseName: "db", publicKey: "public", origin: "https://app.vercel.app" } });
test("existing owner is authenticated without creating or resetting a password, then the check session is revoked", async () => {
  let loggedOut = false;
  const result = await finishOwner(make(), "owner@example.com", "long-password", "sb_secret_server", async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert.notEqual(init?.method, "PUT");
    if (path.endsWith("/admin/users")) {
      assert.notEqual(init?.method, "POST");
      return Response.json({ users: [{ id: "user-one", email: "owner@example.com" }] });
    }
    if (path.endsWith("/token")) return Response.json({ access_token: "owner-jwt", user: { id: "user-one", email: "owner@example.com" } });
    if (path.endsWith("/accounts")) return Response.json([{ id: "workspace" }]);
    if (path.endsWith("/test-alert")) return Response.json({ error: "invalid_app_id" }, { status: 400 });
    if (path.endsWith("/logout")) { loggedOut = true; return new Response(null, { status: 204 }); }
    throw new Error("unexpected request");
  });
  assert.equal(result.phase, "complete"); assert.ok(loggedOut);
  assert.equal(JSON.stringify(result).includes("long-password"), false);
});
test("a different existing user stops owner creation", async () => {
  const j = make();
  await assert.rejects(finishOwner(j, "owner@example.com", "long-password", "server", async () => Response.json({ users: [{ id: "other", email: "stranger@example.com" }] })), /owner_conflict/);
});
