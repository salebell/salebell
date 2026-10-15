"use client";

import { useEffect, useState } from "react";
import { Alert, Button, ButtonLink, Field, Input } from "@/components/ui";

type Status = { phase: string; cursor: number; error: string | null; retryAt: number | null; reconnect: boolean; needsSupabase: boolean; siteHint: string | null; target: { projectName: string; supabaseName: string; origin: string } | null };
const running = new Set(["validate", "migrations", "settings", "functions", "auth", "verify"]);
const labels: Record<string, string> = { validate: "Checking your projects", migrations: "Installing the database", settings: "Configuring your instance", functions: "Installing the backend", auth: "Configuring sign-in", verify: "Checking the installation", owner: "Create your owner account", complete: "Your Salebell is ready" };
const messages: Record<string, string> = {
  project_not_empty: "Choose a new, empty Supabase project. This installer preserves existing installations and other applications.",
  invalid_deployment_url: "Enter the HTTPS production address of your deployed site, such as https://your-project.vercel.app.",
  project_mismatch: "These projects don't match the authorized connection. Check that the selected Vercel project is connected to your intended Supabase project.",
  provider_authorization: "Reconnect your provider accounts to restore installation access.",
  provider_reconnect_required: "Reconnect your provider accounts to continue setup.",
  oauth_state_invalid: "The account connection expired or was already used. Connect again to continue.",
  production_domain_pending: "Vercel is still creating the production address. Wait a moment and retry.",
  provider_rate_limited: "Your provider asked us to wait. Retry in a moment.",
  provider_plan_required: "Your provider requires a plan change before setup can continue. Review it in your provider dashboard.",
  owner_signin_failed: "Sign-in didn't succeed. Use the password you chose when this owner was created.",
  invalid_owner_credentials: "Enter a valid email and a password of 12–128 characters.",
  owner_conflict: "An owner already exists or the email differs from your earlier setup attempt. Use your original email and password.",
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
export function DeployForm({ initialIssue, initialSite }: { initialIssue: string | null; initialSite: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialIssue);
  const [site, setSite] = useState(initialSite ?? "");

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const current: Status = await request("status");
        if (stopped) return;
        setStatus(current);
        setSite(previous => previous || current.siteHint || "");
        if (running.has(current.phase) && !current.error && !current.needsSupabase && (!current.retryAt || current.retryAt <= Date.now())) {
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
  async function connect() {
    setBusy(true); setError(null);
    try {
      if (!status || status.phase === "canceled") await request("start", { site });
      const result = await request("connect-supabase", { site });
      window.location.assign(result.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "installation_failed"); }
    finally { setBusy(false); }
  }
  const problem = error ?? status?.error;
  if (loading) return <p className="mt-8 text-sm text-muted" role="status">Loading your setup…</p>;
  return <div className="mt-8 space-y-5">
    {problem && <Alert>{messages[problem] ?? "Setup couldn't complete this step. Retry, or reconnect your accounts to continue."}</Alert>}
    {(!status || status.phase === "canceled") && !initialSite ? <div className="rounded-xl border border-border bg-surface p-6">
      <h2 className="font-semibold">Connect your accounts</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-muted">Vercel creates your copy of Salebell and connects Supabase. Then we install the backend and help you create your login. No custom domain is required.</p>
      <Button loading={busy} onClick={() => act("start")}>Deploy Salebell</Button>
    </div> : <>
      {status?.target && <div className="rounded-xl border border-border bg-surface p-5 text-sm"><p><span className="text-muted">Dashboard:</span> {status.target.origin}</p><p className="mt-1"><span className="text-muted">Database:</span> {status.target.supabaseName}</p></div>}
      {status?.reconnect && <Button variant="secondary" loading={busy} onClick={() => act("connect-supabase", { site })}>Reconnect Supabase</Button>}
      {(!status || status.phase === "clone" || status.phase === "canceled" || status.needsSupabase) && <form className="space-y-4 rounded-xl border border-border bg-surface p-6" onSubmit={event => { event.preventDefault(); void connect(); }}>
        <h2 className="font-semibold">Finish your deployment</h2>
        <p className="text-sm leading-relaxed text-muted">After Vercel finishes, visit your new site and choose Finish setup. Its address is filled in here. Connect the Supabase organization containing that site&apos;s new database.</p>
        <Field label="Your deployed website" htmlFor="deploy-site"><Input id="deploy-site" type="url" placeholder="https://your-project.vercel.app" value={site} onChange={event => setSite(event.target.value)} required /></Field>
        <Button loading={busy} disabled={!site}>Connect Supabase</Button>
        {status?.phase === "clone" && <Button variant="ghost" type="button" loading={busy} onClick={() => act("start")}>Open Vercel deployment</Button>}
      </form>}
      {status?.phase === "connect_supabase" && !status.needsSupabase && <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
        <h2 className="font-semibold">Install your backend</h2>
        <p className="text-sm leading-relaxed text-muted">Install Salebell into the empty Supabase database connected to <strong className="break-all">{status.siteHint}</strong>. Setup configures sign-in and backend functions, then helps you create your owner account.</p>
        <Button loading={busy} onClick={() => act("select", { site: status.siteHint })}>Install Salebell</Button>
      </div>}
      {status && running.has(status.phase) && <div className="rounded-xl border border-border bg-surface p-6" aria-live="polite"><h2 className="font-semibold">{labels[status.phase]}</h2><p className="mt-2 text-sm text-muted">You can leave this page open. If you close it, return here to resume setup.</p>{problem && <Button className="mt-4" loading={busy} onClick={() => act("advance")}>Retry this step</Button>}</div>}
      {status?.phase === "owner" && <form className="space-y-4 rounded-xl border border-border bg-surface p-6" onSubmit={event => {
        event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
        void act("owner", { email: data.get("email"), password: data.get("password") }).finally(() => { const password = form.querySelector<HTMLInputElement>('input[name="password"]'); if (password) password.value = ""; });
      }}>
        <h2 className="font-semibold">Create your owner account</h2>
        <Field label="Email" htmlFor="deploy-email"><Input id="deploy-email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="deploy-password" hint="Use at least 12 characters. Keep this password in your password manager."><Input id="deploy-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></Field>
        <Button loading={busy}>Finish setup</Button>
      </form>}
      {status?.phase === "complete" && status.target && <div className="rounded-xl border border-border bg-surface p-6"><h2 className="font-semibold">Your Salebell is ready</h2><p className="mb-5 mt-2 text-sm text-muted">Sign in with the email and password you chose, then add your first app.</p><ButtonLink href={`${status.target.origin}/login`}>Open dashboard</ButtonLink></div>}
      {status && status.phase !== "complete" && <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("cancel")}>Cancel setup</Button>}
    </>}
  </div>;
}
