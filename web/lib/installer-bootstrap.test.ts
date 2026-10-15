import test from "node:test";
import assert from "node:assert/strict";
import { initialInstallRedirect } from "./installer-bootstrap.ts";
const env = { VERCEL: "1", SALEBELL_BROWSER_INSTALL: "true", NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" };
test("initial browser deployment sends visitors to setup before application schema exists", async () => {
  const destination = await initialInstallRedirect(new URL("https://app.vercel.app/login"), env, async () => new Response(null, { status: 404 }));
  assert.equal(destination?.href, "https://app.vercel.app/install");
});
test("initialized instances and ordinary cloud deployments retain their login flow", async () => {
  assert.equal(await initialInstallRedirect(new URL("https://app.vercel.app/login"), env, async () => Response.json({ deployment_mode: "self_hosted", billing_enabled: false })), null);
  assert.equal(await initialInstallRedirect(new URL("https://app.vercel.app/login"), { ...env, NEXT_PUBLIC_DEPLOYMENT_MODE: "cloud" }, async () => { throw new Error("must not fetch"); }), null);
});
