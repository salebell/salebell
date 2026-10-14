// App Store Connect automation with account-scoped saved credentials. Never log secrets.
import { bearer, browserFunction, json } from "../_shared/core/http.ts";
import { isAllowedHostname } from "../_shared/core/net.ts";
import { isSalebellReceiver } from "../_shared/core/receiver-url.ts";
import type { AuthUser } from "../_shared/supabase.ts";

export const RATE_LIMIT = { calls: 10, windowSeconds: 60 };
export const APPLE_API = "https://api.appstoreconnect.apple.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPLE_ID = /^\d{6,12}$/;
const KEY_ID = /^[A-Z0-9]{10}$/;
const MAX_BODY = 20_000;
const APP_FIELDS = "name,bundleId,subscriptionStatusUrl,subscriptionStatusUrlForSandbox,subscriptionStatusUrlVersion,subscriptionStatusUrlVersionForSandbox";

export type Urls = { production_url: string | null; sandbox_url: string | null };
export type AppleSettings = Urls & { production_version: string | null; sandbox_version: string | null };
export type AppleApp = AppleSettings & { apple_app_id: string; name: string; bundle_id: string };
export type LocalApp = {
  id: string; account_id: string; bundle_id: string; apple_app_id: number | string | null; webhook_key: string;
  forward_url_production: string | null; forward_url_sandbox: string | null;
};
export type ConnectPreview = {
  app_id: string; apple_app_id: string; bundle_id: string;
  current: AppleSettings; target: Urls; forwarding: Urls; expected_forwarding: Urls; already_configured: boolean;
};
export type PrepareForwarding = {
  app: LocalApp; userId: string; expected: Urls; forwarding: Urls;
};
export type AppleCredentials = { key_id: string; issuer_id: string; private_key: string };
export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  canManage: (accountId: string, userId: string) => Promise<boolean>;
  app: (appId: string) => Promise<LocalApp | null>;
  /** Includes disabled apps and other workspaces; only missing receiver keys are replaceable. */
  receiverExists: (webhookKey: string) => Promise<boolean>;
  /** Returns null after deletion/revocation; never falls back to caller-supplied secrets. */
  credentials: (credentialId: string, accountId: string, userId: string) => Promise<AppleCredentials | null>;
  /** Atomically checks membership, app identity and expected forwarding before saving. */
  prepareForwarding: (args: PrepareForwarding) => Promise<"ok" | "app_not_found" | "preview_changed" | "forbidden">;
  rateLimit: (userId: string) => Promise<number>;
  siteUrl?: string;
  supabaseUrl?: string;
  internalSupabaseUrl?: string;
  fetcher?: typeof fetch;
  clock?: () => number;
  log?: Pick<Console, "error">;
};

class ConnectError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
function fail(status: number, code: string): never { throw new ConnectError(status, code); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));

