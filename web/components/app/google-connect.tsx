"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { CopyField } from "@/components/copy-button";
import { Alert, Button, ButtonLink, Card, Field, Input, Spinner } from "@/components/ui";
import type { AppRow } from "@/lib/database.types";
import { SUPABASE_URL } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { buildGoogleConfigureRequest, googleConnectionVerified, googleFunctionError, googleManualError, MAX_GOOGLE_CREDENTIAL_BYTES, parseGoogleCredentialFile, type GoogleConnectionStatus, type GoogleCredentials, type GoogleSetupMode } from "@/lib/google-connect";
import { useLiveEvents } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLoadedWorkspace } from "./workspace";
import { GoogleKeyUpload } from "./google-key-upload";
import { ConnectionFlow } from "./connection-flow";

function GooglePrerequisites() {
  return <details className="rounded-xl border border-border bg-surface-2 p-4">
    <summary className="cursor-pointer text-sm font-medium">Prepare your Google service account</summary>
    <div className="mt-3 space-y-4 text-sm text-muted">
      <ol className="list-decimal space-y-2 pl-5">
        <li>In <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">Google Cloud ↗</a>, enable the <strong className="text-fg">Google Play Android Developer API</strong> and <strong className="text-fg">Cloud Pub/Sub API</strong> for your project.</li>
        <li>Create a service account and download its JSON key under <strong className="text-fg">IAM & Admin → Service Accounts → Keys → Add key → Create new key → JSON</strong>.</li>
        <li>In <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">Google Play Console ↗</a>, invite its email under <strong className="text-fg">Users and permissions</strong>. Grant access to this app with <strong className="text-fg">View financial data, orders, and cancellation survey responses</strong> and <strong className="text-fg">Manage orders and subscriptions</strong> for purchase lookups.</li>
      </ol>
      <div className="space-y-2 border-t border-border pt-3">
        <p className="font-medium text-fg">For automatic Pub/Sub setup</p>
        <p>Also enable the <strong className="text-fg">Identity and Access Management (IAM) API</strong> and <strong className="text-fg">Cloud Resource Manager API</strong>.</p>
        <p>The uploaded service account must belong to this project. Give it <strong className="text-fg">Pub/Sub Admin</strong> on the project and permission to read the project number (<code className="font-mono text-xs">resourcemanager.projects.get</code>).</p>
        <p>On this service account, grant it <strong className="text-fg">Service Account User</strong> and <strong className="text-fg">Service Account Admin</strong>. These allow authenticated push setup and adding the Pub/Sub service agent&apos;s token-creation permission.</p>
        <p>Automatic setup creates a topic and a wrapped, authenticated push subscription, grants Google Play permission to publish, and configures the push identity. You still save the topic in Play Console afterward.</p>
        <p>If a new project has no Pub/Sub service agent yet, an administrator can initialize it in Cloud Shell:</p><code className="block overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs">gcloud beta services identity create --service=pubsub.googleapis.com --project=YOUR_PROJECT_ID</code>
        <p>Prefer existing resources or narrower permissions? Use advanced manual setup below. If Play Console already publishes to a topic used by another backend, keep that topic and add a separate Salebell push subscription.</p>
      </div>
    </div>
  </details>;
}

