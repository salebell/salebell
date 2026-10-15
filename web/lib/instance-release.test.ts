import test from "node:test";
import assert from "node:assert/strict";
import { instanceRelease } from "./instance-release.ts";
const env = { VERCEL: "1", SALEBELL_BROWSER_INSTALL: "true", NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", NEXT_PUBLIC_SITE_URL: "https://instance.vercel.app", SALEBELL_INSTALLER_ORIGIN: "https://install.example", NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "sb_secret_private", INSTALLER_SUPABASE_CLIENT_SECRET: "oauth-private" };
test("setup discovery exposes public connection settings without native or OAuth secrets", async () => {
  const response = instanceRelease("release", env);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.ok(body.includes('"publicKey":"public"')); assert.equal(body.includes("private"), false);
  assert.equal(JSON.parse(body).origin, env.NEXT_PUBLIC_SITE_URL);
});
test("ordinary deployments publish only their release fingerprint", async () => {
  assert.deepEqual(await instanceRelease("release", { ...env, SALEBELL_BROWSER_INSTALL: "false" }).json(), { release: "release" });
  assert.deepEqual(await instanceRelease("release", { ...env, NEXT_PUBLIC_DEPLOYMENT_MODE: "cloud" }).json(), { release: "release" });
});
