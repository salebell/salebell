import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { type Channel, dispatch, formatAlert, formatDiscord, formatSlack, shouldDeliver } from "../supabase/functions/_shared/core/alerts.ts";
import type { StoreEvent } from "../supabase/functions/_shared/core/events.ts";

const now = Date.parse("2026-10-08T06:00:00Z");
const event = (o: Partial<StoreEvent> = {}): StoreEvent => ({
  id: "e1", store: "app_store", environment: "Production", type: "purchase", occurredAt: "2026-10-08T05:54:46Z",
  rawType: "ONE_TIME_CHARGE", rawSubtype: null, productId: "com.example.cafetimer.premium.lifetime", transactionId: "T1",
  originalTransactionId: "T1", revenue: 499.99, currency: "TRY", storefront: "TUR", appUserId: null, isTrial: false,
  isFamilyShared: false, ...o,
});
const ch = (kind: Channel["kind"], config: Record<string, string>, o: Partial<Channel> = {}): Channel =>
  ({ id: kind, kind, config, events: null, environments: ["Production"], enabled: true, ...o });

function recorder() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

test("formats a readable alert", () => {
  const a = formatAlert({ name: "Café Timer" }, event());
  assert.equal(a.title.replace(/\s/gu, " "), "💰 Café Timer · TRY 499.99");
  assert.equal(a.body, "Purchase · premium.lifetime · TUR");
  assert.equal(formatAlert({ name: "X" }, event({ type: "refund", revenue: -1, currency: "USD" })).priority, "high");
  assert.match(formatAlert({ name: "X" }, event({ environment: "Sandbox" })).title, /\[Sandbox\]$/);
});

test("filters by environment, event type, enabled and age", () => {
  const push = ch("pushover", {});
  assert.equal(shouldDeliver(push, event(), now), true);
  assert.equal(shouldDeliver(push, event({ environment: "Sandbox" }), now), false);
  assert.equal(shouldDeliver(push, event({ type: "expired" }), now), false, "phone default skips expired");
  assert.equal(shouldDeliver(ch("posthog", {}), event({ type: "expired" }), now), true, "integrations get all");
  assert.equal(shouldDeliver({ ...push, enabled: false }, event(), now), false);
  assert.equal(shouldDeliver({ ...push, events: ["refund"] }, event(), now), false);
  assert.equal(shouldDeliver(push, event({ occurredAt: "2026-10-01T00:00:00Z" }), now), false, "backfill not alerted");
  assert.equal(shouldDeliver(push, event({ type: "test", occurredAt: "2026-10-01T00:00:00Z" }), now), true);
  assert.equal(shouldDeliver(ch("posthog", {}), event({ occurredAt: "2026-10-01T00:00:00Z" }), now), true, "analytics receives backfill");
  assert.equal(shouldDeliver(ch("webhook", {}), event({ occurredAt: "2026-10-01T00:00:00Z" }), now), true, "webhooks receive backfill");
});

test("dispatch sends correct requests to each provider", async () => {
  const { calls, fetcher } = recorder();
  const channels = [
    ch("pushover", { token: "t", user: "u" }),
    ch("ntfy", { topic: "my topic", server: "https://ntfy.example.com/", token: "nt" }),
    ch("telegram", { bot_token: "B", chat_id: "42" }),
    ch("webhook", { url: "https://hooks.example.com/x", secret: "s3cret" }),
    ch("posthog", { api_key: "phc" }),
  ];
  const out = await dispatch(channels, { name: "Café Timer" }, event(), fetcher, now);
  assert.equal(out.length, 5);
  assert.ok(out.every((d) => d.ok));
  const by = Object.fromEntries(calls.map((c) => [new URL(c.url).host, c]));

  const po = new URLSearchParams(by["api.pushover.net"].init.body as URLSearchParams);
  assert.deepEqual([po.get("token"), po.get("user"), po.get("priority")], ["t", "u", "0"]);

  const nt = by["ntfy.example.com"];
  assert.equal(nt.url, "https://ntfy.example.com/my%20topic");
  const ntHeaders = nt.init.headers as Record<string, string>;
  assert.equal(ntHeaders.Authorization, "Bearer nt");
  assert.match(ntHeaders.Title, /^=\?UTF-8\?B\?.+\?=$/);
  assert.ok(Buffer.from(ntHeaders.Title.slice(10, -2), "base64").toString().includes("Café"));

  assert.equal(by["api.telegram.org"].url, "https://api.telegram.org/botB/sendMessage");

  const wh = by["hooks.example.com"];
  const h = wh.init.headers as Record<string, string>;
  const expected = createHmac("sha256", "s3cret").update(`${h["x-salebell-timestamp"]}.${wh.init.body}`).digest("hex");
  assert.equal(h["x-salebell-signature"], expected, "webhook HMAC verifiable by receivers");

  const ph = JSON.parse(by["eu.i.posthog.com"].init.body as string);
  assert.deepEqual([ph.event, ph.uuid, ph.distinct_id, ph.properties.revenue, ph.properties.event_type],
    ["store_transaction", "e1", "T1", 499.99, "purchase"]);
});

