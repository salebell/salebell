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
export type VercelProject = { id: string; name: string; rootDirectory?: string; link?: { type: string; repoId?: number | string; productionBranch?: string }; latestDeployments?: { id: string }[] };
export type VercelDeployment = { id: string; readyState: string; meta?: Record<string, string>; gitSource?: { sha?: string; ref?: string }; alias?: string[] };
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
export class VercelProvider {
  token: string; teamId?: string; fetcher: typeof fetch;
  constructor(token: string, teamId?: string, fetcher: typeof fetch = fetch) { this.token = token; this.teamId = teamId; this.fetcher = fetcher; }
  call<T>(path: string, method = "GET", body?: unknown) {
    const url = new URL(path, "https://api.vercel.com");
    if (this.teamId) url.searchParams.set("teamId", this.teamId);
    return apiRequest<T>(url.href, { method, headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, this.fetcher);
  }
  async verifyConfiguration(id: string, integrationId: string, projectId?: string) {
    const result = await this.call<{ id: string; integrationId: string; projects?: string[] | null }>(`/v1/integrations/configuration/${encodeURIComponent(id)}`);
    if (result.id !== id || result.integrationId !== integrationId || (projectId && result.projects && !result.projects.includes(projectId))) throw new Error("project_mismatch");
    return result;
  }
  project(id: string) { return this.call<VercelProject>(`/v9/projects/${encodeURIComponent(id)}`); }
  projects() { return this.call<{ projects: VercelProject[] }>("/v9/projects?limit=100"); }
  domains(id: string) { return this.call<{ domains: { name: string; redirect?: string | null }[] }>(`/v9/projects/${encodeURIComponent(id)}/domains`); }
  environments(id: string) { return this.call<{ envs: { key: string; value?: string; target?: string[] }[] }>(`/v10/projects/${encodeURIComponent(id)}/env?decrypt=true`); }
  async configure(id: string, values: Record<string, string>) {
    await this.call(`/v9/projects/${encodeURIComponent(id)}`, "PATCH", { rootDirectory: "web", framework: "nextjs" });
    await this.call(`/v10/projects/${encodeURIComponent(id)}/env?upsert=true`, "POST", Object.entries(values).map(([key, value]) => ({ key, value, type: "plain", target: ["production"] })));
  }
  async deployments(id: string) {
    const result = await this.call<{ deployments: (Omit<VercelDeployment, "id" | "readyState"> & { uid: string; state?: string; readyState?: string })[] }>(`/v6/deployments?projectId=${encodeURIComponent(id)}&limit=20&target=production`);
    return { deployments: result.deployments.map(value => ({ ...value, id: value.uid, readyState: value.readyState ?? value.state ?? "UNKNOWN" })) };
  }
  deployment(id: string) { return this.call<VercelDeployment>(`/v13/deployments/${encodeURIComponent(id)}`); }
  deploy(project: VercelProject, revision: string, installationId: string) {
    if (project.link?.type !== "github" || !project.link.repoId) throw new Error("unsupported_repository");
    return this.call<VercelDeployment>("/v13/deployments", "POST", { name: project.name, project: project.id, target: "production", gitSource: { type: "github", repoId: String(project.link.repoId), ref: revision }, meta: { salebellInstaller: installationId, salebellRelease: revision } });
  }
}
export async function exchangeVercel(config: InstallerConfig, code: string, fetcher: typeof fetch = fetch) {
  const result = await apiRequest<{ access_token: string; installation_id: string; team_id?: string }>("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.vercelClientId, client_secret: config.vercelSecret, code, redirect_uri: `${config.origin}/api/deploy/vercel-callback` }),
  }, fetcher);
  if (!result.access_token || !result.installation_id) throw new ProviderError("provider_invalid_response");
  return { access: result.access_token, configurationId: result.installation_id, teamId: result.team_id };
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
