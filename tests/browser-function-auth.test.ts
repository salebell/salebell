import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAppleTest } from "../supabase/functions/apple-test/handler.ts";
import { createAppleConnect } from "../supabase/functions/apple-connect/handler.ts";
import { createAppleCredentials } from "../supabase/functions/apple-credentials/handler.ts";
import { createTestAlert } from "../supabase/functions/test-alert/handler.ts";
import { createDeleteAccount } from "../supabase/functions/delete-account/handler.ts";
import { createGoogleConnect } from "../supabase/functions/google-connect/handler.ts";
import { createServiceClient } from "../supabase/functions/_shared/supabase.ts";

test("native Supabase deployments authenticate protected functions through Auth rather than the legacy gateway", async () => {
  const release = JSON.parse(readFileSync(new URL("../web/installer/release.json", import.meta.url), "utf8")) as { functions: { slug: string; verifyJwt: boolean }[] };
  const factories = [
    ["apple-test", createAppleTest], ["apple-connect", createAppleConnect], ["apple-credentials", createAppleCredentials],
    ["test-alert", createTestAlert], ["delete-account", createDeleteAccount], ["google-connect", createGoogleConnect],
  ] as const;
  for (const [slug, factory] of factories) {
    assert.equal(release.functions.find(fn => fn.slug === slug)?.verifyJwt, false, `${slug} must accept modern signing keys at its Auth boundary`);
    const handler = factory({ getUser: async () => null } as unknown as Parameters<typeof factory>[0]);
    const response = await handler(new Request(`https://instance.example/functions/v1/${slug}`, { method: "POST", body: "{}" }));
    assert.equal(response.status, 401, `${slug} rejects anonymous callers before privileged operations`);
  }
});
test("server Auth verification accepts a new-format secret key while checking the caller bearer token", async () => {
  const client = createServiceClient("https://project.supabase.co", "sb_secret_private", async (url, init) => {
    assert.equal(String(url), "https://project.supabase.co/auth/v1/user");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "sb_secret_private");
    assert.equal(headers.get("authorization"), "Bearer signed-user-token");
    return Response.json({ id: "verified-user", email: "owner@example.com" });
  });
  assert.deepEqual(await client.getUser("signed-user-token"), { id: "verified-user", email: "owner@example.com" });
});
