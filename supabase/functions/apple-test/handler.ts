// POST {app_id, environment: "sandbox"|"production", credential_id} or a one-time key_id/issuer_id/private_key:
// asks Apple's App Store Server API to send a TEST notification to the app's Server URL.
// Saved In-App Purchase keys are loaded from Vault; one-time uploads are never stored. Keys are never logged.
// Any member of the app's account may call it; 5 calls per minute per user.
import { bearer, browserFunction, json, readJson } from "../_shared/core/http.ts";
import type { AuthUser } from "../_shared/supabase.ts";
import type { AppleCredentials } from "../_shared/credentials.ts";

export const RATE_LIMIT = { calls: 5, windowSeconds: 60 };
export const APPLE_API = {
  production: "https://api.storekit.apple.com",
  sandbox: "https://api.storekit-sandbox.apple.com",
} as const;
/** Apple sends the notification asynchronously; wait briefly before asking how the delivery went. */
const STATUS_DELAY_MS = 3_000;

const DELIVERY_RESULTS = [
  "SUCCESS", "CIRCULAR_REDIRECT", "INVALID_RESPONSE", "NO_RESPONSE", "OTHER", "PREMATURE_CLOSE",
  "SOCKET_ISSUE", "TIMED_OUT", "TLS_ISSUE", "UNSUCCESSFUL_HTTP_RESPONSE_CODE", "UNSUPPORTED_CHARSET",
] as const;
export type AppleTestDelivery = typeof DELIVERY_RESULTS[number] | "UNKNOWN";
export type AppleTestAttempt = { attemptDate: number | null; sendAttemptResult: AppleTestDelivery };
export type AppleTestResult =
  | { ok: true; delivery: AppleTestDelivery | null; attempts: AppleTestAttempt[] }
  | { ok: false; error: string; message?: string };

function deliveryResult(value: unknown): AppleTestDelivery | null {
  if (typeof value !== "string" || !value) return null;
  return DELIVERY_RESULTS.includes(value as typeof DELIVERY_RESULTS[number]) ? value as AppleTestDelivery : "UNKNOWN";
}

/** Only return Apple's bounded delivery metadata, never its signed payload or arbitrary status fields. */
function deliveryStatus(value: unknown): Pick<Extract<AppleTestResult, { ok: true }>, "delivery" | "attempts"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { delivery: null, attempts: [] };
  const status = value as Record<string, unknown>;
  const attempts: AppleTestAttempt[] = [];
  for (const item of Array.isArray(status.sendAttempts) ? status.sendAttempts.slice(0, 6) : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const attempt = item as Record<string, unknown>;
    const result = deliveryResult(attempt.sendAttemptResult);
    if (!result) continue;
    const date = attempt.attemptDate;
    attempts.push({
      attemptDate: typeof date === "number" && Number.isSafeInteger(date) && date >= 0 && date <= 8_640_000_000_000_000 ? date : null,
      sendAttemptResult: result,
    });
  }
  // Apple supplies one initial attempt and up to five retries. Prefer the most recent
  // recorded result; if a date is unavailable, retain the response's attempt order.
  const latest = attempts.every((attempt) => attempt.attemptDate !== null)
    ? attempts.reduce<AppleTestAttempt | undefined>((current, attempt) => !current || attempt.attemptDate! >= current.attemptDate! ? attempt : current, undefined)
    : attempts.at(-1);
  return { delivery: latest?.sendAttemptResult ?? deliveryResult(status.firstSendAttemptResult), attempts };
}

export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  /** The app's bundle id, or null unless the user is a member of the app's account. */
  bundleId: (appId: string, userId: string) => Promise<string | null>;
  /** Saved In-App Purchase keys are available only to workspace owners/admins. */
  savedCredentials?: (credentialId: string, appId: string, userId: string) => Promise<AppleCredentials | null>;
  /** Seconds until the caller may retry; 0 when allowed. */
  rateLimit: (userId: string) => Promise<number>;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  log?: Pick<Console, "error">;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Accepts the .p8 file content, with or without PEM armour. */