const noSleep = async () => {};

test("dispatch reports failures without throwing; config errors are not retried", async () => {
  let calls = 0;
  const failing = (async () => { calls++; throw new Error("boom"); }) as unknown as typeof fetch;
  const out = await dispatch([ch("pushover", { token: "t", user: "u" }), ch("telegram", {})], { name: "X" }, event(), failing, now, noSleep);
  assert.deepEqual(out.map((d) => [d.ok, d.error, d.attempts]), [[false, "connection_failed", 4], [false, "invalid_config", 1]]);
  assert.equal(calls, 4, "network errors retried 3 times; config error never sent");
});

test("retries 429/5xx with backoff and honours Retry-After", async () => {
  const statuses = [429, 503, 200];
  const waits: number[] = [];
  const fetcher = (async () => {
    const status = statuses.shift()!;
    return new Response("", { status, headers: status === 429 ? { "retry-after": "2" } : {} });
  }) as unknown as typeof fetch;
  const [d] = await dispatch([ch("ntfy", { topic: "t" })], { name: "X" }, event(), fetcher, now, async (ms) => { waits.push(ms); });
  assert.deepEqual([d.ok, d.status, d.attempts], [true, 200, 3]);
  assert.deepEqual(waits, [2000, 4000], "Retry-After first, then the default backoff step");
});

test("does not retry permanent 4xx errors", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response("", { status: 401 }); }) as unknown as typeof fetch;
  const [d] = await dispatch([ch("ntfy", { topic: "t", token: "bad" })], { name: "X" }, event(), fetcher, now, noSleep);
  assert.deepEqual([d.ok, d.status, d.attempts, calls], [false, 401, 1, 1]);
});

test("formats Slack and Discord payloads", () => {
  const slack = formatSlack({ name: "Café <Timer> & Co" }, event());
  assert.match(slack.text, /^\*💰 Café &lt;Timer&gt; &amp; Co · TRY\s499\.99\*\nPurchase · premium\.lifetime · TUR$/u);
  assert.equal(slack.unfurl_links, false);

  const discord = formatDiscord({ name: "Café Timer" }, event({ type: "refund", revenue: -1, currency: "USD" }));
  assert.deepEqual(discord.allowed_mentions, { parse: [] }, "store data can never @mention");
  assert.equal(discord.username, "Salebell");
  assert.equal(discord.embeds[0].color, 0xe5484d, "refunds are red");
  assert.equal(discord.embeds[0].timestamp, "2026-10-08T05:54:46Z");
  assert.match(discord.embeds[0].title, /^💸 Café Timer/u);
});

test("dispatch posts to Slack and Discord webhooks; other hosts are config errors", async () => {
  const { calls, fetcher } = recorder();
  const out = await dispatch([
    ch("slack", { webhook_url: "https://hooks.slack.com/services/T/B/x" }),
    ch("discord", { webhook_url: "https://discord.com/api/webhooks/1/abc" }),
    { ...ch("slack", { webhook_url: "https://evil.example.com/hook" }), id: "bad-slack" },
    { ...ch("discord", { webhook_url: "https://discord.com.evil.example/api/webhooks/1" }), id: "bad-discord" },
  ], { name: "Café Timer" }, event(), fetcher, now, noSleep);
  assert.deepEqual(out.map((d) => [d.channelId, d.ok, d.attempts]),
    [["slack", true, 1], ["discord", true, 1], ["bad-slack", false, 1], ["bad-discord", false, 1]]);
  assert.equal(calls.length, 2, "invalid webhook URLs are never called");
  assert.equal(JSON.parse(calls[0].init.body as string).text.startsWith("*💰 Café Timer"), true);
  assert.equal(JSON.parse(calls[1].init.body as string).embeds.length, 1);
  assert.equal(shouldDeliver(ch("slack", {}), event({ type: "expired" }), now), false, "chat channels use phone defaults");
  assert.equal(shouldDeliver(ch("discord", {}), event({ occurredAt: "2026-10-01T00:00:00Z" }), now), false, "chat channels skip backfill");
});

test("labels Apple's TEST notification and Salebell's own test alert differently", () => {
  assert.equal(formatAlert({ name: "X" }, event({ type: "test", rawType: "TEST", productId: null, storefront: null })).body, "App Store test notification");
  assert.equal(formatAlert({ name: "X" }, event({ type: "test", rawType: "SALEBELL_TEST", productId: null, storefront: null })).body, "Salebell test alert");
});
