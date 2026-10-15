import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { findSavedAppleApp, loadSavedAppleApp } from "./apple-connect.ts";

const apps = [
  { id: "android", account_id: "workspace", bundle_id: "com.example.shared", apple_app_id: null, store: "play_store" },
  { id: "ios", account_id: "workspace", bundle_id: "com.example.shared", apple_app_id: 12345, store: "app_store" },
  { id: "other-workspace", account_id: "other", bundle_id: "com.example.shared", apple_app_id: 67890, store: "app_store" },
];

test("Apple connection details select the iOS app when Android shares its identifier", () => {
  assert.equal(findSavedAppleApp(apps.slice(0, 2), "com.example.shared")?.id, "ios");
  assert.equal(findSavedAppleApp(apps.slice(0, 1), "com.example.shared"), undefined);
  assert.equal(findSavedAppleApp(apps, undefined), undefined);
});

test("Apple import looks up one saved App Store app within its workspace", async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const matching = apps.filter((app) => Object.entries(app).every(([key, value]) => {
      const filter = url.searchParams.get(key);
      return !filter || filter === `eq.${value}`;
    }));
    return Response.json(matching.map(({ id, bundle_id, apple_app_id }) => ({ id, bundle_id, apple_app_id })));
  }) as typeof fetch;
  const client = createClient<Database>("https://supabase.example", "test-anon-key", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await loadSavedAppleApp(client, "workspace", "com.example.shared");
  assert.equal(error, null);
  assert.deepEqual(data, { id: "ios", bundle_id: "com.example.shared", apple_app_id: 12345 });
  assert.equal((await loadSavedAppleApp(client, "workspace", "com.example.missing")).data, null);
});