async function importP8(p8: string): Promise<CryptoKey> {
  const base64 = p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function appStoreServerJwt(
  key: { p8: string; keyId: string; issuerId: string; bundleId: string },
  nowMs = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const input = `${b64urlJson({ alg: "ES256", kid: key.keyId, typ: "JWT" })}.${
    b64urlJson({ iss: key.issuerId, iat, exp: iat + 300, aud: "appstoreconnect-v1", bid: key.bundleId })
  }`;
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await importP8(key.p8), new TextEncoder().encode(input)),
  );
  return `${input}.${b64url(sig)}`;
}

export function createAppleTest(deps: Deps) {
  const fetcher = deps.fetcher ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return browserFunction(async (req) => {
    const user = await deps.getUser(bearer(req));
    if (!user) return json(401, { error: "unauthorized" });
    const requestBody = await readJson(req);
    const { app_id, environment, credential_id } = requestBody;
    let { key_id, issuer_id, private_key } = requestBody;
    if (typeof app_id !== "string" || !UUID.test(app_id)) return json(400, { error: "app_id required" });
    if (environment !== "sandbox" && environment !== "production") return json(400, { error: "environment must be sandbox or production" });
    if (credential_id !== undefined && (typeof credential_id !== "string" || !UUID.test(credential_id))) {
      return json(400, { error: "invalid_credential_id" });
    }

    const retryAfter = await deps.rateLimit(user.id).catch((e) => {
      deps.log?.error("rate limit check failed", { error: String(e) });
      return 0;
    });
    if (retryAfter > 0) return json(429, { error: "rate_limited", retry_after: retryAfter }, { "retry-after": String(retryAfter) });

    const bundleId = await deps.bundleId(app_id, user.id);
    if (!bundleId) return json(404, { error: "app not found" });
    if (typeof credential_id === "string") {
      let saved: AppleCredentials | null | undefined;
      try { saved = await deps.savedCredentials?.(credential_id, app_id, user.id); }
      catch { return json(503, { error: "credential_storage_unavailable" }); }
      if (!saved) return json(404, { error: "credential_not_found" });
      ({ key_id, issuer_id, private_key } = saved);
    }
    if (typeof key_id !== "string" || !KEY_ID.test(key_id.trim())) return json(400, { error: "invalid_key_id" });
    if (typeof issuer_id !== "string" || !UUID.test(issuer_id.trim())) return json(400, { error: "invalid_issuer_id" });
    if (typeof private_key !== "string" || private_key.length > 4_000) return json(400, { error: "invalid_private_key" });

    let jwt: string;
    try {
      jwt = await appStoreServerJwt({ p8: private_key, keyId: key_id.trim(), issuerId: issuer_id.trim(), bundleId }, deps.clock?.());
    } catch {
      return json(400, { error: "invalid_private_key" });
    }
    const headers = { authorization: `Bearer ${jwt}` };
    const base = APPLE_API[environment];

    const res = await fetcher(`${base}/inApps/v1/notifications/test`, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (res.status === 401) return json(200, { ok: false, error: "apple_rejected_key" });
    if (res.status === 429) return json(200, { ok: false, error: "apple_rate_limited" });
    const body = await res.json().catch(() => ({})) as { testNotificationToken?: string; errorMessage?: string };
    if (!res.ok || !body.testNotificationToken) {
      return json(200, { ok: false, error: "apple_error", message: body.errorMessage ?? `HTTP ${res.status}` });
    }

    // Best effort: accepting the test request does not confirm webhook delivery.
    await sleep(STATUS_DELAY_MS);
    const status: unknown = await fetcher(`${base}/inApps/v1/notifications/test/${encodeURIComponent(body.testNotificationToken)}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(10_000),
    }).then((r) => r.ok ? r.json() : null).catch(() => null);
    return json(200, { ok: true, ...deliveryStatus(status) } satisfies AppleTestResult);
  }, deps.log);
}
