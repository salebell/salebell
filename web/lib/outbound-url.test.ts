import assert from "node:assert/strict";
import { test } from "node:test";
import { outboundUrlError } from "./outbound-url.ts";

test("accepts public https URLs", () => {
  for (const ok of ["https://api.example.com/apple", "https://hooks.slack.com/services/T/B/x", "https://ntfy.example.com"]) {
    assert.equal(outboundUrlError(ok), null, ok);
  }
});

test("rejects http, localhost and IP literals", () => {
  for (const bad of [
    "http://api.example.com",
    "https://localhost/x",
    "https://app.localhost",
    "https://127.0.0.1/x",
    "https://2130706433/x",
    "https://0x7f.1/x",
    "https://10.0.0.5",
    "https://[::1]/x",
    "not a url",
  ]) {
    assert.notEqual(outboundUrlError(bad), null, bad);
  }
});
