"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppleTest } from "@/components/app/apple-test";
import { AppleConnect } from "@/components/app/apple-connect";
import { NotificationUrls } from "@/components/app/notification-urls";
import { ForwardingForm } from "@/components/app/forwarding-form";
import { EnvStatus, isConnected } from "@/components/app/status";
import { useCurrentApp } from "@/components/app/use-current-app";
import { ConnectionIcon } from "@/components/app/connection-flow";
import { IphoneAppNote } from "@/components/iphone-app";
import { Alert, Button, ButtonLink, Card, Spinner } from "@/components/ui";
import type { AppRow, StoreEvent } from "@/lib/database.types";
import { IOS_APP_URL, IS_SELF_HOSTED, webhookUrl } from "@/lib/env";
import { eventLabel } from "@/lib/events";
import { functionError } from "@/lib/errors";
import { money } from "@/lib/format";
import { useLiveEvents, useNow } from "@/lib/hooks";
import { supabaseBrowser } from "@/lib/supabase/client";

function SetupProgress({ current, urlsSaved, connected }: { current: number; urlsSaved: boolean; connected: boolean }) {
  const steps = [
    { title: "Receive purchases", detail: urlsSaved ? "Apple notification URLs saved" : "Set App Store notification URLs", done: urlsSaved },
    { title: "Check connection", detail: connected ? "Notification received" : "Receive an Apple event", done: connected },
    { title: "Alerts (optional)", detail: "Add a destination anytime", done: false },
  ];
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Setup progress">
      {steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined}
        className={`min-w-0 rounded-xl border p-3 sm:p-4 ${index === current ? "border-accent/50 bg-accent-soft/40" : "border-border bg-surface-2 text-muted"}`}>
        <span className={`mb-2 grid size-7 place-items-center rounded-full text-xs font-medium ${index === current ? "bg-accent text-accent-fg" : "border border-border bg-surface text-muted"}`} aria-hidden="true">
          {step.done ? <ConnectionIcon kind="check" className="size-4" /> : index + 1}
        </span>
        <p className="text-xs font-semibold sm:text-sm">{step.title}</p>
        <p className="mt-1 hidden text-xs text-muted sm:block">{step.detail}</p>
      </li>)}
    </ol>
  );
}

function ServerConnection({ app }: { app: AppRow }) {
  const hasServer = !!(app.forward_url_production || app.forward_url_sandbox);
  return (
    <details className="group rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {hasServer ? "✓ Your existing server stays connected" : "Keep your existing server connected"}
        <span className="text-muted transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>
      <div className="border-t border-border p-4">
        <p className="mb-4 text-sm text-muted">Already use a server? Save its current Apple URLs here before changing them in Apple.</p>
        <ForwardingForm app={app} />
      </div>
    </details>
  );
}

function ManualConnection({ app, onConfirmed }: { app: AppRow; onConfirmed: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Paste these two URLs into App Store Connect → App Information.</p>
      <a href={app.apple_app_id ? `https://appstoreconnect.apple.com/apps/${app.apple_app_id}` : "https://appstoreconnect.apple.com/apps"} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium text-accent-text underline underline-offset-2">Open App Store Connect ↗</a>
      <ServerConnection app={app} />
      <NotificationUrls urls={{ production_url: webhookUrl(app.webhook_key, "production"), sandbox_url: webhookUrl(app.webhook_key, "sandbox") }} />
      <details className="text-sm text-muted">
        <summary className="cursor-pointer">Where do I paste these?</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Open <strong className="text-fg">General → App Information → App Store Server Notifications</strong>.</li>
          <li>Set the <strong className="text-fg">Production Server URL</strong>, select <strong className="text-fg">Version 2</strong> and save.</li>
          <li>Repeat for the <strong className="text-fg">Sandbox Server URL</strong>.</li>
        </ol>
        <p className="mt-3 text-xs">Apple website role: Account Holder, Admin, App Manager or Marketing. <Link href="/docs#asc" className="text-accent-text underline underline-offset-2">Full guide</Link></p>
      </details>
      <Button type="button" onClick={onConfirmed}>I&apos;ve saved both URLs →</Button>
    </div>
  );
}

