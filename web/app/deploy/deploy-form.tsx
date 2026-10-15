"use client";

import { useEffect, useState } from "react";
import { Alert, Button, ButtonLink, Field, Input } from "@/components/ui";

type Status = { phase: string; cursor: number; error: string | null; retryAt: number | null; reconnect: boolean; needsVercel: boolean; needsSupabase: boolean; projectHint: string | null; target: { projectName: string; supabaseName: string; origin: string } | null };
const running = new Set(["validate", "migrations", "settings", "functions", "auth", "deploy", "verify"]);
const labels: Record<string, string> = { validate: "Checking your projects", migrations: "Installing the database", settings: "Configuring your instance", functions: "Installing the backend", auth: "Configuring sign-in", deploy: "Deploying your dashboard", verify: "Checking the installation", owner: "Create your owner account", complete: "Your Salebell is ready" };
const messages: Record<string, string> = {
  project_not_empty: "Choose a new, empty Supabase project. This installer preserves existing installations and other applications.",
  project_mismatch: "These projects don't match the authorized connection. Check that the selected Vercel project is connected to your intended Supabase project.",
  provider_authorization: "Reconnect your provider accounts to restore installation access.",
  provider_reconnect_required: "Reconnect your provider accounts to continue setup.",
  vercel_reconnect_required: "Reconnect Vercel to authorize this installation. If necessary, reauthorize the Salebell integration in Vercel.",
  oauth_state_invalid: "The account connection expired or was already used. Connect again to continue.",
  production_domain_pending: "Vercel is still creating the production address. Wait a moment and retry.",
  provider_rate_limited: "Your provider asked us to wait. Retry in a moment.",
  provider_plan_required: "Your provider requires a plan change before setup can continue. Review it in your provider dashboard.",
  owner_signin_failed: "Sign-in didn't succeed. Use the password you chose when this owner was created.",
  invalid_owner_credentials: "Enter a valid email and a password of 12–128 characters.",
  owner_conflict: "An owner already exists or the email differs from your earlier setup attempt. Use your original email and password.",
  deployment_failed: "Vercel couldn't build the dashboard. Check the deployment's build log, then retry.",
  release_mismatch: "The deployed version doesn't match the installer release. Reconnect the matching Salebell deployment or contact the installer operator.",
  webhook_proxy_failed: "The notification address isn't reachable yet. Check that production access is public in Vercel, then retry.",
  session_required: "This setup session expired. Start again to connect your accounts.",
};
async function request(action: string, body?: Record<string, unknown>) {
  const response = await fetch(`/api/deploy/${action}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "installation_failed");
  return result;
}
export function DeployForm({ initialIssue }: { initialIssue: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialIssue);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const current: Status = await request("status");
        if (stopped) return;
        setStatus(current);
        if (running.has(current.phase) && !current.error && !current.needsVercel && !current.needsSupabase && (!current.retryAt || current.retryAt <= Date.now())) {
          try { const next: Status = await request("advance", {}); if (!stopped) setStatus(next); }
          catch (cause) { if (!stopped && cause instanceof Error && cause.message !== "busy_or_expired") setError(cause.message); }
        }
      } catch (cause) {
        if (!stopped && cause instanceof Error && cause.message !== "session_required") setError(cause.message);
      } finally {
        if (!stopped) { setLoading(false); timer = setTimeout(tick, 2500); }
      }
    }
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const phase = status?.phase;
  const needsVercel = status?.needsVercel;
  const needsSupabase = status?.needsSupabase;
  const projectHint = status?.projectHint;
  useEffect(() => {
    if (phase !== "connect_supabase" || needsVercel || needsSupabase) return;
    let stopped = false;
    request("projects").then(result => {
      if (stopped) return;
      setProjects(result.projects);
      setProjectId(projectHint ?? (result.projects.length === 1 ? result.projects[0].id : ""));
    }).catch(cause => { if (!stopped) setError(cause instanceof Error ? cause.message : "installation_failed"); });
    return () => { stopped = true; };
  }, [phase, needsVercel, needsSupabase, projectHint]);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true); setError(null);
    try {
      const result = await request(action, body);
      if (result.url) { window.location.assign(result.url); return; }
      if (result.phase) setStatus(result);
      else setStatus(await request("status"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "installation_failed"); }
    finally { setBusy(false); }
  }
  const problem = error ?? status?.error;
  if (loading) return <p className="mt-8 text-sm text-muted" role="status">Loading your setup…</p>;
  return <div className="mt-8 space-y-5">
    {problem && <Alert>{messages[problem] ?? "Setup couldn't complete this step. Retry, or reconnect your accounts to continue."}</Alert>}
    {!status || status.phase === "canceled" ? <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-semibold">Connect your accounts</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-muted">Vercel creates your copy of Salebell and connects Supabase. Then we install the backend and help you create your login. No custom domain is required.</p>
      <Button loading={busy} onClick={() => act("start")}>Deploy Salebell</Button>
    </div> : <>
      {status.target && <div className="rounded-xl border border-border bg-surface p-5 text-sm"><p><span className="text-muted">Dashboard:</span> {status.target.projectName}</p><p className="mt-1"><span className="text-muted">Database:</span> {status.target.supabaseName}</p></div>}
      {status.reconnect && <div className="flex flex-wrap gap-3"><Button variant="secondary" loading={busy} onClick={() => act("connect-vercel")}>Reconnect Vercel</Button><Button variant="secondary" loading={busy} onClick={() => act("connect-supabase")}>Reconnect Supabase</Button></div>}
      {status.needsVercel && <Button loading={busy} onClick={() => act("connect-vercel")}>Connect Vercel</Button>}
      {!status.needsVercel && status.needsSupabase && <div><p className="mb-4 text-sm text-muted">Authorize access to the Supabase organization containing your new database so Salebell can finish installing.</p><Button loading={busy} onClick={() => act("connect-supabase")}>Connect Supabase</Button></div>}
      {status.phase === "connect_supabase" && !status.needsVercel && !status.needsSupabase && <form onSubmit={event => { event.preventDefault(); void act("select", { projectId }); }} className="space-y-4">
        <Field label="Your Salebell project" htmlFor="deploy-project"><select id="deploy-project" required value={projectId} onChange={event => setProjectId(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-surface px-3"><option value="">Choose a project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
        <Button loading={busy} disabled={!projectId}>Install Salebell</Button>
      </form>}
      {running.has(status.phase) && <div className="rounded-xl border border-border bg-surface p-6" aria-live="polite"><h2 className="font-semibold">{labels[status.phase]}</h2><p className="mt-2 text-sm text-muted">You can leave this page open. If you close it, return here to resume setup.</p>{problem && <Button className="mt-4" loading={busy} onClick={() => act("advance")}>Retry this step</Button>}</div>}
      {status.phase === "owner" && <form className="space-y-4 rounded-xl border border-border bg-surface p-6" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act("owner", { email: data.get("email"), password: data.get("password") }).finally(() => { const password = form.querySelector<HTMLInputElement>('input[name="password"]'); if (password) password.value = ""; });
      }}>
        <h2 className="font-semibold">Create your owner account</h2>
        <Field label="Email" htmlFor="deploy-email"><Input id="deploy-email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="deploy-password" hint="Use at least 12 characters. Keep this password in your password manager."><Input id="deploy-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
        <Button loading={busy}>Finish setup</Button>
      </form>}
      {status.phase === "complete" && status.target && <div className="rounded-xl border border-border bg-surface p-6"><h2 className="font-semibold">Your Salebell is ready</h2><p className="mb-5 mt-2 text-sm text-muted">Sign in with the email and password you chose, then add your first app.</p><ButtonLink href={`${status.target.origin}/login`}>Open dashboard</ButtonLink></div>}
      {status.phase !== "complete" && <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("cancel")}>Cancel setup</Button>}
    </>}
  </div>;
}
