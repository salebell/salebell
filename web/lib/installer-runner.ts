import type { InstallJob, Release, Target } from "./installer-types.ts";
import { SupabaseProvider, apiRequest } from "./installer-providers.ts";
import { deploymentOrigin, type InstallerConfig } from "./installer-config.ts";
import { migrationSQL, reservationSQL, settingsSQL } from "./installer-sql.ts";

type DeploymentInfo = { release: string; mode: string; setup: boolean; origin: string; installerOrigin: string; supabaseUrl: string; publicKey: string };
export async function readDeployment(site: string, release: Release, installerOrigin: string, fetcher: typeof fetch = fetch): Promise<DeploymentInfo> {
  const origin = deploymentOrigin(site);
  if (origin === installerOrigin) throw new Error("project_mismatch");
  const info = await apiRequest<DeploymentInfo>(`${origin}/api/instance-release`, {}, fetcher);
  if (info.release !== release.id) throw new Error("release_mismatch");
  if (info.origin !== origin || info.installerOrigin !== installerOrigin || info.setup !== true || info.mode !== "self_hosted"
    || typeof info.supabaseUrl !== "string" || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(info.supabaseUrl)
    || typeof info.publicKey !== "string" || !info.publicKey) throw new Error("project_mismatch");
  return info;
}
export async function bindTarget(site: string, token: string, release: Release, config: Pick<InstallerConfig, "origin" | "controlUrl">, fetcher: typeof fetch = fetch): Promise<Target> {
  const info = await readDeployment(site, release, config.origin, fetcher);
  if (info.supabaseUrl === config.controlUrl) throw new Error("project_mismatch");
  const ref = new URL(info.supabaseUrl).hostname.split(".")[0];
  const db = new SupabaseProvider(ref, token, fetcher);
  const [database, keys] = await Promise.all([db.metadata(), db.keys()]);
  if (database.id !== ref || !keys.some(key => (key.type === "publishable" || key.name === "anon") && key.api_key === info.publicKey)) throw new Error("project_mismatch");
  return { projectName: new URL(info.origin).hostname.split(".")[0], supabaseRef: ref, supabaseName: database.name, origin: info.origin, publicKey: info.publicKey };
}
export async function verifyDeployment(target: Target, release: Release, installerOrigin: string, fetcher?: typeof fetch) {
  const info = await readDeployment(target.origin, release, installerOrigin, fetcher);
  if (info.supabaseUrl !== `https://${target.supabaseRef}.supabase.co` || info.publicKey !== target.publicKey) throw new Error("project_mismatch");
}
export type RunnerDeps = { db: SupabaseProvider; installerOrigin: string; fetcher?: typeof fetch };
export async function advanceInstallation(job: InstallJob, release: Release, deps: RunnerDeps): Promise<InstallJob> {
  if (!job.target || !job.supabase || deps.db.ref !== job.target.supabaseRef) throw new Error("provider_reconnect_required");
  const next: InstallJob = { ...job, error: undefined, retryAt: undefined };
  const { db } = deps;
  const target = job.target;
  switch (job.phase) {
    case "validate": {
      await verifyDeployment(target, release, deps.installerOrigin, deps.fetcher);
      const functions = await db.functions();
      if (functions.some(fn => !release.functions.some(asset => asset.slug === fn.slug))) throw new Error("project_not_empty");
      const reservation = await db.query("select to_regclass('private.browser_installation') as installed");
      if (!reservation[0]?.installed && functions.length) throw new Error("project_not_empty");
      // Check without mutating the target before closing signup. The reservation
      // repeats this under a transaction lock after signup is disabled.
      if (!reservation[0]?.installed) {
        const existing = await db.query("select exists(select 1 from auth.users) or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p','v','m') and not exists(select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')) as occupied", true);
        if (existing[0]?.occupied !== false) throw new Error("project_not_empty");
      }
      await db.updateAuth(target.origin);
      await db.query(reservationSQL(job.id, release.id));
      next.phase = "migrations"; next.cursor = 0; break;
    }
    case "migrations": {
      const asset = release.migrations[job.cursor];
      if (!asset) { next.phase = "settings"; next.cursor = 0; break; }
      const markers = await db.query("select filename, sha256 from private.browser_migrations", true);
      const marker = markers.find(value => value.filename === asset.name);
      if (marker && marker.sha256 !== asset.sha256) throw new Error("migration_conflict");
      if (!marker) await db.query(migrationSQL(asset));
      next.cursor++; break;
    }
    case "settings":
      await db.query(settingsSQL(target.supabaseRef));
      next.phase = "functions"; next.cursor = 0; break;
    case "functions": {
      const asset = release.functions[job.cursor];
      if (!asset) { next.phase = "auth"; next.cursor = 0; break; }
      const result = await db.deployFunction(asset);
      if (result.slug !== asset.slug || result.status !== "ACTIVE") throw new Error("function_deployment_pending");
      next.cursor++; break;
    }
    case "auth":
      await db.updateAuth(target.origin);
      await db.setSiteUrl(target.origin);
      next.phase = "verify"; break;
    case "verify": {
      await verifyDeployment(target, release, deps.installerOrigin, deps.fetcher);
      const health = await apiRequest<{ release: string; mode: string; origin: string }>(`${target.origin}/api/instance-health`, {}, deps.fetcher);
      if (health.release !== release.id || health.mode !== "self_hosted" || health.origin !== target.origin) throw new Error("instance_not_ready");
      const response = await (deps.fetcher ?? fetch)(`${target.origin}/hooks/apple/notarealkey1/production`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      await response.body?.cancel();
      if (response.status !== 404) throw new Error("webhook_proxy_failed");
      next.phase = "owner"; break;
    }
    case "owner": case "complete": case "canceled": break;
    default: throw new Error("installation_not_bound");
  }
  return next;
}
