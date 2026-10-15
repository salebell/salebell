"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, Button, Field, Input, Spinner } from "@/components/ui";
import { newAppPayload } from "@/lib/app-form";
import type { AppRow } from "@/lib/database.types";
import { friendlyError, planLimitOf } from "@/lib/errors";
import { googleFunctionError, MAX_GOOGLE_CREDENTIAL_BYTES, parseGoogleCredentialFile, type GoogleCredentials } from "@/lib/google-connect";
import { buildGoogleDiscoverRequest, findSavedGoogleApp, googleImportedAppName, loadSavedGoogleApp, parseGoogleDiscoveryPage, type GoogleDiscoveredApp } from "@/lib/google-import";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GoogleConnect } from "./google-connect";
import { GoogleKeyUpload } from "./google-key-upload";
import { ConnectionFlow } from "./connection-flow";
import { StoreIcon } from "./platform-cards";
import { UpgradeCallout } from "./upgrade";
import { useLoadedWorkspace } from "./workspace";

export function GoogleImport({ onCancel }: { onCancel: () => void }) {
  const { ws, refresh, canManage } = useLoadedWorkspace();
  const [credentials, setCredentials] = useState<GoogleCredentials | null>(null);
  const [fileName, setFileName] = useState("");
  const [apps, setApps] = useState<GoogleDiscoveredApp[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [importedApp, setImportedApp] = useState<AppRow | null>(null);
  const [busy, setBusy] = useState<"file" | "discover" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const clearImportedCredentials = useCallback(() => { setCredentials(null); setFileName(""); }, []);
  const selected = apps?.find((app) => app.package_name === selectedPackage) ?? null;
  const existing = selected ? findSavedGoogleApp(ws.apps, ws.account.id, selected.package_name) : null;
  const visible = apps?.filter((app) => `${app.display_name} ${app.package_name}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => () => { operation.current += 1; }, []);

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const currentOperation = ++operation.current;
    setCredentials(null);
    setFileName("");
    setApps(null);
    setCursor(null);
    setQuery("");
    setSelectedPackage(null);
    setName("");
    setError(null);
    setLimitHit(false);
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

  async function discover(nextCursor?: string) {
    if (!canManage || !credentials || busy) return;
    const currentOperation = ++operation.current;
    setBusy("discover");
    setError(null);
    setLimitHit(false);
    try {
      const result = await supabaseBrowser().functions.invoke<unknown>("google-connect", { body: buildGoogleDiscoverRequest(ws.account.id, credentials, nextCursor) });
      const message = result.error ? await googleFunctionError(result.error, "discover") : null;
      if (operation.current !== currentOperation) return;
      if (message) return setError(message);
      const page = parseGoogleDiscoveryPage(result.data);
      setApps((current) => Array.from(new Map([...(nextCursor ? current ?? [] : []), ...page.apps].map((app) => [app.package_name, app])).values()));
      setCursor(page.next_cursor);
      if (!nextCursor) { setSelectedPackage(null); setName(""); }
    } catch {
      if (operation.current === currentOperation) setError("Couldn't read Google's app list. Try again, or enter the package name manually.");
    } finally {
      if (operation.current === currentOperation) setBusy(null);
    }
  }

  function chooseApp(app: GoogleDiscoveredApp) {
    setSelectedPackage(app.package_name);
    const saved = findSavedGoogleApp(ws.apps, ws.account.id, app.package_name);
    setName(saved?.name ?? googleImportedAppName(app));
    setError(null);
    setLimitHit(false);
  }

  async function continueWithApp(event: FormEvent) {
    event.preventDefault();
    if (!canManage || !credentials || !selected || !name.trim() || busy) return;
    const currentOperation = ++operation.current;
    setBusy("save");
    setError(null);
    setLimitHit(false);
    try {
      const client = supabaseBrowser();
      const lookup = await loadSavedGoogleApp(client, ws.account.id, selected.package_name);
      if (operation.current !== currentOperation) return;
      if (lookup.error) throw new Error(friendlyError(lookup.error, "Couldn't check your saved apps."));
      let local = lookup.data;
      if (!local) {
        const result = await client.from("apps").insert(newAppPayload(ws.account.id, "play_store", name, selected.package_name)).select("*").single();
        if (operation.current !== currentOperation) return;
        if (result.error?.code === "23505") {
          const raced = await loadSavedGoogleApp(client, ws.account.id, selected.package_name);
          if (operation.current !== currentOperation) return;
          if (raced.error || !raced.data) throw new Error("Couldn't save this app. Refresh your saved apps and try again.");
          local = raced.data;
        } else if (result.error || !result.data) {
          if (planLimitOf(result.error) === "apps") { setLimitHit(true); return; }
          throw new Error(friendlyError(result.error, "Couldn't add this app."));
        } else local = result.data;
      }
      setImportedApp(local);
      await refresh();
    } catch (error) {
      if (operation.current === currentOperation) setError(error instanceof Error ? error.message : "Couldn't continue setup. Try again.");
    } finally {
      if (operation.current === currentOperation) setBusy(null);
    }
  }

  if (!canManage) return <Alert tone="neutral">Ask your workspace owner or an admin to import and connect an Android app.</Alert>;
  if (importedApp) {
    const currentApp = ws.apps.find((app) => app.id === importedApp.id) ?? importedApp;
    return <GoogleConnect key={currentApp.id} app={currentApp} initialCredentials={credentials} onInitialCredentialsConsumed={clearImportedCredentials} />;
  }

  return <div className="space-y-5">
    <ConnectionFlow platform="google" current={apps === null ? 0 : 1} />
    <div><h2 className="text-lg font-semibold tracking-tight">Import your Android app</h2><p className="mt-1 text-sm text-muted">Upload a Google service-account JSON, then choose an app it can access. Nothing is added until you continue.</p></div>
    <div className="space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <Field label="Service-account JSON" htmlFor="google-import-key" hint="The key stays in memory during import and is stored encrypted only when you save the app's connection."><GoogleKeyUpload ref={fileInput} id="google-import-key" fileName={fileName} reading={busy === "file"} disabled={busy !== null} onChange={chooseFile} aria-describedby="google-import-key-hint" /></Field>
      {credentials ? <p className="break-all font-mono text-xs text-muted">{credentials.client_email}</p> : null}
      <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm text-muted">Prepare Google app access</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted"><li>Enable <strong className="text-fg">Google Play Developer Reporting API</strong> (<code className="break-all font-mono text-xs">playdeveloperreporting.googleapis.com</code>) in the JSON key&apos;s project in <a href="https://console.cloud.google.com/apis/library/playdeveloperreporting.googleapis.com" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">Google Cloud ↗</a>.</li><li>Invite the service-account email under <strong className="text-fg">Play Console → Users and permissions</strong>. Grant app-information access for the Android apps you want to import.</li><li>Download its JSON key from <strong className="text-fg">Google Cloud → IAM & Admin → Service Accounts → Keys</strong>. Later, Pub/Sub setup and purchase lookups need the additional permissions shown in the next step.</li></ol><p className="mt-3 text-xs text-muted">App discovery uses Google&apos;s Reporting API. If it isn&apos;t available for your account, enter your package name manually.</p></details>
      <Button type="button" loading={busy === "discover"} disabled={!credentials || busy !== null} onClick={() => { void discover(); }}>{apps === null ? "Load my Android apps" : "Refresh Android apps"}</Button>
    </div>
    {apps !== null ? <section className="space-y-3" aria-label="Choose your Android app">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Choose your app</h3><p className="text-xs text-muted">{apps.length} {apps.length === 1 ? "app" : "apps"} loaded{cursor ? " · more available" : ""}</p></div>
      {apps.length > 0 ? <Input aria-label="Search loaded Android apps" placeholder="Search loaded apps" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
      {visible?.length ? <div className="grid max-h-[min(28rem,55dvh)] gap-2 overflow-y-auto p-1 sm:grid-cols-2">{visible.map((app) => {
        const saved = findSavedGoogleApp(ws.apps, ws.account.id, app.package_name);
        return <button key={app.package_name} type="button" aria-pressed={selectedPackage === app.package_name} disabled={busy !== null} onClick={() => chooseApp(app)} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${selectedPackage === app.package_name ? "border-accent bg-accent-soft/40" : "border-border bg-surface hover:border-accent hover:bg-accent-soft/30"}`}><span className="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-surface-2"><StoreIcon store="google" className="size-5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{app.display_name}</span><span className="mt-1 block truncate font-mono text-xs text-muted">{app.package_name}</span>{saved ? <span className="mt-1 block text-xs text-muted">{saved.enabled ? "Already added" : "Already added · disabled"}</span> : null}</span><span className="text-muted" aria-hidden="true">{selectedPackage === app.package_name ? "✓" : "→"}</span></button>;
      })}</div> : <Alert tone="neutral">{query ? "No loaded apps match that search." : "No apps are visible to this service account. Check Play Console app access or enter the package name manually."}</Alert>}
      {cursor ? <Button type="button" variant="secondary" size="sm" loading={busy === "discover"} disabled={busy !== null} onClick={() => { void discover(cursor); }}>Load more apps</Button> : null}
      {selected ? <form onSubmit={continueWithApp} className="space-y-4 rounded-xl border border-border bg-surface p-4"><Field label="App name" htmlFor="google-import-name" hint={existing ? "This app is already in your workspace. Continue to review its connection." : "Shown in alerts and on your dashboard."}><Input id="google-import-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required disabled={busy !== null || !!existing} /></Field><p className="break-all font-mono text-xs text-muted">{selected.package_name}</p><Button type="submit" loading={busy === "save"} disabled={busy !== null || !name.trim()}>{existing ? "Continue setup" : "Add app and continue"}</Button></form> : null}
    </section> : busy === "discover" ? <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading your Android apps…</div> : null}
    {error ? <Alert>{error}</Alert> : null}
    {limitHit ? <UpgradeCallout reason="apps" /> : null}
    <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { operation.current += 1; setCredentials(null); onCancel(); }}>Enter package name manually</Button>
  </div>;
}
