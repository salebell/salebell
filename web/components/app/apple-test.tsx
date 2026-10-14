"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { appleCredentialMetadataError, MAX_APPLE_CREDENTIAL_BYTES, parseAppleCredentialFile } from "@/lib/apple-credentials";
import { rememberedAppleIssuer, rememberAppleIssuer, suggestedAppleIssuer } from "@/lib/apple-issuer";
import type { SavedAppleCredential } from "@/lib/apple-connect";
import { appleTestDeliveryMessage } from "@/lib/apple-test-result";
import { functionError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AppleCredentialPicker } from "./apple-credential-picker";
import { useLoadedWorkspace } from "./workspace";

type Result = { ok: boolean; error?: string; delivery?: string | null };

const APPLE_ERRORS: Record<string, string> = {
  apple_rejected_key: "Apple rejected the key. Check the Key ID and Issuer ID, and that the key is an In-App Purchase key for this account.",
  apple_rate_limited: "Apple says you've asked for too many test notifications. Wait a few minutes.",
};

/** Ask Apple for a test, using a saved IAP connection or an explicitly one-time key. */
export function AppleTest({ appId }: { appId: string }) {
  const { canManage, ws } = useLoadedWorkspace();
  const [mode, setMode] = useState<"saved" | "once">(canManage ? "saved" : "once");
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [hasKey, setHasKey] = useState(false);
  const [reading, setReading] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "accent" | "danger" | "neutral"; text: string } | null>(null);
  const privateKey = useRef("");
  const oneTimeCredentials = useRef<SavedAppleCredential[]>([]);
  const upload = useRef<HTMLInputElement>(null);
  const operation = useRef(0);

  useEffect(() => () => { privateKey.current = ""; operation.current += 1; }, []);
  useEffect(() => {
    const remembered = rememberedAppleIssuer(ws.account.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore non-secret team metadata for this account
    setIssuerId(remembered ?? "");
  }, [ws.account.id]);

  function clearKey(resetInput = true) {
    privateKey.current = "";
    operation.current += 1;
    if (resetInput && upload.current) upload.current.value = "";
    setHasKey(false);
    setReading(false);
  }

  async function pick(file: File | null) {
    clearKey(false);
    setMessage(null);
    if (!file) return;
    if (file.size > MAX_APPLE_CREDENTIAL_BYTES) return setMessage({ tone: "danger", text: "Choose a .p8 key under 16 KB." });
    const currentOperation = operation.current;
    setReading(true);
    try {
      const parsed = parseAppleCredentialFile(file.name, await file.text());
      if (currentOperation !== operation.current) return;
      privateKey.current = parsed.private_key;
      setKeyId(parsed.key_id ?? "");
      setIssuerId(parsed.issuer_id ?? suggestedAppleIssuer(oneTimeCredentials.current, parsed.key_id, rememberedAppleIssuer(ws.account.id)) ?? "");
      setHasKey(true);
    } catch (error) {
      if (currentOperation === operation.current) setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Couldn't read that key file." });
    } finally {
      if (currentOperation === operation.current) setReading(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (busy || reading || (mode === "saved" ? !credentialId : !privateKey.current)) return;
    if (mode === "once") {
      const metadataError = appleCredentialMetadataError(keyId, issuerId);
      if (metadataError) return setMessage({ tone: "danger", text: metadataError });
    }
    const currentOperation = operation.current;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<Result>("apple-test", {
        body: {
          app_id: appId, environment,
          ...(mode === "saved" ? { credential_id: credentialId } : { key_id: keyId.trim(), issuer_id: issuerId.trim(), private_key: privateKey.current }),
        },
      });
      if (currentOperation !== operation.current) return;
      if (error) {
        const text = await functionError(error, "Couldn't reach Apple.");
        if (currentOperation === operation.current) setMessage({ tone: "danger", text });
        return;
      }
      if (!data?.ok) return setMessage({ tone: "danger", text: APPLE_ERRORS[data?.error ?? ""] ?? "Apple couldn't send the test. Check the key and your app's notification URLs, then try again." });
      rememberAppleIssuer(ws.account.id, issuerId);
      if (mode === "once") clearKey();
      setMessage(appleTestDeliveryMessage(data.delivery, environment));
    } catch {
      if (currentOperation === operation.current) setMessage({ tone: "danger", text: "Couldn't reach Apple. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <p className="font-medium">Send an App Store test notification</p>
        <p className="mt-1 text-sm text-muted">Check that Apple can reach Salebell. Alerts are optional and aren&apos;t needed for this test.</p>
      </div>
      <fieldset className="flex gap-4 text-sm" disabled={busy}>
        <legend className="sr-only">Environment</legend>
        {(["sandbox", "production"] as const).map((env) => (
          <label key={env} className="flex items-center gap-2"><input type="radio" name="apple-test-env" checked={environment === env} onChange={() => setEnvironment(env)} />{env === "sandbox" ? "Sandbox URL" : "Production URL"}</label>
        ))}
      </fieldset>
      {canManage ? <fieldset disabled={busy}>
        <legend className="sr-only">Apple key for test notifications</legend>
        <AppleCredentialPicker value={credentialId} provider="apple_iap" oneTime={mode === "once"} onIssuerChange={setIssuerId}
          onChange={(id) => { clearKey(); setCredentialId(id); setMode("saved"); setMessage(null); }}
          onOneTime={(credentials) => { clearKey(); oneTimeCredentials.current = credentials; setMode("once"); setMessage(null); }} />
      </fieldset> : null}
      {mode === "saved" ? <>
        <Button type="button" variant="secondary" size="sm" loading={busy} disabled={!credentialId} onClick={() => { void send(); }}>Send {environment} test notification</Button>
      </> : <form onSubmit={send} className="space-y-4">
        <p className="text-sm text-muted">This upload is used for one request and isn&apos;t saved.</p>
        <fieldset disabled={busy} className="space-y-4">
          <Field label="Key file (.p8)" htmlFor="apple-test-file">
            <Input ref={upload} id="apple-test-file" type="file" accept=".p8,.json" onChange={(event) => { void pick(event.target.files?.[0] ?? null); }} className="h-auto py-2" required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Key ID" htmlFor="apple-test-key" hint="Filled in from the file name when it can be."><Input id="apple-test-key" value={keyId} onChange={(event) => setKeyId(event.target.value.toUpperCase())} placeholder="ABCDE12345" className="font-mono" maxLength={10} required /></Field>
            <Field label="Issuer ID" htmlFor="apple-test-issuer" hint={issuerId ? "Reused for keys from the same Apple team. Check this when switching teams." : "Copy from above your In-App Purchase keys in Apple."}><Input id="apple-test-issuer" value={issuerId} onChange={(event) => setIssuerId(event.target.value)} placeholder="57246542-96fe-1a63-e053-0824d011072a" className="font-mono text-[0.8125rem]" maxLength={36} required /></Field>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2"><Button type="submit" variant="secondary" size="sm" loading={busy || reading} disabled={!hasKey}>Send {environment} test notification</Button>{hasKey ? <Button type="button" variant="ghost" size="sm" onClick={() => clearKey()} disabled={busy}>Clear upload</Button> : null}</div>
      </form>}
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
    </div>
  );
}
