import assert from "node:assert/strict";
import { test } from "node:test";
import { safeNext } from "./safe-next.ts";

const origin = "https://salebell.vercel.app";

test("keeps same-origin paths with query and hash", () => {
  assert.equal(safeNext("/app/billing?checkout=success#top", origin), "/app/billing?checkout=success#top");
  assert.equal(safeNext("/app", origin), "/app");
});

test("falls back to /app for missing or cross-origin targets", () => {
  for (const bad of [null, "", "//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com/app", "javascript:alert(1)", "http://salebell.vercel.app/app"]) {
    assert.equal(safeNext(bad, origin), "/app", String(bad));
  }
});

test("avoids sending authenticated users back into sign-in", () => {
  assert.equal(safeNext("/login?next=/app/new", origin), "/app");
  assert.equal(safeNext("/login/?next=/app/new", origin), "/app");
  assert.equal(safeNext("/auth/callback?code=expired", origin), "/app");
});
