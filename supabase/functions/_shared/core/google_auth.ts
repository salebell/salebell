// Verify Pub/Sub's OIDC bearer token offline against Google's fixed public keys.
// https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TIMEOUT_MS = 10_000;
const MAX_CACHE_MS = 6 * 3600_000;
const MAX_KEYS = 32;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };

/** Invalid caller token; key-service outages deliberately use ordinary Errors. */
export class GooglePushVerificationError extends Error {
  constructor() {
    super("invalid_google_push_token");
    this.name = "GooglePushVerificationError";
  }
}

function decode(part: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(part) || part.length % 4 === 1) throw new GooglePushVerificationError();
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (c) => c.charCodeAt(0));
}

function jsonPart(part: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(part)));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GooglePushVerificationError();
  return value;
}

function cacheLifetime(headers: Headers): number {
  const control = headers.get("cache-control") ?? "";
  if (/(?:^|,)\s*(?:no-cache|no-store)\b/i.test(control)) return 0;
  const maxAge = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?(?:\s*,|\s*$)/i);
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : 5 * 60_000;
  const age = Number(headers.get("age") ?? 0);
  return Math.max(0, Math.min(MAX_CACHE_MS, ttl) - (Number.isFinite(age) && age > 0 ? age * 1000 : 0));
}

export function createGooglePushVerifier(options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  let cached: { keys: Map<string, CryptoKey>; until: number } | null = null;
  let pending: Promise<Map<string, CryptoKey>> | null = null;

  const loadKeys = async (): Promise<Map<string, CryptoKey>> => {
    try {
      const response = await fetcher(GOOGLE_JWKS_URL, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const body = await response.json();
      if (!body || !Array.isArray(body.keys) || !body.keys.length || body.keys.length > MAX_KEYS) throw new Error();
      const keys = new Map<string, CryptoKey>();
      for (const key of body.keys) {
        if (!key || key.kty !== "RSA" || (key.alg !== undefined && key.alg !== "RS256") ||
          (key.use !== undefined && key.use !== "sig")) continue;
        if (typeof key.kid !== "string" || !key.kid || key.kid.length > 256 || keys.has(key.kid) ||
          typeof key.n !== "string" || typeof key.e !== "string" || decode(key.n).length < 256) throw new Error();
        keys.set(key.kid, await crypto.subtle.importKey("jwk", key, RSA, false, ["verify"]));
      }
      if (!keys.size) throw new Error();
      cached = { keys, until: now() + cacheLifetime(response.headers) };
      return keys;
    } catch {
      throw new Error("google_push_verification_unavailable");
    }
  };

  const publicKeys = async () => {
    if (cached && now() < cached.until) return cached.keys;
    if (!pending) pending = loadKeys();
    try { return await pending; } finally { pending = null; }
  };

  return async (token: string, expected: { audience: string; serviceAccountEmail: string }): Promise<void> => {
    let header: Record<string, unknown>, claims: Record<string, unknown>, parts: string[], signature: Uint8Array<ArrayBuffer>;
    try {
      if (typeof token !== "string" || token.length > 16_384) throw new Error();
      parts = token.split(".");
      if (parts.length !== 3) throw new Error();
      header = jsonPart(parts[0]);
      claims = jsonPart(parts[1]);
      signature = decode(parts[2]);
      const seconds = now() / 1000;
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 256 ||
        header.crit !== undefined || (header.b64 !== undefined && header.b64 !== true) ||
        (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") ||
        typeof claims.aud !== "string" || claims.aud !== expected.audience ||
        claims.email !== expected.serviceAccountEmail || claims.email_verified !== true ||
        !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
        (claims.exp as number) <= seconds || (claims.iat as number) < 0 || (claims.iat as number) > seconds + 60 ||
        (claims.exp as number) <= (claims.iat as number)) throw new Error();
    } catch {
      throw new GooglePushVerificationError();
    }
    const key = (await publicKeys()).get(header.kid as string);
    if (!key) throw new GooglePushVerificationError();
    try {
      if (!await crypto.subtle.verify(RSA, key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) {
        throw new Error();
      }
    } catch {
      throw new GooglePushVerificationError();
    }
  };
}
