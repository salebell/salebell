"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useCurrentApp } from "@/components/app/use-current-app";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import type { AppRow } from "@/lib/database.types";
import { friendlyError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";

function DetailsForm({ app }: { app: AppRow }) {
  const { patchApp, canManage } = useCurrentApp();
  const [name, setName] = useState(app.name);
  const [bundleId, setBundleId] = useState(app.bundle_id);
  const [appleId, setAppleId] = useState(app.apple_app_id?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "accent" | "danger"; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const patch = { name: name.trim(), bundle_id: bundleId.trim(), apple_app_id: appleId.trim() ? Number(appleId) : null };
    const { error } = await supabaseBrowser().from("apps").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return setMessage({ tone: "danger", text: error.code === "23505" ? "Another app in this workspace already uses that bundle ID." : friendlyError(error) });
    patchApp(app.id, patch);
    setMessage({ tone: "accent", text: "Saved." });
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="App name" htmlFor="s-name">
        <Input id="s-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} />
      </Field>
      <Field label="Bundle ID" htmlFor="s-bundle" hint="Notifications for any other bundle ID are rejected.">
        <Input id="s-bundle" required value={bundleId} onChange={(e) => setBundleId(e.target.value)} className="font-mono" spellCheck={false} disabled={!canManage} />
      </Field>
      <Field label="Apple ID (optional)" htmlFor="s-apple" hint="When set, production notifications must carry this Apple ID.">
        <Input id="s-apple" inputMode="numeric" value={appleId} onChange={(e) => setAppleId(e.target.value.replace(/\D/g, ""))} className="tnum font-mono" disabled={!canManage} />
      </Field>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {canManage && (
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
      )}
    </form>
  );
}

export default function AppSettingsPage() {
  const router = useRouter();
  const { app, patchApp, removeApp, refresh, canManage } = useCurrentApp();
  const [busy, setBusy] = useState<"toggle" | "delete" | null>(null);
  const [confirm, setConfirm] = useState("");
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!app) return null;

  async function toggle() {
    if (!app) return;
    setBusy("toggle");
    const { error } = await supabaseBrowser().from("apps").update({ enabled: !app.enabled }).eq("id", app.id);
    setBusy(null);
    setConfirmDisable(false);
    if (error) return setError(friendlyError(error));
    patchApp(app.id, { enabled: !app.enabled });
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    if (!app || confirm !== app.name) return;
    setBusy("delete");
    const { error } = await supabaseBrowser().from("apps").delete().eq("id", app.id);
    if (error) {
      setBusy(null);
      return setError(friendlyError(error));
    }
    removeApp(app.id);
    router.replace("/app");
    await refresh();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Details</h2>
        <DetailsForm app={app} />
      </Card>

      {canManage && (
        <>
          <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="font-semibold">{app.enabled ? "Disable this app" : "Enable this app"}</h2>
              <p className="mt-1 text-sm text-muted">
                {app.enabled
                  ? "Stops recording, alerts and forwarding. Apple will see errors and retry production notifications for a few days."
                  : "Start accepting notifications again."}
              </p>
            </div>
            {app.enabled && confirmDisable ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => setConfirmDisable(false)}>
                  Cancel
                </Button>
                <Button variant="danger" loading={busy === "toggle"} onClick={toggle}>
                  Yes, disable
                </Button>
              </div>
            ) : (
              <Button variant="secondary" loading={busy === "toggle"} onClick={app.enabled ? () => setConfirmDisable(true) : toggle}>
                {app.enabled ? "Disable" : "Enable"}
              </Button>
            )}
          </Card>

          <Card className="border-danger/35 p-5 sm:p-6">
            <h2 className="font-semibold text-danger">Delete this app</h2>
            <p className="mt-1 text-sm text-muted">
              Permanently deletes {app.name}, its events, integrations and webhook URLs. Remove the Salebell URLs from App Store Connect
              first, or Apple will keep sending to an address that no longer exists.
            </p>
            <form onSubmit={remove} className="mt-4 space-y-3">
              <Field label={`Type “${app.name}” to confirm`} htmlFor="confirm-delete">
                <Input id="confirm-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
              </Field>
              <Button type="submit" variant="danger" loading={busy === "delete"} disabled={confirm !== app.name}>
                Delete app permanently
              </Button>
            </form>
          </Card>
        </>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
