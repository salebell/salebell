// Alert and integration fan-out for StoreEvents. Runtime-agnostic: uses only
// fetch, WebCrypto and AbortSignal.timeout.
import type { StoreEvent, StoreEventType } from "./events.ts";
import { BlockedDestinationError, deliveryErrorCode } from "./net.ts";

export type ChannelKind = "pushover" | "ntfy" | "telegram" | "webhook" | "posthog" | "slack" | "discord";

export type Channel = {
  id: string;
  kind: ChannelKind;
  name?: string | null;
  config: Record<string, string | undefined>;
  // null -> the kind's defaults (see DEFAULT_EVENTS)
  events: StoreEventType[] | null;
  environments: string[]; // e.g. ["Production"]
  enabled: boolean;
};

export type AppInfo = { name: string };

export type Delivery = { channelId: string; ok: boolean; status?: number; error?: string; attempts?: number };

/**
 * Waits before retry n (0-based). 429/5xx/network errors retry; other 4xx, config errors and
 * blocked destinations do not. Errors are generic codes (never URLs or tokens):
 * http_<status>, timeout, connection_failed, blocked_destination, invalid_config.
 */
export const RETRY_DELAYS_MS = [1_000, 4_000, 10_000];
const MAX_RETRY_AFTER_MS = 30_000;
class ConfigError extends Error {}
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Phone and chat alerts default to money and churn signals; integrations get everything. */
export const PHONE_DEFAULT: StoreEventType[] = [
  "purchase", "trial_started", "intro_offer_started", "renewal", "resubscribe", "billing_recovered",
  "billing_issue", "cancellation", "refund", "refund_reversed", "revoked", "test",
];
export const DEFAULT_EVENTS: Record<ChannelKind, StoreEventType[] | "all"> = {
  pushover: PHONE_DEFAULT,
  ntfy: PHONE_DEFAULT,
  telegram: PHONE_DEFAULT,
  slack: PHONE_DEFAULT,
  discord: PHONE_DEFAULT,
  webhook: "all",
  posthog: "all",
};

/** Events older than this are history replays/backfills: phones stay quiet; integrations still receive them. */
export const ALERT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PHONE_KINDS: ReadonlySet<ChannelKind> = new Set(["pushover", "ntfy", "telegram", "slack", "discord"]);

export function shouldDeliver(ch: Channel, e: StoreEvent, now = Date.now()): boolean {
  if (!ch.enabled || !ch.environments.includes(e.environment)) return false;
  const stale = now - Date.parse(e.occurredAt) > ALERT_MAX_AGE_MS;
  if (stale && e.type !== "test" && PHONE_KINDS.has(ch.kind)) return false;
  const allowed = ch.events ?? DEFAULT_EVENTS[ch.kind];
  return allowed === "all" || allowed.includes(e.type);
}

// ---------- formatting ----------

