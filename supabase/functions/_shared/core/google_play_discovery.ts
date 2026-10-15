import { GoogleSetupError, type GoogleCloudCredentials } from "./google_cloud.ts";

// App discovery is read-only and uses Reporting API access, independently of
// Publisher purchase permissions and Cloud Pub/Sub provisioning permissions.
// https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEARCH_URL = "https://playdeveloperreporting.googleapis.com/v1beta1/apps:search";
const SCOPE = "https://www.googleapis.com/auth/playdeveloperreporting";
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const EMAIL = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$/;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const MAX_RESPONSE_BYTES = 262_144;
type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
const encoded = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodedJson = (value: unknown) => encoded(new TextEncoder().encode(JSON.stringify(value)));
function fail(code = "google_discovery_unavailable"): never { throw new GoogleSetupError(code); }
function validCursor(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !CONTROL.test(value);
}

async function responseJson(response: Response): Promise<ObjectValue> {
  const reader = response.body?.getReader();
  if (!reader || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) { await reader?.cancel(); return fail(); }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let source = "", size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return fail(); }
      source += decoder.decode(value, { stream: true });
    }
    const result: unknown = JSON.parse(source + decoder.decode());
    return record(result) ? result : fail();
  } finally { reader.releaseLock(); }
}

/** Never follows provider URLs, persists credentials, or creates a local app. */
export async function discoverGooglePlayApps(credentials: GoogleCloudCredentials, pageCursor?: string,
  options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<{ apps: { package_name: string; display_name: string }[]; next_cursor: string | null }> {
  try {
    if (!credentials || typeof credentials.project_id !== "string" || !PROJECT_ID.test(credentials.project_id)
      || (credentials.type !== undefined && credentials.type !== "service_account")
      || typeof credentials.client_email !== "string" || credentials.client_email.length > 254 || !EMAIL.test(credentials.client_email)
      || typeof credentials.private_key !== "string" || credentials.private_key.length > 16_384
      || (credentials.private_key_id !== undefined && (typeof credentials.private_key_id !== "string"
        || !/^[A-Za-z0-9_-]{1,200}$/.test(credentials.private_key_id)))) fail("google_invalid_credentials");
    if (pageCursor !== undefined && !validCursor(pageCursor)) fail("google_invalid_cursor");
    let key: CryptoKey;
    try {
      const pem = credentials.private_key.replace(/\\n/g, "\n");
      if (!/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/.test(pem)) throw new Error();
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), char => char.charCodeAt(0));
      key = await crypto.subtle.importKey("pkcs8", der, RSA, false, ["sign"]);
      if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error();
    } catch { return fail("google_invalid_credentials"); }
    const seconds = Math.floor((options.now ?? Date.now)() / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 0) fail();
    const jwt = `${encodedJson({ alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) })}.${encodedJson({
      iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600,
    })}`;
    const signature = await crypto.subtle.sign(RSA, key, new TextEncoder().encode(jwt));
    const fetcher = options.fetcher ?? fetch;
    const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${jwt}.${encoded(new Uint8Array(signature))}` });
    const tokenResponse = await fetcher(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!tokenResponse.ok) {
      await tokenResponse.body?.cancel();
      fail(tokenResponse.status === 400 || tokenResponse.status === 401 ? "google_invalid_credentials" : "google_discovery_unavailable");
    }
    const token = await responseJson(tokenResponse);
    if (typeof token.access_token !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(token.access_token)
      || typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer"
      || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) fail();
    const query = new URLSearchParams({ pageSize: "100" });
    if (pageCursor !== undefined) query.set("pageToken", pageCursor);
    const response = await fetcher(`${SEARCH_URL}?${query}`, { method: "GET", headers: { authorization: `Bearer ${token.access_token}` },
      redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      if (response.status === 403) {
        let disabled = false;
        try {
          const body = await responseJson(response);
          disabled = record(body.error) && Array.isArray(body.error.details) && body.error.details.some(detail => record(detail)
            && detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.reason === "SERVICE_DISABLED");
        } catch { /* Do not expose unstructured provider messages. */ }
        fail(disabled ? "google_api_not_enabled" : "google_api_permission_denied");
      }
      await response.body?.cancel();
      fail();
    }
    const body = await responseJson(response);
    const entries = body.apps === undefined ? [] : body.apps;
    if (!Array.isArray(entries) || entries.length > 100) fail();
    const packages = new Set<string>();
    const apps = entries.map(value => {
      if (!record(value) || typeof value.name !== "string" || !/^apps\/[A-Za-z0-9][A-Za-z0-9._-]{0,499}$/.test(value.name)
        || typeof value.packageName !== "string" || value.packageName.length > 255 || !PACKAGE.test(value.packageName)
        || typeof value.displayName !== "string" || value.displayName.length > 500 || !value.displayName.trim() || CONTROL.test(value.displayName)
        || packages.has(value.packageName)) fail();
      packages.add(value.packageName);
      return { package_name: value.packageName, display_name: value.displayName.trim() };
    });
    let next: string | null = null;
    if (body.nextPageToken !== undefined && body.nextPageToken !== "") {
      if (!validCursor(body.nextPageToken) || body.nextPageToken === pageCursor) fail();
      next = body.nextPageToken;
    }
    return { apps, next_cursor: next };
  } catch (error) {
    if (error instanceof GoogleSetupError) throw error;
    return fail();
  }
}
