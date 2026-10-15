import type { FunctionAsset, ProviderTokens } from "./installer-types.ts";
import type { InstallerConfig } from "./installer-config.ts";

export class ProviderError extends Error {
  code: string; retryAfter: number;
  constructor(code: string, retryAfter = 0) { super(code); this.code = code; this.retryAfter = retryAfter; }
}
export async function apiRequest<T>(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.timeout(45_000), cache: "no-store" }); }
  catch { throw new ProviderError("provider_unavailable", 5); }
  if (!response.ok) {
    const retry = Math.min(300, Math.max(1, Number(response.headers.get("retry-after")) || 5));
    const body = await response.text().catch(() => "");
    const known = response.status >= 400 && response.status !== 401 && response.status !== 403 && response.status !== 429
      ? body.slice(0, 8192).match(/\b(project_not_empty|project_in_use|installation_conflict|migration_conflict)\b/)?.[1] : undefined;
    if (known) throw new ProviderError(known);
    throw new ProviderError(response.status === 401 || response.status === 403 ? "provider_authorization" : response.status === 429 ? "provider_rate_limited" : response.status === 402 ? "provider_plan_required" : "provider_request_failed", response.status >= 500 || response.status === 429 ? retry : 0);
  }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; } catch { throw new ProviderError("provider_invalid_response"); }
}
export type SqlRows = Record<string, unknown>[];
export type ApiKey = { name: string; api_key: string; type?: string };
export class SupabaseProvider {
  ref: string; token: string; fetcher: typeof fetch;
  constructor(ref: string, token: string, fetcher: typeof fetch = fetch) {
    if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("project_mismatch");
    this.ref = ref; this.token = token; this.fetcher = fetcher;
  }
  call<T>(path: string, method = "GET", body?: unknown) {
    return apiRequest<T>(`https://api.supabase.com/v1/projects/${this.ref}${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, this.fetcher);
  }
  query(query: string, readOnly = false) { return this.call<SqlRows>("/database/query", "POST", { query, read_only: readOnly }); }
  metadata() { return this.call<{ id: string; name: string; status: string }>(""); }
  keys() { return this.call<ApiKey[]>("/api-keys?reveal=true"); }
  functions() { return this.call<{ slug: string; verify_jwt: boolean; status: string }[]>("/functions"); }
  authConfig() { return this.call<{ jwt_secret?: string; site_url?: string }>("/config/auth"); }
  updateAuth(origin: string) { return this.call("/config/auth", "PATCH", { site_url: origin, uri_allow_list: `${origin}/**`, disable_signup: true, external_email_enabled: true }); }
  setSiteUrl(origin: string) { return this.call("/secrets", "POST", [{ name: "SITE_URL", value: origin }]); }
  deployFunction(asset: FunctionAsset) {
    const form = new FormData();
    form.append("metadata", JSON.stringify({ name: asset.slug, entrypoint_path: `${asset.slug}/index.ts`, verify_jwt: asset.verifyJwt }));
    for (const file of asset.files) form.append("file", new Blob([file.content], { type: "application/typescript" }), file.name);
    return apiRequest<{ slug: string; status: string }>(`https://api.supabase.com/v1/projects/${this.ref}/functions/deploy?slug=${encodeURIComponent(asset.slug)}`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body: form }, this.fetcher);
  }
}
export async function exchangeSupabase(config: InstallerConfig, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<ProviderTokens> {
  return supabaseToken(config, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `${config.origin}/api/deploy/supabase-callback` }, fetcher);
}
export async function refreshSupabase(config: InstallerConfig, refresh: string, fetcher: typeof fetch = fetch): Promise<ProviderTokens> {
  return supabaseToken(config, { grant_type: "refresh_token", refresh_token: refresh }, fetcher);
}
async function supabaseToken(config: InstallerConfig, values: Record<string, string>, fetcher: typeof fetch): Promise<ProviderTokens> {
  const result = await apiRequest<{ access_token: string; refresh_token: string; expires_in: number }>("https://api.supabase.com/v1/oauth/token", {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.supabaseClientId}:${config.supabaseSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values),
  }, fetcher);
  if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in)) throw new ProviderError("provider_invalid_response");
  return { access: result.access_token, refresh: result.refresh_token, expires: Date.now() + result.expires_in * 1000 };
}
