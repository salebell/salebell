// Service-account OAuth and authoritative Google Play purchase lookups.
// https://developers.google.com/identity/protocols/oauth2/service-account
export type GoogleServiceAccount = { client_email: string; private_key: string; private_key_id?: string };

/** Google permanently discards some expired purchase tokens (HTTP 410). */
export class GooglePlayPurchaseUnavailableError extends Error {
  constructor() { super("google_play_purchase_unavailable"); }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLAY_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const TIMEOUT_MS = 10_000;
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const enc = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (value: unknown) => enc(new TextEncoder().encode(JSON.stringify(value)));

export function createGooglePlayClient(credentials: GoogleServiceAccount, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
  const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now;
  let cached: { token: string; until: number } | null = null;
  let pending: Promise<string> | null = null;
  let signingKey: Promise<CryptoKey> | null = null;

  const assertion = async () => {
    if (!credentials.client_email || typeof credentials.client_email !== "string") throw new Error();
    if (!signingKey) {
      const base64 = credentials.private_key.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      signingKey = crypto.subtle.importKey("pkcs8", der, RSA, false, ["sign"]);
    }
    const seconds = Math.floor(now() / 1000);
    const header = { alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) };
    const payload = { iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600 };
    const input = `${json(header)}.${json(payload)}`;
    const signature = await crypto.subtle.sign(RSA, await signingKey, new TextEncoder().encode(input));
    return `${input}.${enc(new Uint8Array(signature))}`;
  };

  const exchange = async (): Promise<string> => {
    try {
      const issuedAt = now();
      const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await assertion() });
      const response = await fetcher(TOKEN_URL, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(),
        redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error();
      }
      const result = await response.json();
      if (!result || typeof result.access_token !== "string" || !/^[\x21-\x7e]+$/.test(result.access_token) ||
        typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer" ||
        typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error();
      cached = { token: result.access_token, until: issuedAt + Math.max(0, Math.min(result.expires_in, 3600) - 60) * 1000 };
      return cached.token;
    } catch {
      throw new Error("google_play_auth_unavailable");
    }
  };

  const accessToken = async (): Promise<string> => {
    if (cached && now() < cached.until) return cached.token;
    if (!pending) pending = exchange();
    try { return await pending; } finally { pending = null; }
  };

  const lookup = async (kind: "subscriptionsv2" | "productsv2", packageName: string, purchaseToken: string): Promise<Record<string, unknown>> => {
    try {
      const token = await accessToken();
      const response = await fetcher(`${PLAY_URL}/${encodeURIComponent(packageName)}/purchases/${kind}/tokens/${encodeURIComponent(purchaseToken)}`, {
        method: "GET", headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        if (response.status === 401 && cached?.token === token) cached = null;
        await response.body?.cancel();
        if (response.status === 410) throw new GooglePlayPurchaseUnavailableError();
        throw new Error();
      }
      const result = await response.json();
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
      return result;
    } catch (error) {
      // Never attach upstream messages/causes: purchase tokens, assertions and
      // OAuth credentials can occur in URLs or response bodies.
      if (error instanceof GooglePlayPurchaseUnavailableError) throw error;
      throw new Error("google_play_lookup_unavailable");
    }
  };
  return {
    getSubscription: (packageName: string, purchaseToken: string) => lookup("subscriptionsv2", packageName, purchaseToken),
    getProduct: (packageName: string, purchaseToken: string) => lookup("productsv2", packageName, purchaseToken),
  };
}
