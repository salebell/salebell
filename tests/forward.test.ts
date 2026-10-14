import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardRaw } from "../supabase/functions/_shared/core/forward.ts";

test("forwardRaw posts the body as-is with its content type and a loop marker", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fetcher = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response("ok", { status: 202 }); }) as unknown as typeof fetch;
  const r = await forwardRaw("https://api.example.com/apple", '{"signedPayload":"x"}', "application/json", fetcher);
  assert.deepEqual([r.ok, r.status], [true, 202]);
  assert.equal(seen!.init.body, '{"signedPayload":"x"}');
  assert.deepEqual(seen!.init.headers, { "content-type": "application/json", "x-salebell-forwarded": "1" });
  assert.equal(seen!.init.redirect, "manual");
});

test("forwardRaw reports errors and timeouts without throwing", async () => {
  const down = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual((await forwardRaw("https://x.example", "", "application/json", down)).status, 500);
  const hang = ((_u: string, init: RequestInit) => new Promise((_, reject) =>
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch;
  const r = await forwardRaw("https://x.example", "", "application/json", hang, 20);
  assert.equal(r.ok, false);
  assert.match(r.error!, /timed out|timeout|aborted/i);
});
