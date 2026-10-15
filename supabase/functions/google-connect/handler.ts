// Workspace-admin Google Play setup. Uploaded JSON only enters encrypted Vault
// storage; only allowlisted connection metadata is ever sent back to a browser.
import { bearer, browserFunction, json } from "../_shared/core/http.ts";
import { isAllowedHostname } from "../_shared/core/net.ts";
import { GoogleSetupError, provisionGoogleRtdn, type GoogleCloudCredentials } from "../_shared/core/google_cloud.ts";
import { discoverGooglePlayApps } from "../_shared/core/google_play_discovery.ts";
import type { AuthUser } from "../_shared/supabase.ts";

export const RATE_LIMIT = { calls: 30, windowSeconds: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$/;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const RESOURCE = /^projects\/[A-Za-z0-9][A-Za-z0-9._~+%-]*\/(topics|subscriptions)\/[A-Za-z][A-Za-z0-9._~+%-]*$/;
const MAX_BODY = 40_000;
export type LocalApp = {
  id: string; account_id: string; store: string; package_name: string | null; webhook_key: string; enabled: boolean;
  last_event_production_at: string | null; last_event_sandbox_at: string | null;
};
export type GoogleConnection = {
  topic: string | null; subscription: string; audience: string; service_account_email: string; updated_at: string;
};
export type SaveConnection = {
  app: LocalApp; userId: string; audience: string; topic: string; subscription: string;
  serviceAccountEmail: string; credentials: GoogleCloudCredentials & { type: "service_account" };
};
export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  app: (id: string) => Promise<LocalApp | null>;
  canManage: (accountId: string, userId: string) => Promise<boolean>;
  rateLimit: (userId: string) => Promise<number>;
  status: (appId: string, userId: string) => Promise<GoogleConnection | null>;
  save: (input: SaveConnection) => Promise<void>;
  remove: (appId: string, userId: string) => Promise<boolean>;
  provision?: typeof provisionGoogleRtdn;
  discover?: typeof discoverGooglePlayApps;
  publicApiUrl?: string;
  log?: Pick<Console, "error">;
};
class RequestError extends Error {
  status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}
const fail = (status: number, code: string): never => { throw new RequestError(status, code); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length")) > MAX_BODY) fail(413, "request_too_large");
  const reader = req.body?.getReader();
  if (!reader) return fail(400, "invalid_request");
  const decoder = new TextDecoder();
  let size = 0, source = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); fail(413, "request_too_large"); }
      source += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(source + decoder.decode()); } catch { return fail(400, "invalid_request"); }
  return record(body) ? body : fail(400, "invalid_request");
}