const LABEL: Record<StoreEventType, [emoji: string, text: string]> = {
  purchase: ["💰", "Purchase"],
  trial_started: ["🧪", "Trial started"],
  intro_offer_started: ["🏷️", "Intro offer started"],
  renewal: ["🔁", "Renewal"],
  resubscribe: ["↩️", "Resubscribed"],
  billing_recovered: ["✅", "Billing recovered"],
  billing_issue: ["⚠️", "Billing issue"],
  cancellation: ["🚪", "Auto-renew turned off"],
  uncancellation: ["🔓", "Auto-renew turned on"],
  expired: ["⌛", "Expired"],
  refund: ["💸", "Refund"],
  refund_declined: ["🛡️", "Refund declined"],
  refund_reversed: ["↪️", "Refund reversed"],
  revoked: ["⛔", "Access revoked"],
  product_change: ["🔀", "Plan change"],
  price_increase: ["📈", "Price increase response"],
  offer_redeemed: ["🎟️", "Offer redeemed"],
  renewal_extended: ["⏩", "Renewal extended"],
  consumption_request: ["📨", "Consumption request (respond within 12h)"],
  test: ["🔔", "App Store test notification"],
  other: ["ℹ️", "Store event"],
};

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatAlert(app: AppInfo, e: StoreEvent): { title: string; body: string; priority: "high" | "default" | "low" } {
  const [emoji, storeLabel] = LABEL[e.type];
  // Provider delivery tests are distinct from our synthetic test-alert function.
  const label = e.type !== "test" ? storeLabel : e.rawType !== "TEST" ? "Salebell test alert"
    : e.store === "play_store" ? "Google Play test notification" : storeLabel;
  const sandbox = e.environment === "Sandbox" ? " [Sandbox]" : "";
  const amount = e.revenue != null && e.currency ? ` · ${formatMoney(e.revenue, e.currency)}` : "";
  const product = e.productId ? e.productId.split(".").slice(-2).join(".") : null;
  const details = [label + (e.isTrial && e.type !== "trial_started" ? " (trial)" : ""), product, e.storefront]
    .filter(Boolean).join(" · ");
  const priority = e.type === "refund" || e.type === "billing_issue" || e.type === "consumption_request"
    ? "high"
    : e.type === "test" || e.type === "expired" ? "low" : "default";
  return { title: `${emoji} ${app.name}${amount}${sandbox}`, body: details, priority };
}

const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Slack incoming-webhook payload (mrkdwn). */
export function formatSlack(app: AppInfo, e: StoreEvent): { text: string; unfurl_links: false } {
  const { title, body } = formatAlert(app, e);
  return { text: body ? `*${slackEscape(title)}*\n${slackEscape(body)}` : `*${slackEscape(title)}*`, unfurl_links: false };
}

const DISCORD_COLOR = { high: 0xe5484d, default: 0x30a46c, low: 0x8b8d98 } as const;

/** Discord webhook payload: one embed, mentions disabled so store data can never ping anyone. */
export function formatDiscord(app: AppInfo, e: StoreEvent) {
  const { title, body, priority } = formatAlert(app, e);
  return {
    username: "Salebell",
    allowed_mentions: { parse: [] as string[] },
    embeds: [{ title: title.slice(0, 256), description: body.slice(0, 4096) || undefined, color: DISCORD_COLOR[priority], timestamp: e.occurredAt }],
  };
}

// ---------- delivery ----------

const TIMEOUT_MS = 5000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function need(c: Channel, ...keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = c.config[k];
    if (!v) throw new ConfigError(`missing config.${k}`);
    out[k] = v;
  }
  return out;
}

