import type { ChannelKind, Json } from "@/lib/database.types";
import { outboundUrlError } from "@/lib/outbound-url";

export type ChannelField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  mono?: boolean;
  defaultValue?: string;
  /** Returns an error message, or null when valid. */
  validate?: (v: string) => string | null;
};

export type ChannelSpec = {
  kind: ChannelKind;
  label: string;
  emoji: string;
  blurb: string;
  help: string;
  fields: ChannelField[];
  /** Still shown for existing channels, but not offered for new ones. */
  hidden?: boolean;
  /** What we show in the list, without exposing the secret. */
  summary: (config: Record<string, string>) => string;
};

const https = (prefixes: string[], example: string) => (v: string) => {
  if (prefixes.length && !prefixes.some((p) => v.startsWith(p))) return `Should look like ${example}`;
  return outboundUrlError(v);
};

function host(v: string | undefined) {
  try {
    return v ? new URL(v).host : "";
  } catch {
    return "";
  }
}

export const CHANNELS: ChannelSpec[] = [
  {
    kind: "slack",
    label: "Slack",
    emoji: "💬",
    blurb: "Post purchases and renewals to a Slack channel.",
    help: "In Slack, create an app at api.slack.com/apps, turn on Incoming Webhooks, add a webhook to the channel you want and paste its URL.",
    fields: [
      {
        key: "webhook_url",
        label: "Incoming webhook URL",
        placeholder: "https://hooks.slack.com/services/…",
        secret: true,
        mono: true,
        validate: https(["https://hooks.slack.com/"], "https://hooks.slack.com/services/…"),
      },
    ],
    summary: () => "Incoming webhook",
  },
  {
    kind: "discord",
    label: "Discord",
    emoji: "🎮",
    blurb: "Post purchases and renewals to a Discord channel.",
    help: "In Discord, open Server Settings → Integrations → Webhooks, create a webhook for your channel and copy its URL.",
    fields: [
      {
        key: "webhook_url",
        label: "Webhook URL",
        placeholder: "https://discord.com/api/webhooks/…",
        secret: true,
        mono: true,
        validate: https(["https://discord.com/api/webhooks/"], "https://discord.com/api/webhooks/…"),
      },
    ],
    summary: () => "Channel webhook",
  },
  {
    kind: "telegram",
    label: "Telegram",
    emoji: "✈️",
    blurb: "Message yourself or a group from your own bot.",
    help: "Create a bot with @BotFather to get its token, start a chat with it (or add it to a group), then use that chat's ID.",
    fields: [
      { key: "bot_token", label: "Bot token", placeholder: "123456789:AA…", secret: true, mono: true, validate: (v) => (/^\d+:[\w-]{20,}$/.test(v) ? null : "Should look like 123456789:AA…") },
      { key: "chat_id", label: "Chat ID", placeholder: "-1001234567890 or @channelname", mono: true },
    ],
    summary: (c) => `Chat ${c.chat_id ?? ""}`,
  },
  {
    kind: "pushover",
    label: "Pushover",
    emoji: "🔔",
    blurb: "Push alerts to any device with Pushover.",
    help: "Your user key is on your Pushover dashboard. Create an application there to get an API token.",
    fields: [
      { key: "token", label: "Application API token", placeholder: "30-character token", secret: true, mono: true },
      { key: "user", label: "User or group key", placeholder: "30-character key", secret: true, mono: true },
    ],
    summary: () => "Pushover app",
  },
  {
    kind: "ntfy",
    label: "ntfy",
    // ntfy.sh rate-limits the Supabase egress IPs, so it's no longer offered (docs/PRODUCT.md section 2).
    hidden: true,
    emoji: "📣",
    blurb: "Free push notifications through ntfy.",
    help: "Pick a hard-to-guess topic and subscribe to it in the ntfy app. On the public ntfy.sh server, anyone who knows the topic can read it.",
    fields: [
      { key: "topic", label: "Topic", placeholder: "salebell-7f3k2q9x", mono: true, validate: (v) => (/^[\w-]{1,64}$/.test(v) ? null : "Letters, numbers, - and _ only") },
      { key: "server", label: "Server (optional)", placeholder: "https://ntfy.sh", optional: true, mono: true, validate: https([], "https://ntfy.example.com") },
    ],
    summary: (c) => `${host(c.server) || "ntfy.sh"}/${c.topic ?? ""}`,
  },
  {
    kind: "posthog",
    label: "PostHog",
    emoji: "🦔",
    blurb: "Send each event to PostHog as store_transaction.",
    help: "Use your project API key from PostHog project settings, and your instance host (US, EU or self-hosted).",
    fields: [
      { key: "api_key", label: "Project API key", placeholder: "phc_…", secret: true, mono: true },
      { key: "host", label: "Host", placeholder: "https://eu.i.posthog.com", defaultValue: "https://eu.i.posthog.com", mono: true, validate: https([], "https://us.i.posthog.com") },
    ],
    summary: (c) => host(c.host) || "PostHog",
  },
  {
    kind: "webhook",
    label: "Webhook",
    emoji: "🪝",
    blurb: "POST signed JSON to your own endpoint.",
    help: "Each request carries x-salebell-timestamp and x-salebell-signature (HMAC-SHA256 of timestamp.body with your secret).",
    fields: [
      { key: "url", label: "Endpoint URL", placeholder: "https://api.example.com/salebell", mono: true, validate: https([], "https://api.example.com/salebell") },
      { key: "secret", label: "Signing secret", placeholder: "At least 16 characters", secret: true, mono: true, validate: (v) => (v.length >= 16 ? null : "Use at least 16 characters") },
    ],
    summary: (c) => host(c.url),
  },
];

export function channelSpec(kind: string) {
  return CHANNELS.find((c) => c.kind === kind);
}

export function configOf(config: Json): Record<string, string> {
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, string>) : {};
}

export function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