async function credentials(value: unknown): Promise<SaveConnection["credentials"]> {
  if (!record(value) || value.type !== "service_account" || typeof value.project_id !== "string" || !PROJECT.test(value.project_id)
    || typeof value.client_email !== "string" || value.client_email.length > 254 || !EMAIL.test(value.client_email)
    || typeof value.private_key !== "string" || value.private_key.length > 16_384) return fail(400, "invalid_credentials");
  try {
    if (!/^-----BEGIN PRIVATE KEY-----\s/.test(value.private_key) || !/-----END PRIVATE KEY-----\s*$/.test(value.private_key)) throw new Error();
    const der = Uint8Array.from(atob(value.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error();
  } catch { return fail(400, "invalid_credentials"); }
  if (value.private_key_id !== undefined && (typeof value.private_key_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value.private_key_id))) return fail(400, "invalid_credentials");
  return { type: "service_account", project_id: value.project_id, client_email: value.client_email,
    private_key: value.private_key, ...(typeof value.private_key_id === "string" ? { private_key_id: value.private_key_id } : {}) };
}

function receiverUrl(base: string | undefined, key: string): string {
  try {
    const url = new URL(base ?? "");
    if (url.protocol !== "https:" || !isAllowedHostname(url.hostname) || url.username || url.password || url.search || url.hash
      || !/^[A-Za-z0-9_-]{6,64}$/.test(key)) throw new Error();
    return `${url.href.replace(/\/$/, "")}/functions/v1/google-webhook/${key}`;
  } catch { return fail(503, "receiver_not_configured"); }
}

function metadata(value: GoogleConnection | null): GoogleConnection | null {
  return value ? { topic: value.topic, subscription: value.subscription, audience: value.audience,
    service_account_email: value.service_account_email, updated_at: value.updated_at } : null;
}
function verified(app: LocalApp, connection: GoogleConnection | null): boolean {
  if (!connection) return false;
  const configured = Date.parse(connection.updated_at);
  return [app.last_event_production_at, app.last_event_sandbox_at].some(at => at !== null && Date.parse(at) >= configured);
}

export function createGoogleConnect(deps: Deps) {
  async function limit(userId: string): Promise<Response | null> {
    const seconds = await deps.rateLimit(userId);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error();
    return seconds > 0 ? json(429, { error: "rate_limited", retry_after: seconds }, { "retry-after": String(seconds) }) : null;
  }
  return browserFunction(async req => {
    try {
      const user = await deps.getUser(bearer(req));
      if (!user) return json(401, { error: "unauthorized" });
      const body = await readBody(req);
      if (!["discover", "status", "configure", "delete"].includes(body.action as string)) return json(400, { error: "invalid_action" });
      if (body.action === "discover") {
        // Discovery happens before creating an app or storing a key. Only workspace
        // administrators may use this credential-bearing, rate-limited operation.
        if (typeof body.account_id !== "string" || !UUID.test(body.account_id)) return json(400, { error: "invalid_account_id" });
        if (!await deps.canManage(body.account_id, user.id)) return json(403, { error: "admin_required" });
        const limited = await limit(user.id);
        if (limited) return limited;
        if (body.cursor !== undefined && (typeof body.cursor !== "string" || body.cursor.length > 4096 || /[\u0000-\u001f\u007f]/.test(body.cursor))) return json(400, { error: "google_invalid_cursor" });
        const key = await credentials(body.credentials);
        const result = await (deps.discover ?? discoverGooglePlayApps)(key, body.cursor as string | undefined);
        return json(200, { apps: result.apps.map(app => ({ package_name: app.package_name, display_name: app.display_name })), next_cursor: result.next_cursor });
      }
      if (typeof body.app_id !== "string" || !UUID.test(body.app_id)) return json(400, { error: "invalid_app_id" });
      const app = await deps.app(body.app_id);
      if (!app) return json(404, { error: "app_not_found" });
      if (!await deps.canManage(app.account_id, user.id)) return json(403, { error: "admin_required" });
      if (app.store !== "play_store" || !app.package_name) return json(400, { error: "platform_mismatch" });
      const limited = await limit(user.id);
      if (limited) return limited;
      if (body.action === "status") {
        const connection = metadata(await deps.status(app.id, user.id));
        return json(200, { connection, verified: verified(app, connection) });
      }
      if (body.action === "delete") return json(200, { deleted: await deps.remove(app.id, user.id) });
      if (body.mode !== "automatic" && body.mode !== "manual") return json(400, { error: "invalid_mode" });
      const key = await credentials(body.credentials);
      const audience = receiverUrl(deps.publicApiUrl, app.webhook_key);
      let topic: string, subscription: string, serviceAccountEmail: string;
      if (body.mode === "automatic") {
        // A fresh permission read precedes provider mutations. The save RPC also
        // rechecks membership and app identity under a database lock.
        if (!await deps.canManage(app.account_id, user.id)) return json(403, { error: "admin_required" });
        ({ topic, subscription, serviceAccountEmail } = await (deps.provision ?? provisionGoogleRtdn)(key, { appId: app.id, receiverUrl: audience }));
      } else {
        if (typeof body.topic !== "string" || body.topic.length > 512 || !RESOURCE.test(body.topic) || !body.topic.includes("/topics/")) return json(400, { error: "invalid_topic" });
        if (typeof body.subscription !== "string" || body.subscription.length > 512 || !RESOURCE.test(body.subscription) || !body.subscription.includes("/subscriptions/")) return json(400, { error: "invalid_subscription" });
        topic = body.topic;
        subscription = body.subscription;
        serviceAccountEmail = typeof body.service_account_email === "string" ? body.service_account_email.trim() : key.client_email;
        if (serviceAccountEmail.length > 254 || !EMAIL.test(serviceAccountEmail)) return json(400, { error: "invalid_push_account" });
      }
      await deps.save({ app, userId: user.id, audience, topic, subscription, serviceAccountEmail, credentials: key });
      const connection = metadata(await deps.status(app.id, user.id));
      // An uploaded key and configured subscription do not prove Play delivery.
      const latest = await deps.app(app.id);
      return json(200, { connection, verified: latest ? verified(latest, connection) : false });
    } catch (error) {
      if (error instanceof RequestError) return json(error.status, { error: error.message });
      if (error instanceof GoogleSetupError) {
        const codes: Record<string, number> = { google_invalid_credentials: 400, google_api_permission_denied: 403,
          google_api_not_enabled: 403, google_resource_conflict: 409, google_setup_unavailable: 503,
          google_invalid_cursor: 400, google_discovery_unavailable: 503 };
        return json(codes[error.code] ?? 503, { error: Object.hasOwn(codes, error.code) ? error.code : "google_setup_unavailable" });
      }
      // Do not reflect a database detail or HTTP exception while keys are in scope.
      const known = error instanceof Error ? error.message.match(/"message"\s*:\s*"(preview_changed|admin_required|app_not_found|invalid_google_connection|invalid_google_credentials)"/)?.[1] : null;
      if (known) return json(known === "admin_required" ? 403 : known === "app_not_found" ? 404 : known === "preview_changed" ? 409 : 400, { error: known });
      deps.log?.error("google connection operation unavailable");
      return json(503, { error: "google_setup_unavailable" });
    }
  }, { error: () => deps.log?.error("google connection request unavailable") });
}
