import type { InstallJob, Release, Target } from "./installer-types.ts";
import { SupabaseProvider, VercelProvider, apiRequest } from "./installer-providers.ts";
import { httpsOrigin } from "./installer-config.ts";
import { migrationSQL, reservationSQL, settingsSQL } from "./installer-sql.ts";

export async function bindTarget(job: InstallJob, projectId: string, vercel: VercelProvider, db: SupabaseProvider, integrationId: string): Promise<Target> {
  if (!job.vercel || !/^[a-zA-Z0-9_-]{3,100}$/.test(projectId)) throw new Error("project_mismatch");
  await vercel.verifyConfiguration(job.vercel.configurationId, integrationId, projectId);
  const [project, env, domains, database, keys] = await Promise.all([vercel.project(projectId), vercel.environments(projectId), vercel.domains(projectId), db.metadata(), db.keys()]);
  if (project.id !== projectId || database.id !== db.ref || project.link?.type !== "github") throw new Error("project_mismatch");
  const production = env.envs.filter(value => !value.target || value.target.includes("production"));
  const url = production.find(value => value.key === "NEXT_PUBLIC_SUPABASE_URL")?.value;
  const publicKey = production.find(value => value.key === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")?.value;
  if (url !== `https://${db.ref}.supabase.co` || !publicKey || !keys.some(key => (key.type === "publishable" || key.name === "anon") && key.api_key === publicKey)) throw new Error("project_mismatch");
  const domain = domains.domains.find(value => !value.redirect && /^[a-z0-9-]+\.vercel\.app$/i.test(value.name));
  if (!domain) throw new Error("production_domain_pending");
  return { projectId, projectName: project.name, supabaseRef: db.ref, supabaseName: database.name, origin: httpsOrigin(`https://${domain.name}`), publicKey, configurationId: job.vercel.configurationId, teamId: job.vercel.teamId };
}
export type RunnerDeps = { db: SupabaseProvider; vercel: VercelProvider; revision: string; installerOrigin?: string; fetcher?: typeof fetch };
export async function advanceInstallation(job: InstallJob, release: Release, deps: RunnerDeps): Promise<InstallJob> {
  if (!job.target || !job.vercel || !job.supabase || deps.db.ref !== job.target.supabaseRef) throw new Error("provider_reconnect_required");
  if (job.phase === "verify" && job.error === "deployment_failed") return { ...job, phase: "deploy", deploymentId: undefined, error: undefined, retryAt: undefined };
  const next: InstallJob = { ...job, error: undefined, retryAt: undefined };
  const { db, vercel } = deps;
  const target = job.target;
  const revision = target.revision ?? deps.revision;
  switch (job.phase) {
    case "validate": {
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
      next.phase = "deploy"; break;
    case "deploy": {
      const project = await vercel.project(target.projectId);
      await vercel.configure(target.projectId, { NEXT_PUBLIC_SUPABASE_URL: `https://${target.supabaseRef}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: target.publicKey, NEXT_PUBLIC_SITE_URL: target.origin, NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", SALEBELL_BROWSER_INSTALL: "true", ...(deps.installerOrigin ? { SALEBELL_INSTALLER_ORIGIN: deps.installerOrigin } : {}) });
      const previous = (await vercel.deployments(target.projectId)).deployments.find(value => value.meta?.salebellInstaller === job.id && value.meta?.salebellRelease === revision && !["ERROR", "CANCELED"].includes(value.readyState));
      const deployment = previous ?? await vercel.deploy(project, revision, job.id);
      next.deploymentId = deployment.id; next.phase = "verify"; break;
    }
    case "verify": {
      if (!job.deploymentId) throw new Error("deployment_missing");
      const deployment = await vercel.deployment(job.deploymentId);
      if (["ERROR", "CANCELED"].includes(deployment.readyState)) throw new Error("deployment_failed");
      if (deployment.readyState !== "READY") { next.retryAt = Date.now() + 5000; break; }
      if (deployment.meta?.salebellInstaller !== job.id || deployment.meta?.salebellRelease !== revision || (deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha) !== revision) throw new Error("release_mismatch");
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