/** App Store Connect JWTs intentionally omit the App Store Server API's `bid` claim. */
export async function appStoreConnectJwt(key: AppleCredentials, now = Date.now()) {
  const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
  const signer = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(now / 1_000);
  const input = `${encodeJson({ alg: "ES256", kid: key.key_id, typ: "JWT" })}.${encodeJson({ iss: key.issuer_id, iat, exp: iat + 300, aud: "appstoreconnect-v1" })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, new TextEncoder().encode(input));
  return `${input}.${encode(new Uint8Array(sig))}`;
}

/** Bound the body before JSON parsing; never echo uploaded data in an error. */
async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length")) > MAX_BODY) fail(413, "request_too_large");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "invalid_request");
  const decoder = new TextDecoder();
  let size = 0;
  let source = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); fail(413, "request_too_large"); }
    source += decoder.decode(value, { stream: true });
  }
  source += decoder.decode();
  let body: unknown;
  try { body = JSON.parse(source); } catch { fail(400, "invalid_request"); }
  if (!record(body)) fail(400, "invalid_request");
  return body;
}

function setting(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_048) fail(502, "apple_invalid_response");
  return value;
}

function appleApp(value: unknown): AppleApp {
  if (!record(value) || !record(value.attributes) || typeof value.id !== "string" || !APPLE_ID.test(value.id)) fail(502, "apple_invalid_response");
  const a = value.attributes;
  if (typeof a.name !== "string" || !a.name || a.name.length > 500 || typeof a.bundleId !== "string" || !a.bundleId || a.bundleId.length > 255) fail(502, "apple_invalid_response");
  return {
    apple_app_id: value.id, name: a.name, bundle_id: a.bundleId,
    production_url: setting(a.subscriptionStatusUrl), sandbox_url: setting(a.subscriptionStatusUrlForSandbox),
    production_version: setting(a.subscriptionStatusUrlVersion), sandbox_version: setting(a.subscriptionStatusUrlVersionForSandbox),
  };
}

function siteBase(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || !isAllowedHostname(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { return fail(503, "apple_connect_not_configured"); }
}

function safePrevious(url: string, site: string, hosts: Pick<Deps, "supabaseUrl" | "internalSupabaseUrl">) {
  try {
    if (!url.startsWith("https://") || url.length > 2_048 || /[\s\x00-\x1f]/.test(url)) fail(409, "forwarding_requires_manual_setup");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || !isAllowedHostname(parsed.hostname)) fail(409, "forwarding_requires_manual_setup");
    if (isSalebellReceiver(parsed, { siteUrl: site, ...hosts })) fail(409, "forwarding_requires_manual_setup");
  } catch (error) {
    if (error instanceof ConnectError) throw error;
    fail(409, "forwarding_requires_manual_setup");
  }
}

async function previewFor(app: LocalApp, apple: AppleApp, site: string, deps: Pick<Deps, "supabaseUrl" | "internalSupabaseUrl" | "receiverExists">): Promise<ConnectPreview> {
  if (String(app.apple_app_id) !== apple.apple_app_id || app.bundle_id !== apple.bundle_id) fail(409, "apple_app_mismatch");
  const target = { production_url: `${site}/hooks/apple/${app.webhook_key}/production`, sandbox_url: `${site}/hooks/apple/${app.webhook_key}/sandbox` };
  const expected = { production_url: app.forward_url_production, sandbox_url: app.forward_url_sandbox };
  const forwarding = { ...expected };
  const preserve = async (url: string | null, version: string | null, env: "production_url" | "sandbox_url") => {
    if (!url || url === target[env]) return;
    if (isSalebellReceiver(url, { siteUrl: site, supabaseUrl: deps.supabaseUrl, internalSupabaseUrl: deps.internalSupabaseUrl })) {
      const previous = new URL(url);
      const key = previous.pathname.match(/^\/(?:hooks\/apple|functions\/v1\/apple-webhook)\/([a-f0-9]{32})\/(?:production|sandbox)$/)?.[1];
      // A deleted app leaves its old URLs in Apple. Replace those URLs directly;
      // forwarding to a removed receiver would lose notifications. Live receivers
      // still need manual review, even when they belong to the same workspace.
      if (key && previous.protocol === "https:" && !previous.port && !previous.username && !previous.password
        && !previous.search && !previous.hash && !await deps.receiverExists(key)) return;
    }
    safePrevious(url, site, deps);
    // The receiver forwards its raw V2 payload. Existing V1 servers need manual migration.
    if (version !== "V2") fail(409, "notification_v1_requires_manual_setup");
    if (forwarding[env] && forwarding[env] !== url) fail(409, "forwarding_conflict");
    forwarding[env] = url;
  };
  await preserve(apple.production_url, apple.production_version, "production_url");
  if (apple.sandbox_url) await preserve(apple.sandbox_url, apple.sandbox_version, "sandbox_url");
  else {
    // Apple uses the production URL for sandbox when no sandbox URL is configured.
    const fallback = apple.production_url === target.production_url ? forwarding.production_url : apple.production_url;
    await preserve(fallback, apple.production_url === target.production_url ? "V2" : apple.production_version, "sandbox_url");
  }
  for (const url of Object.values(forwarding)) if (url) safePrevious(url, site, deps);
  const current = { production_url: apple.production_url, sandbox_url: apple.sandbox_url, production_version: apple.production_version, sandbox_version: apple.sandbox_version };
  return {
    app_id: app.id, apple_app_id: apple.apple_app_id, bundle_id: apple.bundle_id, current, target, forwarding, expected_forwarding: expected,
    already_configured: apple.production_url === target.production_url && apple.sandbox_url === target.sandbox_url && apple.production_version === "V2" && apple.sandbox_version === "V2",
  };
}

/** Compare known fields, independent of JSON key ordering; ignore no meaningful preview fields. */
function samePreview(value: unknown, expected: ConnectPreview): boolean {
  if (!record(value)) return false;
  for (const name of ["app_id", "apple_app_id", "bundle_id", "already_configured"] as const) if (value[name] !== expected[name]) return false;
  for (const name of ["current", "target", "forwarding", "expected_forwarding"] as const) {
    const actual = value[name];
    if (!record(actual)) return false;
    const wanted = expected[name] as Record<string, unknown>;
    for (const key of Object.keys(wanted)) if (actual[key] !== wanted[key]) return false;
  }
  return true;
}

export function createAppleConnect(deps: Deps) {
  const fetcher = deps.fetcher ?? fetch;
  return browserFunction(async req => {
    try {
      const user = await deps.getUser(bearer(req));
      if (!user) return json(401, { error: "unauthorized" });
      const body = await readBody(req);
      const { action } = body;
      if (action !== "discover" && action !== "preview" && action !== "configure") fail(400, "invalid_action");
      let app: LocalApp | null = null;
      let accountId: string;
      if (action === "discover") {
        if (typeof body.account_id !== "string" || !UUID.test(body.account_id)) fail(400, "invalid_account_id");
        accountId = body.account_id;
      } else {
        if (typeof body.app_id !== "string" || !UUID.test(body.app_id)) fail(400, "invalid_app_id");
        app = await deps.app(body.app_id);
        if (!app) fail(404, "app not found");
        accountId = app.account_id;
      }
      if (!await deps.canManage(accountId, user.id)) fail(403, "admin_required");
      if (typeof body.credential_id !== "string" || !UUID.test(body.credential_id)) fail(400, "invalid_credential_id");
      let wait: number;
      try { wait = await deps.rateLimit(user.id); } catch { return json(503, { error: "rate_limit_unavailable" }); }
      if (!Number.isFinite(wait) || wait < 0) fail(503, "rate_limit_unavailable");
      if (wait > 0) return json(429, { error: "rate_limited", retry_after: wait }, { "retry-after": String(wait) });
      const credentials = await deps.credentials(body.credential_id, accountId, user.id);
      if (!credentials) fail(404, "credential_not_found");
      const { key_id, issuer_id, private_key } = credentials;
      if (!KEY_ID.test(key_id.trim())) fail(400, "invalid_key_id");
      if (!UUID.test(issuer_id.trim())) fail(400, "invalid_issuer_id");
      if (!private_key.trim() || private_key.length > 4_000) fail(400, "invalid_private_key");
      let jwt: string;
      try { jwt = await appStoreConnectJwt({ key_id: key_id.trim(), issuer_id: issuer_id.trim(), private_key }, deps.clock?.()); }
      catch { return json(400, { error: "invalid_private_key" }); }
      const appleRequest = async (path: string, init?: RequestInit) => {
        let response: Response;
        try {
          response = await fetcher(`${APPLE_API}${path}`, {
            ...init, headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000),
          });
        } catch { return fail(502, init?.method === "PATCH" ? "apple_configuration_unconfirmed" : "apple_unavailable"); }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) fail(401, "apple_rejected_key");
          if (response.status === 403) fail(403, "apple_permission_denied");
          if (response.status === 404) fail(404, "apple_app_not_found");
          if (response.status === 429) fail(429, "apple_rate_limited");
          fail(502, init?.method === "PATCH" ? "apple_configuration_unconfirmed" : "apple_unavailable");
        }
        try { return await response.json() as unknown; } catch { return fail(502, "apple_invalid_response"); }
      };
      if (action === "discover") {
        const query = new URLSearchParams({ limit: "200", "fields[apps]": APP_FIELDS });
        if (body.cursor !== undefined && body.cursor !== null) {
          if (typeof body.cursor !== "string" || !body.cursor || body.cursor.length > 2_000 || /[\x00-\x1f]/.test(body.cursor)) fail(400, "invalid_cursor");
          query.set("cursor", body.cursor);
        }
        const result = await appleRequest(`/v1/apps?${query}`);
        if (!record(result) || !Array.isArray(result.data) || result.data.length > 200) fail(502, "apple_invalid_response");
        const apps = result.data.map(appleApp);
        let next: string | null = null;
        if (record(result.links) && result.links.next != null) {
          if (typeof result.links.next !== "string" || result.links.next.length > 4_000) fail(502, "apple_invalid_response");
          let nextUrl: URL;
          try { nextUrl = new URL(result.links.next); } catch { return fail(502, "apple_invalid_response"); }
          if (nextUrl.origin !== APPLE_API || nextUrl.pathname !== "/v1/apps" || nextUrl.username || nextUrl.password) fail(502, "apple_invalid_response");
          next = nextUrl.searchParams.get("cursor");
          if (!next || next.length > 2_000 || /[\x00-\x1f]/.test(next)) fail(502, "apple_invalid_response");
        }
        return json(200, { apps, next_cursor: next });
      }
      const local = app!;
      if (!APPLE_ID.test(String(local.apple_app_id))) fail(400, "apple_app_id_required");
      const site = siteBase(deps.siteUrl);
      const appPath = `/v1/apps/${local.apple_app_id}?${new URLSearchParams({ "fields[apps]": APP_FIELDS })}`;
      const result = await appleRequest(appPath);
      if (!record(result)) fail(502, "apple_invalid_response");
      const preview = await previewFor(local, appleApp(result.data), site, deps);
      if (action === "preview") return json(200, { preview });
      if (!samePreview(body.preview, preview)) fail(409, "preview_changed");
      const prepared = await deps.prepareForwarding({ app: local, userId: user.id, expected: preview.expected_forwarding, forwarding: preview.forwarding });
      if (prepared === "forbidden") fail(403, "admin_required");
      if (prepared === "app_not_found") fail(404, "app not found");
      if (prepared !== "ok") fail(409, "preview_changed");
      if (!preview.already_configured) {
        // Catch changes made while forwarding was saved. Apple's API has no atomic
        // compare-and-swap with our database; these final reads narrow that window.
        const latestResult = await appleRequest(appPath);
        if (!record(latestResult)) fail(502, "apple_invalid_response");
        const latestApple = appleApp(latestResult.data);
        if (latestApple.apple_app_id !== preview.apple_app_id || latestApple.bundle_id !== preview.bundle_id) fail(409, "preview_changed");
        for (const field of ["production_url", "sandbox_url", "production_version", "sandbox_version"] as const) {
          if (latestApple[field] !== preview.current[field]) fail(409, "preview_changed");
        }
        const latestLocal = await deps.app(local.id);
        if (!latestLocal || latestLocal.id !== local.id || latestLocal.account_id !== local.account_id
          || latestLocal.bundle_id !== local.bundle_id || String(latestLocal.apple_app_id) !== String(local.apple_app_id)
          || latestLocal.webhook_key !== local.webhook_key
          || latestLocal.forward_url_production !== preview.forwarding.production_url
          || latestLocal.forward_url_sandbox !== preview.forwarding.sandbox_url) fail(409, "preview_changed");
        await appleRequest(`/v1/apps/${local.apple_app_id}`, {
          method: "PATCH", body: JSON.stringify({ data: { type: "apps", id: String(local.apple_app_id), attributes: {
            subscriptionStatusUrl: preview.target.production_url, subscriptionStatusUrlForSandbox: preview.target.sandbox_url,
            subscriptionStatusUrlVersion: "V2", subscriptionStatusUrlVersionForSandbox: "V2",
          } } }),
        });
      }
      return json(200, { configured: true, verified: false });
    } catch (error) {
      if (error instanceof ConnectError) return json(error.status, { error: error.code });
      // Never log an exception or request: database/upstream errors can contain customer URLs.
      deps.log?.error("apple-connect request failed");
      return json(500, { error: "internal_error" });
    }
  }, deps.log);
}
