import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  buildGoogleDiscoverRequest,
  findSavedGoogleApp,
  googleImportedAppName,
  loadSavedGoogleApp,
  parseGoogleDiscoveryPage,
} from "./google-import.ts";

const credentials = {
  type: "service_account" as const,
  project_id: "example-project",
  client_email: "notifications@example-project.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(512)}\n-----END PRIVATE KEY-----`,
};
const discoveredApp = { package_name: "com.example.app", display_name: "Example app" };
const apps = [
  { id: "ios", account_id: "workspace", package_name: "com.example.shared", store: "app_store" },
  { id: "other-workspace", account_id: "other", package_name: "com.example.shared", store: "play_store" },
  { id: "android", account_id: "workspace", package_name: "com.example.shared", store: "play_store" },
  { id: "ios-only", account_id: "workspace", package_name: "com.example.ios", store: "app_store" },
  { id: "unset", account_id: "workspace", package_name: null, store: "play_store" },
];

test("Google discovery parses app metadata and discards unexpected response fields", () => {
  const page = parseGoogleDiscoveryPage({
    apps: [{ package_name: " com.example.app ", display_name: " Example app ", credentials: "unused", id: "unused" }],
    next_cursor: "opaque+/cursor==",
    credentials: "unused",
  });
  assert.deepEqual(page, { apps: [discoveredApp], next_cursor: "opaque+/cursor==" });
  assert.deepEqual(parseGoogleDiscoveryPage({ apps: [], next_cursor: null }), { apps: [], next_cursor: null });
});

test("Google discovery falls back to package names for empty display names", () => {
  for (const display_name of ["", "  \n\t "]) {
    assert.deepEqual(parseGoogleDiscoveryPage({ apps: [{ package_name: "com.example.app", display_name }], next_cursor: null }), {
      apps: [{ package_name: "com.example.app", display_name: "com.example.app" }], next_cursor: null,
    });
  }
  assert.equal(parseGoogleDiscoveryPage({ apps: [{ ...discoveredApp, display_name: "A".repeat(500) }], next_cursor: null }).apps[0].display_name.length, 500);
});

test("Google discovery rejects malformed pages without returning a partial app list or raw details", () => {
  const secret = "SECRET_DO_NOT_ECHO";
  const malformed = [
    null, [], secret, {}, { apps: null, next_cursor: null }, { apps: {}, next_cursor: null },
    ...[null, [], secret, {}, { ...discoveredApp, package_name: null },
      { ...discoveredApp, package_name: "" }, { ...discoveredApp, package_name: "  " },
      { ...discoveredApp, package_name: "com..example" }, { ...discoveredApp, package_name: "com.1example.app" },
      { ...discoveredApp, package_name: `com.${secret}-invalid` }, { package_name: "com.example.app" },
      { ...discoveredApp, display_name: null }, { ...discoveredApp, display_name: {} },
      { ...discoveredApp, display_name: "A".repeat(501) },
    ].map((app) => ({ apps: [discoveredApp, app], next_cursor: null })),
    ...[undefined, 1, {}, [], "A".repeat(4097), "cursor\n", "cursor\u0000", "cursor\u007f"].map((next_cursor) => ({ apps: [discoveredApp], next_cursor })),
  ];
  for (const value of malformed) {
    assert.throws(() => parseGoogleDiscoveryPage(value), (error: unknown) => error instanceof Error && !error.message.includes(secret));
  }
});

test("Google discovery preserves opaque cursors up to the supported size", () => {
  for (const next_cursor of ["", " opaque cursor ", "A".repeat(4096)]) {
    assert.equal(parseGoogleDiscoveryPage({ apps: [], next_cursor }).next_cursor, next_cursor);
  }
});

test("Google discovery requests use the workspace and credentials with an optional opaque cursor", () => {
  assert.deepEqual(buildGoogleDiscoverRequest("workspace", credentials), {
    action: "discover", account_id: "workspace", credentials,
  });
  assert.deepEqual(buildGoogleDiscoverRequest("workspace", credentials, ""), {
    action: "discover", account_id: "workspace", credentials,
  });
  assert.deepEqual(buildGoogleDiscoverRequest("workspace", credentials, " opaque+/cursor== "), {
    action: "discover", account_id: "workspace", credentials, cursor: " opaque+/cursor== ",
  });
  for (const cursor of ["A".repeat(4097), "cursor\n", "cursor\u0000", "cursor\u007f"]) assert.throws(() => buildGoogleDiscoverRequest("workspace", credentials, cursor));
});

test("Google app matching requires the same workspace, store and package name", () => {
  assert.equal(findSavedGoogleApp(apps, "workspace", "com.example.shared")?.id, "android");
  assert.equal(findSavedGoogleApp(apps, "other", "com.example.shared")?.id, "other-workspace");
  assert.equal(findSavedGoogleApp(apps, "workspace", "com.example.ios"), undefined);
  assert.equal(findSavedGoogleApp(apps, "missing", "com.example.shared"), undefined);
  assert.equal(findSavedGoogleApp(apps, "workspace", "com.example.missing"), undefined);
  assert.equal(findSavedGoogleApp(apps, "workspace", ""), undefined);
});

test("Google import queries one saved Play Store app within its workspace through the real Supabase client", async () => {
  const requestedUrls: URL[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requestedUrls.push(url);
    assert.equal(url.origin, "https://supabase.example");
    assert.equal(url.pathname, "/rest/v1/apps");
    assert.equal(url.searchParams.get("select"), "*");
    assert.equal(url.searchParams.get("account_id"), "eq.workspace");
    assert.equal(url.searchParams.get("store"), "eq.play_store");
    const matching = apps.filter((app) => Object.entries(app).every(([key, value]) => {
      const filter = url.searchParams.get(key);
      return !filter || filter === `eq.${value}`;
    }));
    return Response.json(matching);
  }) as typeof fetch;
  const client = createClient<Database>("https://supabase.example", "test-anon-key", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await loadSavedGoogleApp(client, "workspace", "com.example.shared");
  assert.equal(error, null);
  assert.deepEqual(data, apps[2]);
  assert.equal(requestedUrls[0].searchParams.get("package_name"), "eq.com.example.shared");
  const crossStoreOnly = await loadSavedGoogleApp(client, "workspace", "com.example.ios");
  assert.equal(crossStoreOnly.error, null);
  assert.equal(crossStoreOnly.data, null);
  assert.equal(requestedUrls[1].searchParams.get("package_name"), "eq.com.example.ios");
  const missing = await loadSavedGoogleApp(client, "workspace", "com.example.missing");
  assert.equal(missing.error, null);
  assert.equal(missing.data, null);
  assert.equal(requestedUrls[2].searchParams.get("package_name"), "eq.com.example.missing");
  assert.equal(requestedUrls.length, 3);
});

test("Google imported names trim display metadata, fall back to the package, and fit the app name limit", () => {
  assert.equal(googleImportedAppName({ ...discoveredApp, display_name: "  Example app  " }), "Example app");
  assert.equal(googleImportedAppName({ ...discoveredApp, display_name: " \n\t " }), "com.example.app");
  assert.equal(googleImportedAppName({ ...discoveredApp, display_name: "  " + "A".repeat(150) + "  " }), "A".repeat(100));
  assert.equal(googleImportedAppName({ package_name: "com." + "a".repeat(150), display_name: "" }), "com." + "a".repeat(96));
  assert.equal(googleImportedAppName({ ...discoveredApp, display_name: "A".repeat(99) + "🎮" }), "A".repeat(99));
});
