import assert from "node:assert/strict";
import { test } from "node:test";
import { authRedirect } from "./auth-redirect.ts";

const origin = "https://salebell.vercel.app";
const route = (path: string, signedIn: boolean) => authRedirect(new URL(path, origin), signedIn);

test("returning users land in the app from the homepage, retaining query parameters", () => {
  assert.equal(route("/", true)?.href, `${origin}/app`);
  assert.equal(route("/?utm_source=email", true)?.href, `${origin}/app?utm_source=email`);
  assert.equal(route("/", false), null);
});

test("signed-out app visits retain their exact destination through login", () => {
  for (const path of ["/app", "/app/new?store=apple", "/app/apps/123/setup?from=home"]) {
    const login = route(path, false);
    assert.equal(login?.origin, origin);
    assert.equal(login?.pathname, "/login");
    assert.equal(login?.searchParams.get("next"), path);
  }
});

test("signed-in login visits retain safe destinations and reject external or looping ones", () => {
  assert.equal(route("/login?next=%2Fapp%2Fnew%3Fstore%3Dapple", true)?.href, `${origin}/app/new?store=apple`);
  for (const next of ["//evil.com", "/login?next=/app", "/auth/callback?code=old"]) {
    assert.equal(route(`/login?next=${encodeURIComponent(next)}`, true)?.href, `${origin}/app`);
  }
});

test("public pages remain available and app visits do not redirect signed-in users", () => {
  for (const signedIn of [true, false]) {
    for (const path of ["/docs", "/privacy", "/apple"]) {
      assert.equal(route(path, signedIn), null);
    }
  }
  assert.equal(route("/app/new", true), null);
  assert.equal(route("/login", false), null);
});
