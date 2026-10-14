import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockedDestinationError, createGuardedFetch, isAllowedHostname, isPrivateAddress } from "../supabase/functions/_shared/core/net.ts";
import { type Channel, dispatch } from "../supabase/functions/_shared/core/alerts.ts";
import { forwardRaw } from "../supabase/functions/_shared/core/forward.ts";
import type { StoreEvent } from "../supabase/functions/_shared/core/events.ts";

test("private, loopback, link-local and reserved addresses are recognised", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2001:db8::1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["93.184.215.14", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("hostname rules match the database check", () => {
  for (const h of ["api.example.com", "hooks.slack.com", "xn--bcher-kva.example", "ntfy.sh"]) assert.equal(isAllowedHostname(h), true, h);
  for (const h of ["127.0.0.1", "localhost", "foo.localhost", "printer.local", "metadata.google.internal", "intranet", "[::1]", "10.0.0.1", ""]) {
    assert.equal(isAllowedHostname(h), false, h);
  }
});

function guard(dns: Record<string, string[]>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const base = (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return new Response("ok"); }) as unknown as typeof fetch;
  const resolve = async (host: string) => {
    if (!(host in dns)) throw new Error(`NXDOMAIN ${host}`);
    return dns[host];
  };
  return { calls, fetch: createGuardedFetch(resolve, base) };
}

test("guarded fetch blocks private destinations and never follows redirects", async () => {
  const g = guard({ "api.example.com": ["93.184.215.14"], "rebind.example.com": ["93.184.215.14", "10.0.0.7"], "v6.example.com": ["::1"] });
  const res = await g.fetch("https://api.example.com/hook", { method: "POST", redirect: "follow" });
  assert.equal(res.status, 200);
  assert.equal(g.calls[0].init?.redirect, "manual", "redirect forced to manual");
  for (const url of ["http://api.example.com/x", "https://127.0.0.1/x", "https://0x7f.0.0.1/", "https://[::1]/", "https://localhost/",
    "https://user:pw@api.example.com/", "https://rebind.example.com/", "https://v6.example.com/", "https://db.internal/"]) {
    await assert.rejects(g.fetch(url), BlockedDestinationError, url);
  }
  await assert.rejects(g.fetch("https://missing.example.com/"), /NXDOMAIN/, "DNS failure is a connection failure");
  assert.equal(g.calls.length, 1, "blocked requests never reach the network");
});

const now = Date.parse("2026-10-10T06:00:00Z");
const event: StoreEvent = {
  id: "e1", store: "app_store", environment: "Production", type: "purchase", occurredAt: "2026-10-10T05:59:00Z", rawType: "ONE_TIME_CHARGE",
  rawSubtype: null, productId: "p", transactionId: "T", originalTransactionId: "T", revenue: 1, currency: "USD", storefront: "USA",
  appUserId: null, isTrial: false, isFamilyShared: false,
};
const ch = (id: string, kind: Channel["kind"], config: Record<string, string>): Channel =>
  ({ id, kind, config, events: null, environments: ["Production"], enabled: true });

test("delivery errors are generic codes: no URLs, no tokens", async () => {
  const fetcher = (async (url: string) => {
    if (url.includes("telegram")) throw new Error(`connect ECONNREFUSED ${url}`);
    if (url.includes("slow")) throw new DOMException("The signal has been aborted", "TimeoutError");
    if (url.includes("fivehundred")) return new Response("", { status: 500 });
    if (url.includes("internal")) throw new BlockedDestinationError();
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const out = await dispatch([
    ch("tg", "telegram", { bot_token: "123456:SECRET-TOKEN", chat_id: "1" }),
    ch("slow", "webhook", { url: "https://slow.example.com/h", secret: "s" }),
    ch("five", "webhook", { url: "https://fivehundred.example.com/h", secret: "s" }),
    ch("blocked", "webhook", { url: "https://db.internal/h", secret: "s" }),
    ch("gone", "webhook", { url: "https://gone.example.com/h", secret: "s" }),
    ch("slack", "slack", { webhook_url: "https://evil.example.com/hook" }),
  ], { name: "X" }, event, fetcher, now, async () => {}, 0);
  assert.deepEqual(out.map((d) => [d.channelId, d.error, d.attempts]), [
    ["tg", "connection_failed", 1], ["slow", "timeout", 1], ["five", "http_500", 1],
    ["blocked", "blocked_destination", 1], ["gone", "http_404", 1], ["slack", "blocked_destination", 1],
  ]);
  assert.ok(!JSON.stringify(out).includes("SECRET"), "bot token never stored");
});

test("blocked destinations are not retried; retries=0 means one attempt", async () => {
  let calls = 0;
  const blocked = (async () => { calls++; throw new BlockedDestinationError(); }) as unknown as typeof fetch;
  const [d] = await dispatch([ch("w", "webhook", { url: "https://x.example.com", secret: "s" })], { name: "X" }, event, blocked, now, async () => {});
  assert.deepEqual([d.error, d.attempts, calls], ["blocked_destination", 1, 1]);
  calls = 0;
  const refused = (async () => { calls++; throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  await dispatch([ch("w", "webhook", { url: "https://x.example.com", secret: "s" })], { name: "X" }, event, refused, now, async () => {}, 0);
  assert.equal(calls, 1);
});

test("forward errors are generic too", async () => {
  const blocked = (async () => { throw new BlockedDestinationError(); }) as unknown as typeof fetch;
  assert.equal((await forwardRaw("https://db.internal/x", "{}", "application/json", blocked)).error, "blocked_destination");
  const refused = (async () => { throw new Error("connect ECONNREFUSED https://secret.example.com/?token=abc"); }) as unknown as typeof fetch;
  assert.equal((await forwardRaw("https://secret.example.com/?token=abc", "{}", "application/json", refused)).error, "connection_failed");
});
