import assert from "node:assert/strict";
import { test } from "node:test";
import { appDetailsError, newAppPayload } from "./app-form.ts";

test("Android app creation stores the package identifier and excludes Apple metadata", () => {
  assert.deepEqual(newAppPayload("example-account", "play_store", " Example App ", " com.example.app ", "1234567890"), {
    account_id: "example-account", name: "Example App", store: "play_store", bundle_id: "com.example.app", package_name: "com.example.app", apple_app_id: null,
  });
});

test("Apple app creation retains its numeric ID without a Google package", () => {
  assert.deepEqual(newAppPayload("example-account", "app_store", "Example App", "com.example.app", "1234567890"), {
    account_id: "example-account", name: "Example App", store: "app_store", bundle_id: "com.example.app", package_name: null, apple_app_id: 1234567890,
  });
});

test("Android package validation rejects invalid Java segments and ignores Apple ID", () => {
  assert.equal(appDetailsError("play_store", "com.example.app", "not-an-apple-id"), null);
  for (const value of ["app", "com.example-app", "com.1example.app", "com..app", "com.example.", "com." + "a".repeat(252)]) assert.ok(appDetailsError("play_store", value));
  assert.equal(appDetailsError("app_store", "com.example.app", "1234567890"), null);
  assert.ok(appDetailsError("app_store", "com.example.app", "123"));
});
