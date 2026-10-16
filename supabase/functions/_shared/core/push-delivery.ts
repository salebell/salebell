import { apnsConfigFromEnv, createApnsClient, type PushDevice, type PushResult } from "./apns.ts";
import { formatAlert, type AppInfo } from "./alerts.ts";
import type { StoreEvent } from "./events.ts";

type Database = { rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T> };
const CAPABILITY = /^[0-9a-f]{64}$/;
const DEFAULT_RELAY = "https://salebell.vercel.app/api/push-relay";

async function readAcknowledgement(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing_acknowledgement");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); throw new Error("oversized_acknowledgement"); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** Customer backends hold only delivery capabilities, never relay APNs credentials. */
export function createPushDelivery(
  get: (name: string) => string | undefined,
  db: Database,
  fetcher: typeof fetch = fetch,
): ((devices: PushDevice[], app: AppInfo & { id: string }, event: StoreEvent) => Promise<PushResult>) | undefined {
  const endpoint = new URL(get("SALEBELL_PUSH_RELAY_URL") || DEFAULT_RELAY);
  const debugLoopback = get("SALEBELL_DEBUG") === "true" && endpoint.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !debugLoopback) || endpoint.username || endpoint.password || endpoint.hash) throw new Error("invalid_push_relay_url");
  const config = apnsConfigFromEnv(get);
  const apns = config ? createApnsClient(config, fetcher) : null;
  const managed = get("SALEBELL_PUSH_RELAY_ENABLED") === "true";

  return async (devices, app, event) => {
    const result: PushResult = { sent: 0, failed: 0, invalidTokens: [] };
    const direct: PushDevice[] = [];
    const relay: PushDevice[] = [];
    for (const device of devices) {
      if (device.transport === "relay") {
        if (CAPABILITY.test(device.token)) relay.push(device); else result.failed++;
      } else if (device.transport === undefined || device.transport === "apns") direct.push(device);
      else result.failed++;
    }
    const { title, body } = formatAlert(app, event);
    await Promise.all([
      ...relay.map(async device => {
        try {
          const response = await fetcher(endpoint.href, {
            method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
            body: JSON.stringify({ action: "deliver", capability: device.token, notification_id: event.id, title, body }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) { await response.body?.cancel(); result.failed++; return; }
          // Only a one-route acknowledgement counts as delivery. No fallback on rejection.
          const ack = await readAcknowledgement(response) as { sent?: unknown; failed?: unknown } | null;
          if (ack?.sent === 1 && ack?.failed === 0) result.sent++; else result.failed++;
        } catch { result.failed++; }
      }),
      (async () => {
        if (!direct.length) return;
        if (managed) {
          // Old app versions may leave direct rows before a phone ever enrolls.
          // Managed shared-app delivery must always honor central route revocation.
          result.failed += direct.length;
          return;
        }
        if (!apns) { result.failed += direct.length; return; }
        const eligible = direct;
        if (!eligible.length) return;
        const sent = await apns.send(eligible, app, event);
        result.sent += sent.sent;
        result.failed += sent.failed;
        result.invalidTokens.push(...sent.invalidTokens);
        if (sent.invalidTokens.length) await db.rpc("disable_push_devices", { p_tokens: sent.invalidTokens });
      })(),
    ]);
    return result;
  };
}
