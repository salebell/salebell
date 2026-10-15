import test from "node:test";
import assert from "node:assert/strict";
import { instanceHealth } from "./instance-health.ts";
test("instance health requires database self-hosted entitlements", async () => {
  const values = { origin: "https://app.vercel.app", supabaseUrl: "https://db.supabase.co", publicKey: "sb_publishable_public", release: "release-one" };
  const ready = await instanceHealth(values, async () => Response.json({ deployment_mode: "self_hosted", billing_enabled: false }));
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { release: "release-one", mode: "self_hosted", origin: "https://app.vercel.app" });
  const missing = await instanceHealth(values, async () => new Response("private SQL details", { status: 404 }));
  assert.equal(missing.status, 503); assert.equal((await missing.text()).includes("SQL"), false);
  assert.equal((await instanceHealth(values, async () => Response.json({ deployment_mode: "cloud", billing_enabled: true }))).status, 503);
});
