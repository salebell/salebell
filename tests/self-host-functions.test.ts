import assert from "node:assert/strict";
import test from "node:test";
import { createFunctionRouter } from "../deploy/functions/handler.ts";

test("self-hosted runtime does not start workers for billing or unknown endpoints", async () => {
  const started: string[] = [];
  const handler = createFunctionRouter(async (slug) => {
    started.push(slug);
    return { fetch: async () => Response.json({ ok: true }) };
  });

  for (const slug of ["billing", "stripe-webhook", "unknown", ""]) {
    const response = await handler(new Request(`https://api.example.com/${slug}`, { method: "POST" }));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "function_not_found" });
  }
  assert.deepEqual(started, []);
});

test("self-hosted runtime forwards supported requests and their responses unchanged", async () => {
  const started: string[] = [];
  let received: Request | undefined;
  const handler = createFunctionRouter(async (slug) => {
    started.push(slug);
    return { fetch: async (request) => {
      received = request;
      return Response.json({ accepted: true }, { status: 202 });
    } };
  });

  for (const slug of ["apple-webhook", "apple-credentials", "apple-connect", "apple-test", "test-alert",
    "fx-refresh", "google-webhook", "google-connect", "delete-account"]) {
    const request = new Request(`https://api.example.com/${slug}/details?env=sandbox`, {
      method: "POST", headers: { authorization: "Bearer test-session" }, body: "original body",
    });
    const response = await handler(request);
    assert.equal(received, request);
    assert.equal(started.at(-1), slug);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
  }
});

test("worker failures return an unavailable response without exposing private error details", async () => {
  const handler = createFunctionRouter(async () => { throw new Error("private credential"); });
  const response = await handler(new Request("https://api.example.com/apple-webhook"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "function_unavailable" });
});