function LiveStatus({ app, firstEvent }: { app: AppRow; firstEvent: StoreEvent | null }) {
  const now = useNow(15_000);
  const connected = isConnected(app);
  const label = firstEvent ? eventLabel(firstEvent.type) : null;
  return (
    <Card className={`overflow-hidden ${connected ? "border-accent/50" : ""}`}>
      <div className={`flex items-center gap-4 p-5 ${connected ? "bg-accent-soft/60" : ""}`} aria-live="polite">
        {connected ? (
          <span className="grid size-11 shrink-0 animate-pop place-items-center rounded-full bg-accent text-accent-fg">
            <svg viewBox="0 0 16 16" className="size-5" aria-hidden="true">
              <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <span className="relative grid size-11 shrink-0 place-items-center" aria-hidden="true">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />
            <span className="relative size-3 rounded-full bg-accent" />
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold">{connected ? "✓ Connected" : "Waiting for the first notification…"}</p>
          <p className="text-sm text-muted">
            {connected
              ? firstEvent && label
                ? `${label.emoji} ${label.label}${firstEvent.revenue != null ? ` · ${money(firstEvent.revenue, firstEvent.currency)}` : ""} just arrived from ${firstEvent.environment}.`
                : "Salebell is receiving notifications for this app."
              : "Your URLs are saved. Listening for Apple."}
          </p>
        </div>
      </div>
      <div className="space-y-2 border-t border-border px-5 py-4">
        <EnvStatus app={app} env="production" now={now} />
        <EnvStatus app={app} env="sandbox" now={now} />
      </div>
    </Card>
  );
}

function PhoneTest({ appId }: { appId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setResult(null);
    const { data, error } = await supabaseBrowser().functions.invoke<{ push?: { sent: number; failed: number; error?: string } }>(
      "test-alert",
      { body: { app_id: appId, target: "push" } },
    );
    setBusy(false);
    if (error) return setResult({ ok: false, text: await functionError(error, "Couldn't send a test push.") });
    const push = data?.push;
    if (push?.error === "push_not_configured") return setResult({ ok: false, text: "iPhone push isn't switched on yet." });
    if (!push || push.sent + push.failed === 0)
      return setResult({ ok: false, text: "No iPhone is registered yet. Install the app and sign in with this email." });
    setResult(
      push.failed
        ? { ok: push.sent > 0, text: `Sent to ${push.sent} of ${push.sent + push.failed} iPhones.` }
        : { ok: true, text: `Sent to ${push.sent} iPhone${push.sent === 1 ? "" : "s"}. Listen for the cha-ching.` },
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <Button variant="secondary" size="sm" loading={busy} onClick={send}>
        Send a test alert
      </Button>
      {result && <Alert tone={result.ok ? "accent" : "neutral"}>{result.text}</Alert>}
    </div>
  );
}

function SetupFlow() {
  const { app, patchApp, canManage } = useCurrentApp();
  const searchParams = useSearchParams();
  const [firstEvent, setFirstEvent] = useState<StoreEvent | null>(null);
  const [urlsSavedFor, setUrlsSavedFor] = useState<string | null>(null);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [alertsFor, setAlertsFor] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [iphoneFor, setIphoneFor] = useState<string | null>(null);
  const appId = app?.id;
  const urlsSaved = urlsSavedFor === appId;
  const connected = app ? isConnected(app) : false;
  const urlsReady = urlsSaved || connected;
  const current = !urlsReady ? 0 : alertsFor === appId ? 2 : 1;
  const manual = searchParams.get("method") === "manual" || manualFor === appId || !canManage;
  const configuringAutomatically = current === 0 && !manual;

  useEffect(() => {
    if (!appId) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore this app's setup progress after hydration
      setUrlsSavedFor(localStorage.getItem(`salebell:setup:v1:${appId}`) === "urls-saved" ? appId : null);
    } catch {
      // Setup still works when browser storage is unavailable.
    }
    setRestoredFor(appId);
  }, [appId]);

  useLiveEvents(app?.id, (e) => {
    if (!app) return;
    setFirstEvent((cur) => cur?.app_id === e.app_id ? cur : e);
    patchApp(app.id, e.environment === "Production" ? { last_event_production_at: e.received_at } : { last_event_sandbox_at: e.received_at });
  });

  // Fallback while waiting, in case the Realtime connection is blocked by a proxy or firewall.
  useEffect(() => {
    if (!app || connected) return;
    const t = setInterval(async () => {
      const { data } = await supabaseBrowser().from("apps").select("last_event_production_at, last_event_sandbox_at").eq("id", app.id).single();
      if (data && (data.last_event_production_at || data.last_event_sandbox_at)) patchApp(app.id, data);
    }, 15_000);
    return () => clearInterval(t);
  }, [app, connected, patchApp]);

  useEffect(() => {
    if (restoredFor === appId) document.getElementById("setup-task-title")?.focus();
  }, [current, manual, restoredFor, appId]);

  if (!app) return null;
  if (restoredFor !== app.id) return <div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading setup…</div>;

  function confirmUrlsSaved() {
    if (!appId) return;
    setUrlsSavedFor(appId);
    try {
      localStorage.setItem(`salebell:setup:v1:${appId}`, "urls-saved");
    } catch {
      // Progress is still kept for this visit.
    }
  }

  return (
    <div className="max-w-3xl">
      {!configuringAutomatically ? <SetupProgress current={current} urlsSaved={urlsReady} connected={connected} /> : null}

      <section aria-labelledby={configuringAutomatically ? undefined : "setup-task-title"} aria-label={configuringAutomatically ? "Connect Apple notifications" : undefined} className="rounded-xl border border-border bg-surface p-4 sm:p-6">
        {!configuringAutomatically ? <h2 id="setup-task-title" tabIndex={-1} className="mb-4 text-lg font-semibold tracking-tight outline-none">
          {current === 0 ? "Paste your Apple notification URLs" : current === 1 ? "Check your connection" : "Set up alerts (optional)"}
        </h2> : null}

        {current === 0 ? manual ? <>
          <ManualConnection app={app} onConfirmed={confirmUrlsSaved} />
          {canManage ? <Button type="button" variant="ghost" size="sm" className="mt-4" onClick={() => { setManualFor(null); window.history.replaceState(null, "", window.location.pathname); }}>Set up with App Store Connect</Button> : null}
        </> : <AppleConnect app={app} onConfigured={confirmUrlsSaved} onCancel={() => setManualFor(app.id)} /> : null}

        {current === 1 ? <div className="space-y-4">
          <LiveStatus app={app} firstEvent={firstEvent?.app_id === app.id ? firstEvent : null} />
          <p className="text-sm text-muted">Incoming sales are recorded automatically. Alerts are optional.</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={`/app/apps/${app.id}`}>Go to dashboard</ButtonLink>
            <Button type="button" variant="secondary" onClick={() => setAlertsFor(app.id)}>Set up alerts (optional) →</Button>
          </div>
          <AppleTest appId={app.id} />
          <p className="text-xs text-muted">Sandbox URL changes can take up to an hour.</p>
        </div> : null}

        {current === 2 ? <div className="space-y-4">
          <p className="text-sm text-muted">Incoming sales are recorded automatically. Add an alert destination whenever you like.</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={`/app/apps/${app.id}`}>Go to dashboard</ButtonLink>
            <Button type="button" variant="secondary" onClick={() => setAlertsFor(null)}>← Connection & test</Button>
          </div>
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <span className={`size-2 shrink-0 rounded-full ${connected ? "bg-accent" : "bg-warn"}`} aria-hidden="true" />
            {connected ? "Apple is connected." : "Listening for Apple. Your first sale will confirm the connection."}
          </p>
          {iphoneFor === app.id ? <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">📱 iPhone alerts</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setIphoneFor(null)}>Change destination</Button>
            </div>
            <p className="mt-2 text-sm text-muted">{IOS_APP_URL ? "Install Salebell, sign in with the same email and allow notifications." : <IphoneAppNote />}</p>
            {IOS_APP_URL ? <p className="mt-3 text-sm"><IphoneAppNote /></p> : null}
            <PhoneTest appId={app.id} />
          </Card> : <div className="grid gap-3 sm:grid-cols-2">
            <Link href={`/app/apps/${app.id}/integrations`} className="rounded-xl border border-border p-4 transition-colors hover:border-accent hover:bg-accent-soft/30">
              <span className="text-2xl" aria-hidden="true">💬</span>
              <span className="mt-3 block font-medium">Slack, Discord & more →</span>
              <span className="mt-1 block text-sm text-muted">Send sales to your favorite channel.</span>
            </Link>
            <button type="button" disabled={!IOS_APP_URL} onClick={() => setIphoneFor(app.id)} className="rounded-xl border border-border p-4 text-left transition-colors enabled:hover:border-accent enabled:hover:bg-accent-soft/30 disabled:cursor-default disabled:bg-surface-2 disabled:text-muted">
              <span className="text-2xl" aria-hidden="true">📱</span>
              <span className="mt-3 block font-medium">iPhone app{IOS_APP_URL ? " →" : ""}</span>
              <span className="mt-1 block text-sm text-muted">{IOS_APP_URL ? "Hear every sale on your phone." : IS_SELF_HOSTED ? "Build for your instance · configure APNs" : "Coming soon · TestFlight"}</span>
            </button>
          </div>}
          {IS_SELF_HOSTED && !IOS_APP_URL && <p className="text-sm text-muted"><IphoneAppNote /></p>}
        </div> : null}
      </section>

      {urlsReady ? <details className="mt-4 rounded-xl border border-border bg-surface-2">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted">Connection details</summary>
        <div className="space-y-4 border-t border-border p-4">
          <LiveStatus app={app} firstEvent={firstEvent?.app_id === app.id ? firstEvent : null} />
          <NotificationUrls urls={{ production_url: webhookUrl(app.webhook_key, "production"), sandbox_url: webhookUrl(app.webhook_key, "sandbox") }} />
          <ServerConnection app={app} />
        </div>
      </details> : null}
    </div>
  );
}

export default function SetupPage() {
  return <Suspense fallback={<div role="status" className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading setup…</div>}><SetupFlow /></Suspense>;
}
