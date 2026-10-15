"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { findSavedAppleApp, loadSavedAppleApp, type AppleApp, type AppleConnectionPreview } from "@/lib/apple-connect";
import type { AppRow } from "@/lib/database.types";
import { SITE_URL, SUPABASE_URL, webhookUrl } from "@/lib/env";
import { friendlyError, functionError, planLimitOf } from "@/lib/errors";
import { forwardingUrlError } from "@/lib/forwarding-url";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AppleCredentialPicker } from "./apple-credential-picker";
import { ConnectionFlow, ConnectionIcon } from "./connection-flow";
import { NotificationUrls } from "./notification-urls";
import { UpgradeCallout } from "./upgrade";
import { useLoadedWorkspace } from "./workspace";

type ImportedApp = Pick<AppRow, "id" | "bundle_id" | "apple_app_id">;

function existingServerHost(url: string | null | undefined) {
  if (!url || forwardingUrlError(url, { siteUrl: SITE_URL, supabaseUrl: SUPABASE_URL })) return null;
  return new URL(url).hostname;
}

export function AppleConnect({ app, onConfigured, onCancel }: { app?: AppRow; onConfigured?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const { ws, canManage, refresh } = useLoadedWorkspace();
  const [stage, setStage] = useState<"key" | "apps" | "review" | "done">("key");
  const [query, setQuery] = useState("");
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [apps, setApps] = useState<AppleApp[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<AppleConnectionPreview | null>(null);
  const [busy, setBusy] = useState<"discover" | "configure" | "manual" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [savedApp, setSavedApp] = useState<ImportedApp | null>(null);
  const operation = useRef(0);
  const choices = app ? apps?.filter((candidate) => candidate.bundle_id === app.bundle_id) : apps;
  const selected = choices?.find((candidate) => candidate.apple_app_id === selectedId);
  const visibleChoices = choices?.filter((candidate) => `${candidate.name} ${candidate.bundle_id}`.toLowerCase().includes(query.toLowerCase().trim()));
  const knownApp = app ?? findSavedAppleApp(ws.apps, selected?.bundle_id);
  const serverHosts = [...new Set((preview ? Object.values(preview.forwarding) : [selected?.production_url, selected?.sandbox_url]).map(existingServerHost).filter(Boolean))];
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, [stage]);

  useEffect(() => () => { operation.current += 1; }, []);

  const discover = useCallback(async (id: string, nextCursor?: string | null) => {
    const currentOperation = ++operation.current;
    setBusy("discover");
    setError(null);
    setPreview(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<{ apps: AppleApp[]; next_cursor?: string }>("apple-connect", {
        body: { action: "discover", account_id: ws.account.id, credential_id: id, ...(nextCursor ? { cursor: nextCursor } : {}) },
      });
      if (currentOperation !== operation.current) return;
      if (error || !data) {
        const message = error ? await functionError(error, "Couldn't load your apps from Apple.") : "Couldn't load your apps from Apple.";
        if (currentOperation === operation.current) setError(message);
        return;
      }
      setApps((previous) => {
        const combined = nextCursor ? [...(previous ?? []), ...data.apps] : data.apps;
        return Array.from(new Map(combined.map((candidate) => [candidate.apple_app_id, candidate])).values());
      });
      setCursor(data.next_cursor ?? null);
    } catch {
      if (currentOperation === operation.current) setError("Couldn't reach Salebell. Check your connection and try again.");
    } finally {
      if (currentOperation === operation.current) setBusy(null);
    }
  }, [ws.account.id]);

  const changeCredential = useCallback((id: string | null) => {
    operation.current += 1;
    setCredentialId(id);
    setStage(id ? "apps" : "key");
    setQuery("");
    setApps(null);
    setCursor(null);
    setSelectedId("");
    setPreview(null);
    setError(null);
    setLimitHit(false);
    setConfigured(false);
    setBusy(null);
    if (id) void discover(id);
  }, [discover]);

  function chooseApp(candidate: AppleApp) {
    setSelectedId(candidate.apple_app_id);
    setPreview(null);
    setError(null);
    setLimitHit(false);
    setStage("review");
  }

  // Browsing apps never creates a database row or consumes a plan slot.
  // Save only after the user chooses Connect or manual setup.
  async function saveSelected(candidate: AppleApp, currentOperation: number): Promise<ImportedApp | null> {
    const client = supabaseBrowser();
    const { data: existing, error: lookupError } = await loadSavedAppleApp(client, ws.account.id, candidate.bundle_id);
    if (currentOperation !== operation.current) return null;
    if (lookupError) throw new Error(friendlyError(lookupError, "Couldn't check your saved apps."));
    const appleAppId = Number(candidate.apple_app_id);
    if (!Number.isSafeInteger(appleAppId) || appleAppId <= 0) throw new Error("Apple returned an invalid app ID. Refresh your apps and try again.");
    let local: ImportedApp;
    if (!existing) {
      const { data, error } = await client.from("apps").insert({
        account_id: ws.account.id, name: candidate.name, store: "app_store", bundle_id: candidate.bundle_id, apple_app_id: appleAppId,
      }).select("id,bundle_id,apple_app_id").single();
      if (currentOperation !== operation.current) return null;
      if (error || !data) {
        if (planLimitOf(error) === "apps") { setLimitHit(true); return null; }
        throw new Error(friendlyError(error, "Couldn't save that app."));
      }
      local = data;
    } else {
      local = existing;
      if (existing.apple_app_id !== appleAppId) {
        const { error } = await client.from("apps").update({ apple_app_id: appleAppId }).eq("id", existing.id);
        if (currentOperation !== operation.current) return null;
        if (error) throw new Error(friendlyError(error));
        local = { ...existing, apple_app_id: appleAppId };
      }
    }
    setSavedApp(local);
    return local;
  }

  async function connect() {
    if (!credentialId || !selected || busy) return;
    const currentOperation = ++operation.current;
    setBusy("configure");
    setError(null);
    setLimitHit(false);
    try {
      const local = await saveSelected(selected, currentOperation);
      if (!local || currentOperation !== operation.current) return;
      const result = await supabaseBrowser().functions.invoke<{ preview: AppleConnectionPreview }>("apple-connect", {
        body: { action: "preview", app_id: local.id, credential_id: credentialId },
      });
      if (currentOperation !== operation.current) return;
      if (result.error || !result.data?.preview) {
        setError(result.error ? await functionError(result.error, "Couldn't check Apple's settings. Try again.") : "Couldn't check Apple's settings. Try again.");
        return;
      }
      const next = result.data.preview;
      setPreview(next);
      // Do not silently apply settings that changed since the displayed review.
      const reviewed = preview?.current ?? selected;
      if ((["production_url", "sandbox_url", "production_version", "sandbox_version"] as const).some((key) => reviewed[key] !== next.current[key])) {
        setError("Apple's settings changed. Review the updated connection details, then connect again.");
        return;
      }
      const { data, error } = await supabaseBrowser().functions.invoke<{ configured: boolean; verified: boolean }>("apple-connect", {
        body: { action: "configure", app_id: next.app_id, credential_id: credentialId, preview: next },
      });
      if (currentOperation !== operation.current) return;
      if (error || !data?.configured) {
        const message = error ? await functionError(error, "Couldn't confirm the Apple setup. Try connecting again.") : "Couldn't confirm the Apple setup. Try connecting again.";
        if (currentOperation === operation.current) {
          setError(message);
        }
        return;
      }
      setConfigured(true);
      setStage("done");
      try {
        localStorage.setItem(`salebell:setup:v1:${next.app_id}`, "urls-saved");
      } catch {
        // This stores setup progress only; the saved Apple key stays on the server.
      }
      if (!app || app.id === next.app_id) onConfigured?.();
      await refresh();
      if (!app || app.id !== next.app_id) router.push(`/app/apps/${next.app_id}/setup`);
    } catch {
      if (currentOperation === operation.current) {
        setError("Couldn't confirm the change. Try connecting again to check Apple's current settings.");
        setPreview(null);
      }
    } finally {
      if (currentOperation === operation.current) setBusy(null);
    }
  }

  async function continueManually() {
    if (busy) return;
    const currentOperation = ++operation.current;
    setBusy("manual");
    setError(null);
    setLimitHit(false);
    try {
      const local = selected ? await saveSelected(selected, currentOperation) : savedApp;
      if (currentOperation !== operation.current) return;
      if (selected && !local) return;
      if (local && (!app || app.id !== local.id)) {
        await refresh();
        router.push(`/app/apps/${local.id}/setup?method=manual`);
      } else {
        onCancel?.();
      }
    } catch (error) {
      if (currentOperation === operation.current) setError(error instanceof Error ? error.message : "Couldn't continue setup. Try again.");
    } finally {
      if (currentOperation === operation.current) setBusy(null);
    }
  }

  if (!canManage) return <Alert tone="neutral">Ask your workspace owner or an admin to import and connect an app.</Alert>;

  return (
    <div className="space-y-5">
      <ConnectionFlow current={stage === "done" ? 3 : stage === "review" ? 2 : stage === "apps" ? 1 : 0} />
      <div className="flex items-center justify-between gap-3">
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight">{stage === "key" ? "Import your iOS app" : stage === "apps" ? "Select your iOS app" : stage === "review" ? "Receive App Store notifications" : "App Store notifications are set up"}</h2>
        {stage !== "key" && stage !== "done" ? <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { setError(null); setLimitHit(false); setStage(stage === "review" ? "apps" : "key"); }}>← Back</Button> : null}
      </div>
      <fieldset hidden={stage !== "key"} disabled={busy !== null || configured} className="min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <legend className="sr-only">Apple connection</legend>
        <AppleCredentialPicker value={credentialId} onChange={changeCredential} />
      </fieldset>
      {stage === "apps" ? <section className="space-y-3" aria-label="Choose your Apple app">
        {busy === "discover" ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> Loading your apps…</div> : apps ? <>
          <div className="flex items-center justify-between gap-2"><p className="text-sm text-muted">Select an app to continue.</p><Button type="button" variant="ghost" size="sm" disabled={busy !== null || !credentialId} onClick={() => { if (credentialId) void discover(credentialId); }}>Refresh</Button></div>
          {(choices?.length ?? 0) > 6 ? <Input aria-label="Search apps" placeholder="Search apps" value={query} onChange={(event) => setQuery(event.target.value)} /> : null}
          {visibleChoices && visibleChoices.length > 0 ? <div className="grid max-h-[min(28rem,55dvh)] gap-2 overflow-y-auto p-1 sm:grid-cols-2">
            {visibleChoices.map((candidate) => <button key={candidate.apple_app_id} type="button" disabled={busy !== null} onClick={() => chooseApp(candidate)}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/30 disabled:opacity-60">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-accent-text"><ConnectionIcon kind="app" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{candidate.name}</span><span className="mt-1 block truncate font-mono text-xs text-muted">{candidate.bundle_id}</span></span>
              <span className="text-muted" aria-hidden="true">→</span>
            </button>)}
          </div> : <Alert tone="neutral">{query ? "No apps match that search." : app ? `No app with bundle ID ${app.bundle_id} is visible to this key.` : "No apps are visible to this key."} {!query ? "Check your Apple team or set up manually." : ""}</Alert>}
          {cursor ? <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { if (credentialId) void discover(credentialId, cursor); }}>Load more apps</Button> : null}
        </> : <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => { if (credentialId) void discover(credentialId); }}>Try again</Button>}
      </section> : null}
      {stage === "review" && selected ? <section className="space-y-4" aria-label="Review and connect">
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-text"><ConnectionIcon kind="app" /></span><div className="min-w-0"><h3 className="truncate font-semibold">{selected.name}</h3><p className="truncate font-mono text-xs text-muted">{selected.bundle_id}</p></div></div>
          <p className="my-4 text-sm text-muted">Salebell will connect Apple notifications and keep any supported existing server connected.</p>
          {serverHosts.length ? <p className="mb-4 break-words text-xs text-muted">Existing server: <span className="font-mono text-fg">{serverHosts.join(", ")}</span></p> : null}
          <Button type="button" className="w-full sm:w-auto" loading={busy === "configure"} disabled={busy !== null} onClick={connect}><ConnectionIcon kind="play" className="size-4" />{error ? "Retry notification setup" : "Start receiving notifications"}</Button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {limitHit ? <UpgradeCallout reason="apps" /> : null}
        <details open={error && preview ? true : undefined} className="rounded-xl border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm text-muted">Connection details</summary>
          <div className="space-y-3 border-t border-border p-4">
            <p className="text-sm">App Store → Salebell → your alerts</p>
            {preview || knownApp ? <NotificationUrls urls={preview?.target ?? { production_url: webhookUrl(knownApp!.webhook_key, "production"), sandbox_url: webhookUrl(knownApp!.webhook_key, "sandbox") }} current={preview?.current ?? selected} forwarding={preview?.forwarding ?? { production_url: knownApp?.forward_url_production ?? null, sandbox_url: knownApp?.forward_url_sandbox ?? null }} /> : <div className="space-y-3 text-xs text-muted"><p>Both notification URLs will use Salebell with Version 2. Your app&apos;s URLs are created when you connect.</p>{(["production", "sandbox"] as const).map((env) => <div key={env}><p className="font-medium text-fg">Current {env} server</p><p className="mt-1 break-all font-mono">{selected[`${env}_url`] ?? "No server configured"}</p></div>)}</div>}
          </div>
        </details>
      </section> : null}
      {stage === "done" ? <Alert tone="accent">Apple is set up. Next, check that a notification arrives.</Alert> : null}
      {error && stage !== "review" ? <Alert>{error}</Alert> : null}
      {onCancel && !configured ? <Button type="button" variant="ghost" size="sm" loading={busy === "manual"} disabled={busy !== null} onClick={continueManually}>{selected || savedApp ? "Set notification URLs manually" : "Enter app details manually"}</Button> : null}
    </div>
  );
}
