import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryError, functionError } from "./errors.ts";

test("delivery errors read as plain words", () => {
  assert.equal(deliveryError("connection_failed"), "Couldn't connect");
  assert.equal(deliveryError("timeout"), "Timed out");
  assert.equal(deliveryError("http_502"), "Your server returned 502");
  assert.equal(deliveryError(null, 404), "Your server returned 404");
  assert.equal(deliveryError("blocked_destination"), "That address isn't allowed");
  assert.equal(deliveryError("paused_on_free"), "Paused on the Free plan");
});

test("rate limits say how long to wait", async () => {
  const error = { context: new Response(JSON.stringify({ error: "rate_limited", retry_after: 42 }), { status: 429 }) };
  assert.equal(await functionError(error, "fallback"), "Slow down, try again in 42s.");
});
