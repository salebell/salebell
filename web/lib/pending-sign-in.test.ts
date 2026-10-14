import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_MINUTES, pendingSignIn, resendIn } from "./pending-sign-in.ts";

const now = 2_000_000;

test("a refreshed sign-in can resume an unexpired code request", () => {
  const request = { email: "dev@example.com", sentAt: now - 30_000 };
  assert.deepEqual(pendingSignIn(JSON.stringify(request), now), request);
  assert.equal(resendIn(request.sentAt, now), 30);
  assert.equal(resendIn(request.sentAt, now + 31_000), 0);
});

test("expired, corrupt and future code requests start a fresh sign-in", () => {
  for (const raw of [
    null,
    "broken",
    "null",
    "{}",
    JSON.stringify({ email: "", sentAt: now }),
    JSON.stringify({ email: "dev@example.com", sentAt: "today" }),
    JSON.stringify({ email: "dev@example.com", sentAt: now + 1 }),
    JSON.stringify({ email: "dev@example.com", sentAt: now - CODE_MINUTES * 60_000 }),
  ]) assert.equal(pendingSignIn(raw, now), null, String(raw));
});

test("resend countdown rounds up until the cooldown has elapsed", () => {
  assert.equal(resendIn(now, now), 60);
  assert.equal(resendIn(now, now + 59_999), 1);
  assert.equal(resendIn(now, now + 60_000), 0);
});
