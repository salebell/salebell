import test from "node:test";
import assert from "node:assert/strict";
import { seal, unseal, digest, newState, consumeState } from "./installer-security.ts";
import { installerConfig, siteOrigin, deployUrl, deploymentOrigin } from "./installer-config.ts";

const key = "ab".repeat(32);
test("installer encryption rejects tampering and another session", () => {
  const encrypted = seal({ token: "private" }, key, "session-a");
  assert.deepEqual(unseal(encrypted, key, "session-a"), { token: "private" });
  assert.throws(() => unseal(encrypted, key, "session-b"));
  assert.throws(() => unseal(encrypted.slice(0, -3) + "xxx", key, "session-a"));
  assert.equal(encrypted.includes("private"), false);
});
test("OAuth state is bound to a provider, expires and is consumed once", () => {
  const { value, pending } = newState("supabase", 1000);
  assert.equal(pending.hash, digest(value));
  assert.throws(() => consumeState({ ...pending, provider: "other" } as unknown as typeof pending, value, "supabase", 1001));
  assert.throws(() => consumeState(pending, value, "supabase", 601001));
  assert.equal(consumeState(pending, value, "supabase", 1001), undefined);
  assert.throws(() => consumeState(undefined, value, "supabase", 1002));
});
test("installer is inactive unless explicitly configured", () => {
  assert.equal(installerConfig({}), null);
  assert.throws(() => installerConfig({ INSTALLER_ENABLED: "true" }), /configuration/i);
});
test("website origin derives only from Vercel production metadata", () => {
  assert.equal(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://custom.example" }), "https://custom.example");
  assert.equal(siteOrigin({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app" }), "https://app.vercel.app");
  assert.throws(() => siteOrigin({ VERCEL_URL: "preview.vercel.app" }));
  assert.throws(() => siteOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "app.vercel.app" }));
  assert.throws(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://example.com/path" }));
  assert.throws(() => siteOrigin({ VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "evil.example/path" }));
});
test("deploy link pins the whole repository and uses native Supabase without Vercel OAuth", () => {
  const url = new URL(deployUrl({ origin: "https://install.example", releaseRef: "a".repeat(40), supabaseProduct: "supabase" }));
  assert.equal(url.origin, "https://vercel.com");
  assert.equal(url.searchParams.get("repository-url"), `https://github.com/salebell/salebell/tree/${"a".repeat(40)}`);
  assert.equal(url.searchParams.get("root-directory"), "web");
  assert.equal(url.searchParams.has("external-id"), false);
  assert.equal(url.searchParams.has("integration-ids"), false);
  assert.equal(url.searchParams.has("redirect-url"), false);
  assert.deepEqual(JSON.parse(url.searchParams.get("envDefaults")!), { NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", SALEBELL_BROWSER_INSTALL: "true", SALEBELL_INSTALLER_ORIGIN: "https://install.example" });
  assert.deepEqual(JSON.parse(url.searchParams.get("products")!), [{ type: "integration", integrationSlug: "supabase", productSlug: "supabase", protocol: "storage" }]);
});

test("installer configuration requires only Supabase OAuth, never Vercel credentials", () => {
  const config = installerConfig({ INSTALLER_ENABLED: "true", INSTALLER_ORIGIN: "https://install.example", INSTALLER_SUPABASE_CLIENT_ID: "client", INSTALLER_SUPABASE_CLIENT_SECRET: "secret", INSTALLER_ENCRYPTION_KEY: key, INSTALLER_CONTROL_URL: "https://control.supabase.co", INSTALLER_CONTROL_KEY: "private", INSTALLER_RELEASE_REF: "a".repeat(40), INSTALLER_SUPABASE_PRODUCT: "supabase", INSTALLER_CLEANUP_SECRET: "cleanup" });
  assert.ok(config);
  assert.equal("vercelSecret" in config, false);
});
test("deployment addresses reject nonprovider origins, credentials, ports and paths", () => {
  assert.equal(deploymentOrigin("https://my-site.vercel.app/"), "https://my-site.vercel.app");
  for (const site of ["http://app.vercel.app", "https://localhost", "https://127.0.0.1", "https://app.vercel.app.evil.com", "https://evil.com", "https://a.b.vercel.app", "https://user@app.vercel.app", "https://app.vercel.app:8443", "https://app.vercel.app/path", "https://app.vercel.app?x=1"]) assert.throws(() => deploymentOrigin(site));
});
