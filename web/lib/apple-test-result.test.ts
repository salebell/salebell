import assert from "node:assert/strict";
import { test } from "node:test";
import { appleTestDeliveryMessage } from "./apple-test-result.ts";

test("an accepted test request is pending rather than confirmed delivery", () => {
  assert.equal(appleTestDeliveryMessage(null, "sandbox").tone, "neutral");
  assert.match(appleTestDeliveryMessage(undefined, "sandbox").text, /pending/);
  assert.equal(appleTestDeliveryMessage("SUCCESS", "sandbox").tone, "accent");
});

test("receiver errors clearly fail delivery without inventing an HTTP status", () => {
  const result = appleTestDeliveryMessage("UNSUCCESSFUL_HTTP_RESPONSE_CODE", "sandbox");
  assert.equal(result.tone, "danger");
  assert.match(result.text, /unsuccessful HTTP response/);
  assert.doesNotMatch(result.text, /HTTP (400|401|404|500|503)/);
  assert.match(result.text, /up to an hour/);
  assert.doesNotMatch(appleTestDeliveryMessage("UNSUCCESSFUL_HTTP_RESPONSE_CODE", "production").text, /up to an hour/);
});