async function send(c: Channel, app: AppInfo, e: StoreEvent, fetcher: typeof fetch): Promise<Response> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const { title, body, priority } = formatAlert(app, e);
  switch (c.kind) {
    case "pushover": {
      const { token, user } = need(c, "token", "user");
      const form = new URLSearchParams({ token, user, title, message: body || title, priority: priority === "high" ? "1" : priority === "low" ? "-1" : "0" });
      return await fetcher("https://api.pushover.net/1/messages.json", { method: "POST", body: form, signal });
    }
    case "ntfy": {
      const { topic } = need(c, "topic");
      const server = (c.config.server ?? "https://ntfy.sh").replace(/\/$/, "");
      const headers: Record<string, string> = {
        // HTTP headers must be ISO-8859-1; ntfy accepts RFC 2047 encoded titles.
        Title: `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(title)))}?=`,
        Priority: priority === "high" ? "high" : priority === "low" ? "low" : "default",
      };
      if (c.config.token) headers.Authorization = `Bearer ${c.config.token}`;
      return await fetcher(`${server}/${encodeURIComponent(topic)}`, { method: "POST", headers, body: body || title, signal });
    }
    case "telegram": {
      const { bot_token, chat_id } = need(c, "bot_token", "chat_id");
      return await fetcher(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, text: `${title}\n${body}`, disable_notification: priority === "low" }),
        signal,
      });
    }
    case "slack": {
      const { webhook_url } = need(c, "webhook_url");
      if (!/^https:\/\/hooks\.slack\.com\//.test(webhook_url)) throw new BlockedDestinationError();
      return await fetcher(webhook_url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatSlack(app, e)), signal,
      });
    }
    case "discord": {
      const { webhook_url } = need(c, "webhook_url");
      if (!/^https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\//.test(webhook_url)) throw new BlockedDestinationError();
      return await fetcher(webhook_url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(formatDiscord(app, e)), signal,
      });
    }
    case "webhook": {
      const { url, secret } = need(c, "url", "secret");
      const payload = JSON.stringify({ type: "store_event", app: app.name, event: e });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      return await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-salebell-timestamp": timestamp,
          // Receivers verify: hex(HMAC-SHA256(secret, `${timestamp}.${body}`)).
          "x-salebell-signature": await hmacHex(secret, `${timestamp}.${payload}`),
        },
        body: payload,
        signal,
      });
    }
    case "posthog": {
      const { api_key } = need(c, "api_key");
      const host = (c.config.host ?? "https://eu.i.posthog.com").replace(/\/$/, "");
      return await fetcher(`${host}/i/v0/e/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key,
          event: "store_transaction",
          distinct_id: e.appUserId ?? e.originalTransactionId ?? e.id,
          timestamp: e.occurredAt,
          // Stable UUID so retried deliveries are de-duplicated by PostHog.
          uuid: e.id,
          properties: {
            event_type: e.type, store: e.store, environment: e.environment, product_id: e.productId,
            transaction_id: e.transactionId, original_transaction_id: e.originalTransactionId,
            revenue: e.revenue, currency: e.currency, storefront: e.storefront, is_trial: e.isTrial,
            raw_type: e.rawType, raw_subtype: e.rawSubtype, app: app.name,
            ...(e.appUserId ? {} : { $process_person_profile: false }),
          },
        }),
        signal,
      });
    }
  }
}

async function deliverOnce(c: Channel, app: AppInfo, e: StoreEvent, fetcher: typeof fetch):
  Promise<{ delivery: Omit<Delivery, "attempts">; retry: boolean; retryAfterMs?: number }> {
  try {
    const res = await send(c, app, e, fetcher);
    await res.body?.cancel();
    if (res.ok) return { delivery: { channelId: c.id, ok: true, status: res.status }, retry: false };
    const seconds = Number(res.headers.get("retry-after"));
    return {
      delivery: { channelId: c.id, ok: false, status: res.status, error: `http_${res.status}` },
      retry: res.status === 429 || res.status >= 500,
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined,
    };
  } catch (error) {
    if (error instanceof ConfigError) return { delivery: { channelId: c.id, ok: false, error: "invalid_config" }, retry: false };
    const code = deliveryErrorCode(error);
    return { delivery: { channelId: c.id, ok: false, error: code }, retry: code !== "blocked_destination" };
  }
}

/**
 * Sends to every matching channel concurrently, retrying transient failures up to `retries`
 * times (0 = one attempt). Pass a guarded fetch for customer-configured destinations. Never throws.
 */
export async function dispatch(
  channels: Channel[],
  app: AppInfo,
  e: StoreEvent,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  sleep: (ms: number) => Promise<void> = defaultSleep,
  retries = RETRY_DELAYS_MS.length,
): Promise<Delivery[]> {
  const targets = channels.filter((c) => shouldDeliver(c, e, now));
  return await Promise.all(targets.map(async (c): Promise<Delivery> => {
    for (let attempt = 0; ; attempt++) {
      const { delivery, retry, retryAfterMs } = await deliverOnce(c, app, e, fetcher);
      if (!retry || attempt >= Math.min(retries, RETRY_DELAYS_MS.length)) return { ...delivery, attempts: attempt + 1 };
      await sleep(retryAfterMs ?? RETRY_DELAYS_MS[attempt]);
    }
  }));
}
