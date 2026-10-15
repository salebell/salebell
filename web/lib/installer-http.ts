import { randomUUID } from "node:crypto";
import type { InstallerConfig } from "./installer-config.ts";
import { deployUrl, deploymentOrigin } from "./installer-config.ts";
import { consumeState, digest, equalSecret, newState, randomToken } from "./installer-security.ts";
import { InstallerStore } from "./installer-store.ts";
import { ProviderError, SupabaseProvider, exchangeSupabase, refreshSupabase } from "./installer-providers.ts";
import { advanceInstallation, bindTarget, verifyDeployment } from "./installer-runner.ts";
import { finishOwner, ownerInput } from "./installer-owner.ts";
import type { InstallJob, Release } from "./installer-types.ts";

const COOKIE = "__Host-salebell-installer";
const knownErrors = new Set(["oauth_state_invalid", "session_expired", "busy_or_expired", "project_mismatch", "project_not_empty", "project_in_use", "installation_conflict", "migration_conflict", "production_domain_pending", "provider_reconnect_required", "provider_authorization", "provider_rate_limited", "provider_plan_required", "provider_request_failed", "provider_invalid_response", "provider_unavailable", "function_deployment_pending", "instance_not_ready", "release_mismatch", "webhook_proxy_failed", "owner_conflict", "invalid_owner_credentials", "owner_signin_failed", "owner_workspace_missing", "protected_function_check_failed", "invalid_request", "invalid_deployment_url"]);
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
    reconnect: job.error === "provider_authorization" || job.error === "provider_reconnect_required",
    needsSupabase: !job.supabase && !["clone", "complete", "canceled"].includes(job.phase),
    siteHint: job.siteHint ?? null,
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
    const callback = action === "supabase-callback";
    const get = ["status", "supabase-callback", "cleanup"].includes(action);
    const post = ["start", "connect-supabase", "select", "advance", "owner", "cancel"].includes(action);
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
          if (existing && !["complete", "canceled"].includes(existing.phase)) return json(200, { ...publicStatus(existing), resume: true, ...(existing.phase === "clone" ? { url: deployUrl(config) } : {}) });
        }
        const ip = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown";
        if (await store.rate(`start:${digest(config.encryptionKey + ip)}`, 5, 600) || await store.rate("start:global", 100, 3600)) return json(429, { error: "rate_limited" });
        const body = await readBody(request);
        const siteHint = typeof body.site === "string" && body.site ? deploymentOrigin(body.site) : undefined;
        if (siteHint === config.origin) throw new Error("project_mismatch");
        const token = randomToken(); const now = Date.now();
        const job: InstallJob = { id: randomUUID(), version: 0, phase: siteHint ? "connect_supabase" : "clone", cursor: 0, createdAt: now, expiresAt: now + 7 * 86400000, siteHint };
        await store.create(job, digest(token));
        return json(200, siteHint ? publicStatus(job) : { url: deployUrl(config) }, { "set-cookie": `${COOKIE}=${job.id}.${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
      } catch (error) { return json(503, { error: errorCode(error) }); }
    }
    if (!session) return json(401, { error: "session_required" });
    let job: InstallJob | undefined; let lease: string | undefined;
    try {
      if (get && !callback) {
        job = await store.read(session.id, session.hash);
        if (action === "status") return json(200, publicStatus(job));
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
        const verifier = job.pending?.verifier;
        job.pending = consumeState(job.pending, url.searchParams.get("state") ?? "", "supabase");
        await store.save(job, session.hash, lease);
        ({ job, lease } = await store.acquire(session.id, session.hash));
        const code = url.searchParams.get("code");
        if (!code || code.length > 4096 || !verifier) throw new Error("oauth_state_invalid");
        job.supabase = await exchangeSupabase(config, code, verifier, fetcher);
        job.error = undefined;
        await store.save(job, session.hash, lease, undefined, true);
        return redirect(`${config.origin}/deploy`);
      }
      if (action === "connect-supabase") {
        const body = await readBody(request);
        const site = job.target?.origin ?? (typeof body.site === "string" && body.site ? body.site : job.siteHint);
        if (!site) throw new Error("invalid_deployment_url");
        const origin = deploymentOrigin(site);
        if (origin === config.origin || (job.target && origin !== job.target.origin)) throw new Error("project_mismatch");
        const state = newState("supabase");
        job.pending = state.pending;
        const verifier = randomToken(); job.pending.verifier = verifier;
        job.siteHint = origin;
        if (!job.target) job.phase = "connect_supabase";
        const destination = new URL("https://api.supabase.com/v1/oauth/authorize");
        for (const [key, value] of Object.entries({ client_id: config.supabaseClientId, redirect_uri: `${config.origin}/api/deploy/supabase-callback`, response_type: "code", state: state.value, code_challenge_method: "S256", code_challenge: Buffer.from(digest(verifier), "hex").toString("base64url") })) destination.searchParams.set(key, value);
        job.error = undefined;
        await store.save(job, session.hash, lease, undefined, !job.supabase);
        return json(200, { url: destination.href });
      }
      if (action === "cancel") {
        job.phase = "canceled"; job.pending = undefined; job.supabase = undefined;
      } else {
        if (!job.supabase) throw new Error("provider_reconnect_required");
        if (job.supabase.expires && job.supabase.expires < Date.now() + 60000) {
          if (!job.supabase.refresh) throw new Error("provider_reconnect_required");
          job.supabase = await refreshSupabase(config, job.supabase.refresh, fetcher);
        }
        if (action === "select") {
          if (job.target || job.phase !== "connect_supabase") throw new Error("project_mismatch");
          const body = await readBody(request);
          if (typeof body.site !== "string") throw new Error("invalid_request");
          const origin = deploymentOrigin(body.site);
          if (origin !== job.siteHint) throw new Error("project_mismatch");
          const target = await bindTarget(origin, job.supabase.access, release, config, fetcher);
          // A failed unique binding must not persist an unbound target in the
          // error handler; keep the original job until the atomic save succeeds.
          job = await store.save({ ...job, target, phase: "validate", error: undefined, retryAt: undefined }, session.hash, lease, target.supabaseRef);
          return json(200, publicStatus(job));
        }
        if (!job.target) throw new Error("project_mismatch");
        const db = new SupabaseProvider(job.target.supabaseRef, job.supabase.access, fetcher);
        if (action === "advance") {
          if (job.retryAt && job.retryAt > Date.now()) { await store.save(job, session.hash, lease); return json(200, publicStatus(job)); }
          job = await advanceInstallation(job, release, { db, installerOrigin: config.origin, fetcher });
        } else if (action === "owner") {
          const body = await readBody(request);
          const input = ownerInput(body.email, body.password);
          if (job.phase !== "owner" || (job.ownerEmail && job.ownerEmail !== input.email)) throw new Error("owner_conflict");
          job.ownerEmail = input.email;
          // Commit intent before Auth can create a user; retries must use this email.
          await store.save(job, session.hash, lease);
          ({ job, lease } = await store.acquire(session.id, session.hash));
          await verifyDeployment(job.target!, release, config.origin, fetcher);
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
      return json(code === "busy_or_expired" ? 409 : code === "session_expired" ? 401 : code === "invalid_request" || code === "invalid_owner_credentials" || code === "invalid_deployment_url" ? 400 : 503, { error: code });
    }
  };
}
