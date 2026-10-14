"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { AppRow } from "@/lib/database.types";
import { SITE_URL, SUPABASE_URL } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { forwardingUrlError } from "@/lib/forwarding-url";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useLoadedWorkspace } from "./workspace";

function check(url: string) {
  return forwardingUrlError(url, { siteUrl: SITE_URL, supabaseUrl: SUPABASE_URL });
}

export function ForwardingForm({ app }: { app: AppRow }) {
  const { patchApp, canManage } = useLoadedWorkspace();
  const [prod, setProd] = useState(app.forward_url_production ?? "");
  const [sandbox, setSandbox] = useState(app.forward_url_sandbox ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "accent" | "danger"; text: string } | null>(null);
  const prodError = check(prod.trim());
  const sandboxError = check(sandbox.trim());
  const dirty = prod.trim() !== (app.forward_url_production ?? "") || sandbox.trim() !== (app.forward_url_sandbox ?? "");

  async function save(e: FormEvent) {
    e.preventDefault();
    if (prodError || sandboxError) return;
    setBusy(true);
    setMessage(null);
    const patch = { forward_url_production: prod.trim() || null, forward_url_sandbox: sandbox.trim() || null };
    const { error } = await supabaseBrowser().from("apps").update(patch).eq("id", app.id);
    setBusy(false);
    if (error) return setMessage({ tone: "danger", text: friendlyError(error) });
    patchApp(app.id, patch);
    setMessage({ tone: "accent", text: "Saved. New notifications will be forwarded." });
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <Field label="Your production server URL" htmlFor="fwd-prod" error={prodError} hint="Your current Production Server URL in App Store Connect.">
        <Input
          id="fwd-prod"
          type="url"
          inputMode="url"
          placeholder="https://api.example.com/apple/notifications"
          value={prod}
          onChange={(e) => setProd(e.target.value)}
          disabled={!canManage}
          className="font-mono text-[0.8125rem]"
          aria-invalid={!!prodError}
        />
      </Field>
      <Field label="Your sandbox server URL" htmlFor="fwd-sandbox" error={sandboxError} hint="Your current Sandbox Server URL. Leave empty if you didn't have one.">
        <Input
          id="fwd-sandbox"
          type="url"
          inputMode="url"
          placeholder="https://staging.example.com/apple/notifications"
          value={sandbox}
          onChange={(e) => setSandbox(e.target.value)}
          disabled={!canManage}
          className="font-mono text-[0.8125rem]"
          aria-invalid={!!sandboxError}
        />
      </Field>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {canManage ? (
        <Button type="submit" loading={busy} disabled={!dirty || !!prodError || !!sandboxError}>
          Keep my server connected
        </Button>
      ) : (
        <p className="text-sm text-muted">Only workspace owners and admins can change forwarding.</p>
      )}
    </form>
  );
}
