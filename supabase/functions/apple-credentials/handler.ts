// Saved Apple connection management. Private keys only enter Vault; responses contain metadata.
import { bearer, browserFunction, json } from "../_shared/core/http.ts";
import { validApplePrivateKey, type AppleCredentialMetadata, type AppleCredentialProvider } from "../_shared/credentials.ts";
import type { AuthUser } from "../_shared/supabase.ts";

export const RATE_LIMIT = { calls: 30, windowSeconds: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Z0-9]{10}$/;
const MAX_BODY = 20_000;
export type SaveCredential = {
  accountId: string; userId: string; provider: AppleCredentialProvider; label: string;
  keyId: string; issuerId: string; privateKey: string; id: string | null;
};
export type Deps = {
  getUser: (jwt: string | null) => Promise<AuthUser | null>;
  canManage: (accountId: string, userId: string) => Promise<boolean>;
  list: (accountId: string, userId: string, provider: AppleCredentialProvider) => Promise<AppleCredentialMetadata[]>;
  save: (value: SaveCredential) => Promise<AppleCredentialMetadata | null>;
  remove: (id: string, accountId: string, userId: string) => Promise<boolean>;
  rateLimit: (userId: string) => Promise<number>;
  log?: Pick<Console, "error">;
};

/** Explicit allow-list prevents an accidental RPC result from exposing a decrypted secret. */
function metadata(value: AppleCredentialMetadata) {
  return { id: value.id, provider: value.provider, label: value.label, key_id: value.key_id,
    issuer_id: value.issuer_id, created_at: value.created_at, updated_at: value.updated_at };
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const reader = req.body?.getReader();
  if (!reader || Number(req.headers.get("content-length")) > MAX_BODY) return null;
  let size = 0, source = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    source += decoder.decode(value, { stream: true });
  }
  try {
    const body = JSON.parse(source + decoder.decode());
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

export function createAppleCredentials(deps: Deps) {
  return browserFunction(async req => {
    const user = await deps.getUser(bearer(req));
    if (!user) return json(401, { error: "unauthorized" });
    const body = await readBody(req);
    if (!body) return json(400, { error: "invalid_request" });
    const { action, account_id, credential_id } = body;
    if (action !== "list" && action !== "save" && action !== "delete") return json(400, { error: "invalid_action" });
    if (typeof account_id !== "string" || !UUID.test(account_id)) return json(400, { error: "invalid_account_id" });
    if (credential_id !== undefined && (typeof credential_id !== "string" || !UUID.test(credential_id))) {
      return json(400, { error: "invalid_credential_id" });
    }
    if (!await deps.canManage(account_id, user.id)) return json(403, { error: "admin_required" });
    const provider = body.provider ?? "apple_connect";
    if (provider !== "apple_connect" && provider !== "apple_iap") return json(400, { error: "invalid_provider" });
    try {
      const retryAfter = await deps.rateLimit(user.id);
      if (!Number.isFinite(retryAfter) || retryAfter < 0) throw new Error("invalid_rate_limit_response");
      if (retryAfter > 0) return json(429, { error: "rate_limited", retry_after: retryAfter }, { "retry-after": String(retryAfter) });
      if (action === "list") return json(200, { credentials: (await deps.list(account_id, user.id, provider)).map(metadata) });
      if (action === "delete") {
        if (typeof credential_id !== "string") return json(400, { error: "invalid_credential_id" });
        return await deps.remove(credential_id, account_id, user.id)
          ? json(200, { deleted: true }) : json(404, { error: "credential_not_found" });
      }
      const keyId = typeof body.key_id === "string" ? body.key_id.trim() : "";
      const issuerId = typeof body.issuer_id === "string" ? body.issuer_id.trim() : "";
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label || label.length > 100 || /[\x00-\x1f\x7f]/.test(label)) return json(400, { error: "invalid_credential_label" });
      if (!KEY_ID.test(keyId)) return json(400, { error: "invalid_key_id" });
      if (!UUID.test(issuerId)) return json(400, { error: "invalid_issuer_id" });
      if (typeof body.private_key !== "string" || !await validApplePrivateKey(body.private_key)) {
        return json(400, { error: "invalid_private_key" });
      }
      const saved = await deps.save({ accountId: account_id, userId: user.id, provider, label,
        keyId, issuerId, privateKey: body.private_key.trim(), id: typeof credential_id === "string" ? credential_id : null });
      return saved ? json(200, { credential: metadata(saved) }) : json(404, { error: "credential_not_found" });
    } catch (error) {
      // A database error can contain request details. Never log it with a private key in scope.
      const message = error instanceof Error ? error.message : "";
      const known = message.match(/"message"\s*:\s*"(credential_limit|credential_not_found|admin_required|invalid_credentials)"/)?.[1];
      if (known) return json(known === "credential_limit" ? 409 : known === "credential_not_found" ? 404 : known === "admin_required" ? 403 : 400, { error: known });
      deps.log?.error("apple credential operation failed");
      return json(503, { error: "credential_storage_unavailable" });
    }
  }, deps.log);
}
