// Apple Push Notification service client for the Salebell iOS app.
// Token-based auth: an ES256 provider JWT signed with WebCrypto from a .p8 key.
// Runtime-agnostic (fetch + WebCrypto); the runtime's fetch negotiates HTTP/2,
// which APNs requires.
import type { StoreEvent } from "./events.ts";
import { ALERT_MAX_AGE_MS, type AppInfo, formatAlert, PHONE_DEFAULT } from "./alerts.ts";

export type ApnsEnvironment = "production" | "sandbox";
export type PushDevice = { token: string; environment: ApnsEnvironment };
export type PushResult = { sent: number; failed: number; invalidTokens: string[] };
export type ApnsConfig = { keyP8: string; keyId: string; teamId: string; topic: string };

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
/** Apple accepts provider tokens for up to 60 minutes and rejects refreshes more often than every 20. */
export const TOKEN_TTL_MS = 50 * 60 * 1000;
const TIMEOUT_MS = 10_000;

/** Same rule as phone channels: money and churn signals, no pushes for history replays. */
export function shouldPush(e: StoreEvent, now = Date.now()): boolean {
  if (e.type === "test") return true;
  return PHONE_DEFAULT.includes(e.type) && now - Date.parse(e.occurredAt) <= ALERT_MAX_AGE_MS;
}

/** Reads APNs settings from env; null (push disabled) when any is missing. */
export function apnsConfigFromEnv(get: (name: string) => string | undefined): ApnsConfig | null {
  const keyP8 = get("APNS_KEY_P8"), keyId = get("APNS_KEY_ID"), teamId = get("APNS_TEAM_ID"), topic = get("APNS_TOPIC");
  return keyP8 && keyId && teamId && topic ? { keyP8, keyId, teamId, topic } : null;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Accepts the .p8 file content, with or without PEM armour or escaped newlines. */
async function importP8(p8: string): Promise<CryptoKey> {
  const base64 = p8.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function createProviderToken(cfg: Pick<ApnsConfig, "keyP8" | "keyId" | "teamId">, now = Date.now()): Promise<string> {
  const key = await importP8(cfg.keyP8);
  const input = `${b64urlJson({ alg: "ES256", kid: cfg.keyId })}.${b64urlJson({ iss: cfg.teamId, iat: Math.floor(now / 1000) })}`;
  // WebCrypto ECDSA signatures are raw r||s (IEEE P1363), exactly what JWS ES256 expects.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

export function buildPushPayload(app: AppInfo & { id: string }, e: StoreEvent) {
  const { title, body } = formatAlert(app, e);
  return {
    aps: { alert: { title, body }, sound: "chaching.caf", "thread-id": app.id },
    // Custom keys the iOS app reads to deep-link into the feed.
    app_id: app.id,
    event_id: e.id,
    type: e.type,
  };
}

export type ApnsClient = {
  send: (devices: PushDevice[], app: AppInfo & { id: string }, e: StoreEvent) => Promise<PushResult>;
};

export function createApnsClient(
  cfg: ApnsConfig,
  fetcher: typeof fetch = fetch,
  clock: () => number = Date.now,
  log: Pick<Console, "warn"> = console,
): ApnsClient {
  let cached: { token: string; until: number } | null = null;
  const providerToken = async () => {
    const now = clock();
    if (!cached || cached.until <= now) cached = { token: await createProviderToken(cfg, now), until: now + TOKEN_TTL_MS };
    return cached.token;
  };

  return {
    async send(devices, app, e) {
      const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };
      if (!devices.length) return result;
      const jwt = await providerToken();
      const body = JSON.stringify(buildPushPayload(app, e));
      await Promise.all(devices.map(async (d) => {
        try {
          const res = await fetcher(`${APNS_HOSTS[d.environment]}/3/device/${d.token}`, {
            method: "POST",
            headers: {
              authorization: `bearer ${jwt}`,
              "apns-topic": cfg.topic,
              "apns-push-type": "alert",
              "apns-priority": "10",
              "apns-expiration": String(Math.floor(clock() / 1000) + 86_400),
              "content-type": "application/json",
            },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (res.ok) {
            await res.body?.cancel();
            result.sent++;
            return;
          }
          const reason = await res.json().then((j: { reason?: string }) => j.reason ?? "", () => "");
          result.failed++;
          if (res.status === 410 || reason === "BadDeviceToken") result.invalidTokens.push(d.token);
          if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") cached = null;
          log.warn("apns rejected", { status: res.status, reason, token: d.token.slice(0, 8) });
        } catch (error) {
          result.failed++;
          log.warn("apns error", { error: String(error), token: d.token.slice(0, 8) });
        }
      }));
      return result;
    },
  };
}
