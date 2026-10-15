"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { friendlyError, planLimitOf } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";
import { UpgradeCallout } from "./upgrade";
import { useLoadedWorkspace } from "./workspace";
import { appDetailsError, newAppPayload, type AppStore } from "@/lib/app-form";

export function AddAppForm({ store = "app_store" }: { store?: AppStore }) {
  const router = useRouter();
  const { ws, refresh } = useLoadedWorkspace();
  const [name, setName] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [appleId, setAppleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);

  const google = store === "play_store";
  const bundleError = bundleId ? appDetailsError(store, bundleId) : null;
  const appleIdError = !google && appleId && !/^\d{6,12}$/.test(appleId.trim()) ? "The Apple ID is a number, like 1234567890." : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim() || !bundleId.trim() || bundleError || appleIdError) return;
    setBusy(true);
    setError(null);
    setLimitHit(false);
    const { data, error } = await supabaseBrowser()
      .from("apps")
      .insert(newAppPayload(ws.account.id, store, name, bundleId, appleId))
      .select("id")
      .single();
    if (error || !data) {
      setBusy(false);
      if (planLimitOf(error) === "apps") setLimitHit(true);
      else setError(error?.code === "23505" ? `You already added an app with this ${google ? "package name" : "bundle ID"}.` : friendlyError(error));
      return;
    }
    await refresh();
    router.push(`/app/apps/${data.id}/setup${google ? "" : "?method=manual"}`);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="App name" htmlFor="app-name" hint="Shown in alerts and on your dashboard.">
        <Input id="app-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="My App" autoComplete="off" autoFocus />
      </Field>
      <Field
        label={google ? "Package name" : "Bundle ID"}
        htmlFor="bundle-id"
        error={bundleError}
        hint={google ? "Copy the package name from Google Play Console, such as com.example.app. It must match purchase notifications exactly." : "Find this in App Store Connect → your app → App Information. Copy it exactly."}
      >
        <Input
          id="bundle-id"
          required
          value={bundleId}
          onChange={(e) => setBundleId(e.target.value)}
          placeholder="com.example.app"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="font-mono"
          aria-invalid={!!bundleError}
          aria-describedby={bundleError ? "bundle-id-error" : "bundle-id-hint"}
        />
      </Field>
      {!google ? <details className="rounded-lg border border-border px-4 py-3">
        <summary className="cursor-pointer text-sm text-muted">Optional: add your numeric Apple ID</summary>
        <div className="mt-3">
          <Field
            label="Apple ID"
            htmlFor="apple-id"
            error={appleIdError}
            hint="Adds an extra check on production notifications. You can also add this later in Settings."
          >
            <Input
              id="apple-id"
              inputMode="numeric"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value.replace(/\D/g, ""))}
              placeholder="1234567890"
              className="font-mono tnum"
              aria-invalid={!!appleIdError}
              aria-describedby={appleIdError ? "apple-id-error" : "apple-id-hint"}
            />
          </Field>
        </div>
      </details> : null}
      {error && <Alert>{error}</Alert>}
      {limitHit && <UpgradeCallout reason="apps" />}
      <Button type="submit" size="lg" loading={busy} disabled={!name.trim() || !bundleId.trim() || !!bundleError || !!appleIdError} className="w-full sm:w-auto">
        {google ? "Add app and connect Google Play" : "Add app and get my URLs"}
      </Button>
    </form>
  );
}
