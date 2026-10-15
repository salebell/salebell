import test from "node:test";
import assert from "node:assert/strict";
import { seal, unseal, digest, newState, consumeState } from "./installer-security.ts";
import { installerConfig, siteOrigin, deployUrl } from "./installer-config.ts";

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
  assert.throws(() => consumeState(pending, value, "vercel", 1001));
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
test("deploy link pins the whole repository and binds its callback", () => {
  const url = new URL(deployUrl({ origin: "https://install.example", releaseRef: "a".repeat(40), vercelClientId: "oac_abc", supabaseProduct: "supabase" }, "session-state"));
  assert.equal(url.origin, "https://vercel.com");
  assert.equal(url.searchParams.get("repository-url"), `https://github.com/salebell/salebell/tree/${"a".repeat(40)}`);
  assert.equal(url.searchParams.get("root-directory"), "web");
  assert.equal(url.searchParams.get("external-id"), "session-state");
  assert.equal(url.searchParams.get("integration-ids"), "oac_abc");
  assert.equal(url.searchParams.get("redirect-url"), "https://install.example/deploy");
  assert.deepEqual(JSON.parse(url.searchParams.get("products")!), [{ type: "integration", integrationSlug: "supabase", productSlug: "supabase", protocol: "storage" }]);
});
