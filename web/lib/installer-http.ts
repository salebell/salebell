import { randomUUID } from "node:crypto";
import type { InstallerConfig } from "./installer-config.ts";
import { deployUrl } from "./installer-config.ts";
import { consumeState, digest, equalSecret, newState, randomToken } from "./installer-security.ts";
import { InstallerStore } from "./installer-store.ts";
import { ProviderError, SupabaseProvider, VercelProvider, apiRequest, exchangeSupabase, exchangeVercel, refreshSupabase } from "./installer-providers.ts";
import { advanceInstallation, bindTarget } from "./installer-runner.ts";
import { finishOwner, ownerInput } from "./installer-owner.ts";
import type { InstallJob, Release } from "./installer-types.ts";

const COOKIE = "__Host-salebell-installer";
const knownErrors = new Set(["oauth_state_invalid", "session_expired", "busy_or_expired", "project_mismatch", "project_not_empty", "project_in_use", "installation_conflict", "migration_conflict", "production_domain_pending", "provider_reconnect_required", "provider_authorization", "provider_rate_limited", "provider_plan_required", "provider_request_failed", "provider_invalid_response", "provider_unavailable", "function_deployment_pending", "deployment_failed", "instance_not_ready", "release_mismatch", "webhook_proxy_failed", "owner_conflict", "invalid_owner_credentials", "owner_signin_failed", "owner_workspace_missing", "protected_function_check_failed", "unsupported_repository", "vercel_reconnect_required", "invalid_request"]);
const errorCode = (error: unknown) => error instanceof Error && knownErrors.has(error.message) ? error.message : "installation_failed";
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer", ...extra } });
const redirect = (url: string) => new Response(null, { status: 303, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
function sessionCookie(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const match = value?.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/);
  return match ? { id: match[1], hash: digest(match[2]) } : null;
}
export function publicStatus(job: InstallJob) {
  return { phase: job.phase, cursor: job.cursor, error: job.error ?? null, retryAt: job.retryAt ?? null,
    reconnect: job.error === "provider_authorization" || job.error === "provider_reconnect_required" || job.error === "vercel_reconnect_required",
    needsVercel: !job.vercel && !["complete", "canceled"].includes(job.phase), needsSupabase: Boolean(job.vercel && !job.supabase),
    projectHint: job.projectHint ?? null,
    target: job.target ? { projectName: job.target.projectName, supabaseName: job.target.supabaseName, origin: job.target.origin } : null };
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("invalid_request");
  const text = await request.text();
  if (text.length > 4096) throw new Error("invalid_request");
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch { /* reject */ }
  throw new Error("invalid_request");
}
export function createInstallerHandler(config: InstallerConfig | null, release: Release, fetcher: typeof fetch = fetch) {
  return async (request: Request, action: string): Promise<Response> => {
    if (!config || new URL(request.url).origin !== config.origin) return json(404, { error: "not_found" });
    const callback = action === "vercel-callback" || action === "supabase-callback";
    const get = ["status", "projects", "vercel-callback", "supabase-callback", "cleanup"].includes(action);
    const post = ["start", "connect-vercel", "connect-supabase", "select", "advance", "owner", "cancel"].includes(action);
    if (!get && !post) return json(404, { error: "not_found" });
    if (request.method !== (get ? "GET" : "POST")) return json(405, { error: "method_not_allowed" });
    if (post && (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site")) return json(403, { error: "origin_required" });
    const store = new InstallerStore(config, fetcher);
    if (action === "cleanup") {
      if (!equalSecret(request.headers.get("authorization") ?? "", `Bearer ${config.cleanupSecret}`)) return json(401, { error: "unauthorized" });
      try { return json(200, { removed: await store.cleanup() }); } catch { return json(503, { error: "cleanup_unavailable" }); }
    }
    const session = sessionCookie(request);
    if (action === "start") {
      try {
        if (session) {
          const existing = await store.read(session.id, session.hash).catch(() => null);
          if (existing && !["complete", "canceled"].includes(existing.phase)) return json(200, { ...publicStatus(existing), resume: true });
        }
        const ip = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown";
        if (await store.rate(`start:${digest(config.encryptionKey + ip)}`, 5, 600) || await store.rate("start:global", 100, 3600)) return json(429, { error: "rate_limited" });
        const token = randomToken(); const state = newState("vercel"); const now = Date.now();
        const job: InstallJob = { id: randomUUID(), version: 0, phase: "clone", cursor: 0, createdAt: now, expiresAt: now + 7 * 86400000, pending: state.pending };
        await store.create(job, digest(token));
        return json(200, { url: deployUrl(config, state.value) }, { "set-cookie": `${COOKIE}=${job.id}.${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
      } catch (error) { return json(503, { error: errorCode(error) }); }
    }
    if (!session) return json(401, { error: "session_required" });
    let job: InstallJob | undefined; let lease: string | undefined;
    try {
      if (get && !callback) {
        job = await store.read(session.id, session.hash);
        if (action === "status") return json(200, publicStatus(job));
        if (!job.vercel) throw new Error("provider_reconnect_required");
        const provider = new VercelProvider(job.vercel.access, job.vercel.teamId, fetcher);
        await provider.verifyConfiguration(job.vercel.configurationId, config.vercelClientId);
        const projects = await provider.projects();
        return json(200, { projects: projects.projects.map(project => ({ id: project.id, name: project.name })) });
      }
      const retry = await store.rate(`${action}:${session.id}`, action === "owner" ? 5 : callback ? 10 : 90, 60);
      if (retry > 0) return json(429, { error: "rate_limited" }, { "retry-after": String(retry) });
      ({ job, lease } = await store.acquire(session.id, session.hash));
      if (["complete", "canceled"].includes(job.phase)) {
        await store.save(job, session.hash, lease);
        return json(200, publicStatus(job));
      }
      const url = new URL(request.url);
      if (callback) {
        const provider = action === "vercel-callback" ? "vercel" : "supabase";
        const verifier = job.pending?.verifier;
        job.pending = consumeState(job.pending, url.searchParams.get(provider === "vercel" ? "external-id" : "state") ?? url.searchParams.get("state") ?? "", provider);
        await store.save(job, session.hash, lease);
        ({ job, lease } = await store.acquire(session.id, session.hash));
        const code = url.searchParams.get("code");
        if (!code || code.length > 4096) throw new Error(provider === "vercel" ? "vercel_reconnect_required" : "oauth_state_invalid");
        if (provider === "vercel") {
          const token = await exchangeVercel(config, code, fetcher);
          if (url.searchParams.get("configurationId") !== token.configurationId) throw new Error("project_mismatch");
          const project = url.searchParams.get("currentProjectId") ?? job.target?.projectId ?? job.projectHint;
          if (job.target && project !== job.target.projectId) throw new Error("project_mismatch");
          await new VercelProvider(token.access, token.teamId, fetcher).verifyConfiguration(token.configurationId, config.vercelClientId, project);
          if (project && !job.target) {
            await new VercelProvider(token.access, token.teamId, fetcher).configure(project, { NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", SALEBELL_BROWSER_INSTALL: "true", SALEBELL_INSTALLER_ORIGIN: config.origin });
          }
          job.vercel = token; job.projectHint = project;
          if (!job.target) job.phase = "connect_supabase";
        } else {
          if (!verifier) throw new Error("oauth_state_invalid");
          job.supabase = await exchangeSupabase(config, code, verifier, fetcher);
        }
        job.error = undefined;
        await store.save(job, session.hash, lease, undefined, true);
        const next = provider === "vercel" ? url.searchParams.get("next") : null;
        if (next) {
          const destination = new URL(next);
          if (destination.origin === "https://vercel.com" && !destination.username && !destination.password) return redirect(destination.href);
        }
        return redirect(`${config.origin}/deploy`);
      }
      if (action === "connect-vercel" || action === "connect-supabase") {
        const provider = action === "connect-vercel" ? "vercel" : "supabase";
        const state = newState(provider);
        job.pending = state.pending;
        let destination: URL;
        if (provider === "vercel") {
          destination = new URL(`https://vercel.com/integrations/${config.vercelSlug}/new`);
          destination.searchParams.set("state", state.value);
        } else {
          if (!job.vercel) throw new Error("provider_reconnect_required");
          const verifier = randomToken(); job.pending.verifier = verifier;
          destination = new URL("https://api.supabase.com/v1/oauth/authorize");
          for (const [key, value] of Object.entries({ client_id: config.supabaseClientId, redirect_uri: `${config.origin}/api/deploy/supabase-callback`, response_type: "code", state: state.value, code_challenge_method: "S256", code_challenge: Buffer.from(digest(verifier), "hex").toString("base64url") })) destination.searchParams.set(key, value);
        }
        job.error = undefined;
        await store.save(job, session.hash, lease, undefined, !job.vercel && !job.supabase);
        return json(200, { url: destination.href });
      }
      if (action === "cancel") {
        job.phase = "canceled"; job.pending = undefined; job.vercel = undefined; job.supabase = undefined;
      } else {
        if (!job.vercel || !job.supabase) throw new Error("provider_reconnect_required");
        if (job.supabase.expires && job.supabase.expires < Date.now() + 60000) {
          if (!job.supabase.refresh) throw new Error("provider_reconnect_required");
          job.supabase = await refreshSupabase(config, job.supabase.refresh, fetcher);
        }
        const vercel = new VercelProvider(job.vercel.access, job.vercel.teamId, fetcher);
        if (action === "select") {
          if (job.target || job.phase !== "connect_supabase") throw new Error("project_mismatch");
          const body = await readBody(request);
          if (typeof body.projectId !== "string" || !/^[a-zA-Z0-9_-]{3,100}$/.test(body.projectId)) throw new Error("invalid_request");
          const environments = await vercel.environments(body.projectId);
          const ref = environments.envs.find(value => value.key === "NEXT_PUBLIC_SUPABASE_URL" && (!value.target || value.target.includes("production")))?.value?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
          if (!ref) throw new Error("project_mismatch");
          const target = await bindTarget(job, body.projectId, vercel, new SupabaseProvider(ref, job.supabase.access, fetcher), config.vercelClientId);
          if (target.origin === config.origin || `https://${ref}.supabase.co` === config.controlUrl) throw new Error("project_mismatch");
          const deployments = await vercel.deployments(target.projectId);
          if (!deployments.deployments[0]) throw new Error("production_domain_pending");
          const initial = await vercel.deployment(deployments.deployments[0].id);
          if (initial.readyState !== "READY") throw new Error("production_domain_pending");
          const revision = initial.gitSource?.sha ?? initial.meta?.githubCommitSha;
          if (!revision || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error("release_mismatch");
          const installed = await apiRequest<{ release: string }>(`${target.origin}/api/instance-release`, {}, fetcher);
          if (installed.release !== release.id) throw new Error("release_mismatch");
          target.revision = revision;
          // A failed unique binding must not persist an unbound target in the
          // error handler; keep the original job until the atomic save succeeds.
          job = await store.save({ ...job, target, phase: "validate" }, session.hash, lease, ref);
          return json(200, publicStatus(job));
        }
        if (!job.target) throw new Error("project_mismatch");
        const db = new SupabaseProvider(job.target.supabaseRef, job.supabase.access, fetcher);
        if (action === "advance") {
          if (job.retryAt && job.retryAt > Date.now()) { await store.save(job, session.hash, lease); return json(200, publicStatus(job)); }
          job = await advanceInstallation(job, release, { db, vercel, revision: config.releaseRef, installerOrigin: config.origin, fetcher });
        } else if (action === "owner") {
          const body = await readBody(request);
          const input = ownerInput(body.email, body.password);
          if (job.phase !== "owner" || (job.ownerEmail && job.ownerEmail !== input.email)) throw new Error("owner_conflict");
          job.ownerEmail = input.email;
          // Commit intent before Auth can create a user; retries must use this email.
          await store.save(job, session.hash, lease);
          ({ job, lease } = await store.acquire(session.id, session.hash));
          const keys = await db.keys();
          const adminKey = keys.find(key => key.type === "secret")?.api_key ?? keys.find(key => key.name === "service_role")?.api_key;
          if (!adminKey) throw new Error("provider_authorization");
          job = await finishOwner(job, input.email, input.password, adminKey, fetcher);
        }
      }
      job = await store.save(job, session.hash, lease);
      return json(200, publicStatus(job));
    } catch (error) {
      const code = errorCode(error);
      if (job && lease) {
        job.error = code;
        if (error instanceof ProviderError && error.retryAfter) job.retryAt = Date.now() + error.retryAfter * 1000;
        try { await store.save(job, session.hash, lease); } catch { /* an expired lease cannot overwrite newer state */ }
      }
      if (callback) return redirect(`${config.origin}/deploy?issue=${encodeURIComponent(code)}`);
      return json(code === "busy_or_expired" ? 409 : code === "session_expired" ? 401 : code === "invalid_request" || code === "invalid_owner_credentials" ? 400 : 503, { error: code });
    }
  };
}