export function GoogleConnect({ app, initialCredentials, onInitialCredentialsConsumed }: { app: AppRow; initialCredentials?: GoogleCredentials | null; onInitialCredentialsConsumed?: () => void }) {
  const { canManage, patchApp } = useLoadedWorkspace();
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [credentials, setCredentials] = useState<GoogleCredentials | null>(initialCredentials ?? null);
  const [fileName, setFileName] = useState(initialCredentials ? "Uploaded service-account JSON" : "");
  const [mode, setMode] = useState<GoogleSetupMode>("automatic");
  const [topic, setTopic] = useState("");
  const [subscription, setSubscription] = useState("");
  const [serviceAccountEmail, setServiceAccountEmail] = useState("");
  const [busy, setBusy] = useState<"file" | "configure" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(!!initialCredentials);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const statusRevision = useRef(0);
  const mutating = useRef(false);
  const appId = app.id;
  const connection = status?.connection ?? null;
  const verified = !!connection && (status?.verified === true || googleConnectionVerified(connection, app));
  const pushUrl = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/google-webhook/${app.webhook_key}`;
  const manualFields = { topic, subscription, serviceAccountEmail };
  const manualError = mode === "manual" ? googleManualError(manualFields) : null;

  useEffect(() => {
    // The importer drops its copy after this component takes ownership in state.
    if (initialCredentials) onInitialCredentialsConsumed?.();
  }, [initialCredentials, onInitialCredentialsConsumed]);

  const readStatus = useCallback(async (showError = false) => {
    if (!canManage || mutating.current) return;
    const revision = ++statusRevision.current;
    try {
      const [result, activity] = await Promise.all([
        supabaseBrowser().functions.invoke<GoogleConnectionStatus>("google-connect", { body: { action: "status", app_id: appId } }),
        supabaseBrowser().from("apps").select("last_event_production_at,last_event_sandbox_at").eq("id", appId).single(),
      ]);
      const statusError = showError && (result.error || !result.data) ? result.error ? await googleFunctionError(result.error) : "Couldn't load the Google connection. Try again." : null;
      if (revision !== statusRevision.current) return;
      if (!result.error && result.data) setStatus(result.data);
      else if (statusError) setError(statusError);
      if (activity.data) patchApp(appId, activity.data);
    } catch {
      if (showError && revision === statusRevision.current) setError("Couldn't load the Google connection. Check your connection and try again.");
    } finally {
      if (revision === statusRevision.current) setLoading(false);
    }
  }, [appId, canManage, patchApp]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch persisted connection and event activity on mount
    void readStatus(true);
    if (!canManage) return;
    const timer = setInterval(() => { void readStatus(); }, 15_000);
    return () => { clearInterval(timer); operation.current += 1; statusRevision.current += 1; };
  }, [canManage, readStatus]);

  useLiveEvents(appId, () => { void readStatus(); });

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const currentOperation = ++operation.current;
    setCredentials(null);
    setFileName("");
    setError(null);
    if (!file) return;
    setBusy("file");
    try {
      if (file.size > MAX_GOOGLE_CREDENTIAL_BYTES) throw new Error("Choose a service-account JSON file under 32 KB.");
      const parsed = parseGoogleCredentialFile(file.name, await file.text());
      if (operation.current !== currentOperation) return;
      setCredentials(parsed);
      setFileName(file.name);
    } catch (error) {
      if (operation.current === currentOperation) setError(error instanceof Error ? error.message : "Couldn't read that service-account key.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      if (operation.current === currentOperation) setBusy(null);
    }
  }

  async function configure(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !credentials || busy || manualError) return;
    const currentOperation = ++operation.current;
    mutating.current = true;
    statusRevision.current += 1;
    setBusy("configure");
    setError(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<GoogleConnectionStatus>("google-connect", { body: buildGoogleConfigureRequest(app.id, credentials, mode, manualFields) });
      if (operation.current !== currentOperation) return;
      if (error || !data?.connection) {
        setError(error ? await googleFunctionError(error) : "Google setup couldn't be confirmed. Try again to check the saved connection.");
        return;
      }
      setStatus(data);
      setCredentials(null);
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
      setEditing(false);
    } catch {
      if (operation.current === currentOperation) setError("Google setup couldn't be confirmed. Try again to check the saved connection.");
    } finally {
      mutating.current = false;
      statusRevision.current += 1;
      if (operation.current === currentOperation) { setBusy(null); void readStatus(); }
    }
  }

  async function disconnect() {
    if (!canManage || busy) return;
    mutating.current = true;
    statusRevision.current += 1;
    setBusy("delete");
    setError(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<{ deleted: boolean }>("google-connect", { body: { action: "delete", app_id: app.id } });
      if (error || !data?.deleted) return setError(error ? await googleFunctionError(error) : "Couldn't disconnect Google. Try again.");
      setStatus({ connection: null, verified: false });
      setCredentials(null);
      setFileName("");
      setConfirmDelete(false);
      setEditing(false);
      patchApp(app.id, { last_event_production_at: null, last_event_sandbox_at: null });
    } catch { setError("Couldn't disconnect Google. Check your connection and try again."); }
    finally { mutating.current = false; statusRevision.current += 1; setBusy(null); void readStatus(); }
  }

  if (!canManage) return <Alert tone="neutral">Ask your workspace owner or an admin to connect Google Play or update its service-account key.</Alert>;
  if (loading) return <div className="max-w-3xl space-y-5"><ConnectionFlow platform="google" current={2} /><div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading Google connection…</div></div>;

  return <div className="max-w-3xl space-y-5">
    <ConnectionFlow platform="google" current={verified && !editing ? 3 : 2} />
    <div><h2 className="text-lg font-semibold tracking-tight">Connect Google Play</h2><p className="mt-1 break-all text-sm text-muted">{app.name} · <span className="font-mono text-xs">{app.package_name}</span></p></div>
    {!app.enabled ? <Alert tone="warn">This saved app is disabled. You can review its connection now; enable it in Settings before sending a test notification.</Alert> : null}
    {connection ? <>
      <Card className={`p-5 ${verified ? "border-accent/50 bg-accent-soft/30" : ""}`}>
        <div role="status" aria-live="polite"><p className="font-semibold">{verified ? "✓ Google notification received" : "Pub/Sub saved · waiting for Google Play"}</p><p className="mt-1 text-sm text-muted">{verified ? "Salebell received a Google event after this connection was configured. Real purchase notifications also require the service account's Play Console access." : "Complete the Play Console steps below and send a test notification. Saving Pub/Sub settings alone doesn't verify delivery."}</p></div>
        <p className="mt-3 text-xs text-muted">Connection saved {dateTime(connection.updated_at)}. <button type="button" className="text-accent-text underline underline-offset-2" onClick={() => { void readStatus(true); }}>Check again</button></p>
      </Card>
      <Card className="space-y-4 p-4 sm:p-5">
        <h3 className="font-semibold">Finish in Play Console</h3>
        {connection.topic ? <CopyField label="Pub/Sub topic for Play Console" id="google-topic-saved" value={connection.topic} /> : <Alert tone="neutral">Use the topic attached to the saved subscription in Google Cloud.</Alert>}
        <Alert tone="neutral">Already using RTDN with another backend? Keep its topic and use advanced manual setup to add a separate Salebell subscription on that topic before changing Play Console.</Alert>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Open this app in <a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">Google Play Console ↗</a>, then <strong className="text-fg">Monetize → Monetization setup → Real-time developer notifications</strong>.</li>
          <li>Enable notifications, paste the full topic name above, choose <strong className="text-fg">subscriptions and one-time products</strong>, and save.</li>
          <li>Select <strong className="text-fg">Send test notification</strong>. Keep this page open while Salebell checks for receipt.</li>
        </ol>
        <p className="text-xs text-muted">If a notification doesn&apos;t arrive, check the topic publisher permission, authenticated wrapped push, and your service account&apos;s Play Console access. A Play Console test checks delivery; it does not test purchase lookup permissions.</p>
        <div className="flex flex-wrap gap-3"><ButtonLink href={`/app/apps/${app.id}`}>Go to dashboard</ButtonLink><ButtonLink href={`/app/apps/${app.id}/integrations`} variant="secondary">Set up alerts</ButtonLink></div>
      </Card>
      <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-medium">Pub/Sub connection details</summary><div className="mt-4 space-y-4"><CopyField label="Subscription" id="google-subscription-saved" value={connection.subscription} /><CopyField label="Push endpoint and OIDC audience" id="google-audience-saved" value={connection.audience} /><CopyField label="Push authentication service account" id="google-email-saved" value={connection.service_account_email} /><p className="text-xs text-muted">Keep Pub/Sub message wrapping enabled. Use a separate subscription on the same topic for another server.</p></div></details>
      {!editing ? <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => setEditing(true)}>Update service account or Pub/Sub setup</Button> : null}
    </> : null}
    {!connection || editing ? <form onSubmit={configure} className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="font-semibold">{connection ? "Update Google connection" : "Upload your service-account key"}</h3>
      <GooglePrerequisites />
      <Field label="Service-account JSON" htmlFor="google-service-key" hint="Your key is stored encrypted for this app. It stays in browser memory only while you finish setup.">
        <GoogleKeyUpload ref={fileInput} id="google-service-key" fileName={fileName} reading={busy === "file"} disabled={busy !== null} onChange={chooseFile} aria-describedby="google-service-key-hint" />
      </Field>
      {credentials ? <div className="space-y-1 text-xs text-muted"><p className="break-all">Project: <span className="font-mono">{credentials.project_id}</span></p><p className="break-all font-mono">{credentials.client_email}</p></div> : null}
      <details open={mode === "manual"} className="rounded-lg border border-border p-4" onToggle={(event) => { if (!event.currentTarget.open && mode === "manual") setMode("automatic"); }}>
        <summary className="cursor-pointer text-sm font-medium" onClick={(event) => { event.preventDefault(); setMode(mode === "manual" ? "automatic" : "manual"); }}>Advanced: use existing Pub/Sub resources</summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">Create or configure the topic and subscription in Google Cloud first. Manual setup saves these details without changing Google Cloud resources.</p>
          <CopyField label="Push endpoint and OIDC audience" id="google-manual-audience" value={pushUrl} />
          <ol className="list-decimal space-y-2 pl-5 text-xs text-muted"><li>Give <code className="break-all font-mono">google-play-developer-notifications@system.gserviceaccount.com</code> the Pub/Sub Publisher role on your topic.</li><li>Create a push subscription on that topic using the endpoint above. Enable authentication, choose the push service account, and set the exact OIDC audience above. Keep message wrapping enabled.</li><li>Give the Pub/Sub service agent Service Account Token Creator on the push service account. The subscription creator needs permission to act as that account.</li></ol>
          <Field label="Full topic name" htmlFor="google-topic"><Input id="google-topic" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="projects/example-project/topics/play-events" className="font-mono" disabled={busy !== null} autoCapitalize="none" spellCheck={false} /></Field>
          <Field label="Full subscription name" htmlFor="google-subscription"><Input id="google-subscription" value={subscription} onChange={(event) => setSubscription(event.target.value)} placeholder="projects/example-project/subscriptions/play-events-push" className="font-mono" disabled={busy !== null} autoCapitalize="none" spellCheck={false} /></Field>
          <Field label="Push service-account email (optional)" htmlFor="google-push-email" hint="Leave blank to use the uploaded service account for authenticated push."><Input id="google-push-email" value={serviceAccountEmail} onChange={(event) => setServiceAccountEmail(event.target.value)} placeholder="notifications@example-project.iam.gserviceaccount.com" className="font-mono" disabled={busy !== null} autoCapitalize="none" spellCheck={false} /></Field>
          {manualError && (topic || subscription || serviceAccountEmail) ? <p role="status" className="text-xs text-muted">{manualError}</p> : null}
        </div>
      </details>
      <div className="flex flex-wrap gap-3"><Button type="submit" loading={busy === "configure"} disabled={!credentials || busy !== null || !!manualError}>{mode === "automatic" ? "Create Pub/Sub connection" : "Save existing Pub/Sub connection"}</Button>{connection ? <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => { setEditing(false); setCredentials(null); setFileName(""); }}>Cancel</Button> : null}</div>
    </form> : null}
    {error ? <Alert>{error}</Alert> : null}
    {connection ? <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm text-muted">Disconnect Google Play</summary><p className="mt-3 text-sm text-muted">Removes the saved credentials and receiver settings from Salebell. Google Cloud resources remain. Delete Salebell&apos;s unused push subscription in Google Cloud when you finish. Keep the topic in Play Console and any subscriptions used by another backend.</p><div className="mt-3 flex flex-wrap gap-2">{confirmDelete ? <><Button type="button" variant="danger" loading={busy === "delete"} disabled={busy !== null} onClick={disconnect}>Yes, disconnect Google</Button><Button type="button" variant="ghost" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>Cancel</Button></> : <Button type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>Disconnect</Button>}</div></details> : null}
  </div>;
}
