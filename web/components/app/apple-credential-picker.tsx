"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, inputClass } from "@/components/ui";
import { appleCredentialMetadataError, MAX_APPLE_CREDENTIAL_BYTES, parseAppleCredentialFile } from "@/lib/apple-credentials";
import { appleIssuerChoices, rememberedAppleIssuer, rememberAppleIssuer, suggestedAppleIssuer } from "@/lib/apple-issuer";
import type { SavedAppleCredential } from "@/lib/apple-connect";
import { functionError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ConnectionIcon } from "./connection-flow";
import { useLoadedWorkspace } from "./workspace";

export function AppleCredentialPicker({ value, onChange, provider = "apple_connect", oneTime = false, onOneTime, onIssuerChange }: {
  value: string | null;
  onChange: (id: string | null) => void;
  provider?: "apple_connect" | "apple_iap";
  oneTime?: boolean;
  onOneTime?: (credentials: SavedAppleCredential[]) => void;
  onIssuerChange?: (issuerId: string) => void;
}) {
  const { ws } = useLoadedWorkspace();
  const fieldId = useId();
  const accountId = ws.account.id;
  const isIap = provider === "apple_iap";
  const [credentials, setCredentials] = useState<SavedAppleCredential[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [keyId, setKeyId] = useState("");
  const [issuerId, setIssuerId] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [filename, setFilename] = useState("");
  const [inferredKeyId, setInferredKeyId] = useState(false);
  const [issuerFromFile, setIssuerFromFile] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const privateKey = useRef("");
  const upload = useRef<HTMLInputElement>(null);
  const issuerInput = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const compatible = credentials?.filter((credential) => credential.provider === provider) ?? [];
  const issuerChoices = appleIssuerChoices(credentials ?? []);

  useEffect(() => { if (hasKey && !issuerFromFile) issuerInput.current?.focus(); }, [hasKey, issuerFromFile]);

  useEffect(() => {
    let active = true;
    Promise.allSettled(([provider, provider === "apple_iap" ? "apple_connect" : "apple_iap"] as const).map((purpose) =>
      supabaseBrowser().functions.invoke<{ credentials: SavedAppleCredential[] }>("apple-credentials", {
        body: { action: "list", account_id: accountId, provider: purpose },
      }),
    )).then(async (results) => {
      if (!active) return;
      const own = results[0];
      const all = results.flatMap((result) => result.status === "fulfilled" && !result.value.error ? result.value.data?.credentials ?? [] : []);
      setCredentials(Array.from(new Map(all.map((credential) => [credential.id, credential])).values()));
      const suggested = suggestedAppleIssuer(all, "", rememberedAppleIssuer(accountId));
      setIssuerId(suggested ?? "");
      onIssuerChange?.(suggested ?? "");
      if (own.status === "rejected" || own.value.error) {
        const message = own.status === "fulfilled" && own.value.error ? await functionError(own.value.error, "Couldn't load saved Apple keys.") : "Couldn't load saved Apple keys.";
        if (active) setError(message);
      } else {
        if (all.length === 0) {
          setEditing("new");
          setLabel(isIap ? "Apple In-App Purchase" : "App Store Connect");
        }
      }
    }).catch(() => {
      if (active) setError("Couldn't load saved Apple connections. Check your connection and reopen this form.");
    });
    return () => {
      active = false;
      privateKey.current = "";
      operation.current += 1;
    };
  }, [accountId, provider, isIap, onIssuerChange]);

  function clearUpload(resetInput = true) {
    privateKey.current = "";
    operation.current += 1;
    if (resetInput && upload.current) upload.current.value = "";
    setHasKey(false);
    setFilename("");
    setInferredKeyId(false);
    setIssuerFromFile(false);
    setReading(false);
  }

  function closeEditor() {
    clearUpload();
    setEditing(null);
    setLabel("");
    setKeyId("");
    setIssuerId("");
    setError(null);
  }

  function openEditor(credential?: SavedAppleCredential) {
    onChange(null);
    clearUpload();
    setEditing(credential?.id ?? "new");
    setLabel(credential?.label ?? (isIap ? "Apple In-App Purchase" : "App Store Connect"));
    setKeyId(credential?.key_id ?? "");
    setIssuerId(credential?.issuer_id ?? suggestedAppleIssuer(credentials ?? [], "", rememberedAppleIssuer(accountId)) ?? "");
    setDeleteId(null);
    setError(null);
    setNotice(null);
    onChange(null);
  }

  async function pick(file: File | null) {
    clearUpload(false);
    setError(null);
    if (!file) return;
    if (file.size > MAX_APPLE_CREDENTIAL_BYTES) {
      setError("Choose an Apple .p8 key or a credential JSON file under 16 KB.");
      return;
    }
    const currentOperation = operation.current;
    setReading(true);
    try {
      const parsed = parseAppleCredentialFile(file.name, await file.text());
      if (currentOperation !== operation.current) return;
      privateKey.current = parsed.private_key;
      setKeyId(parsed.key_id ?? "");
      setFilename(file.name);
      setInferredKeyId(!!parsed.key_id);
      const inferredIssuer = parsed.issuer_id ?? suggestedAppleIssuer(credentials ?? [], parsed.key_id, rememberedAppleIssuer(accountId));
      setIssuerFromFile(!!inferredIssuer);
      setIssuerId(inferredIssuer ?? "");
      setHasKey(true);
    } catch (error) {
      if (currentOperation === operation.current) setError(error instanceof Error ? error.message : "Couldn't read that key file.");
    } finally {
      if (currentOperation === operation.current) setReading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || reading || !editing || !privateKey.current || !label.trim()) return;
    const metadataError = appleCredentialMetadataError(keyId, issuerId);
    if (metadataError) return setError(metadataError);
    setBusy(true);
    setError(null);
    const currentOperation = operation.current;
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<{ credential: SavedAppleCredential }>("apple-credentials", {
        body: {
          action: "save", account_id: accountId, provider, label: label.trim(), key_id: keyId.trim(), issuer_id: issuerId.trim(),
          private_key: privateKey.current, ...(editing !== "new" ? { credential_id: editing } : {}),
        },
      });
      if (currentOperation !== operation.current) return;
      if (error || !data?.credential) {
        const message = error ? await functionError(error, "Couldn't save the Apple connection.") : "Couldn't save the Apple connection.";
        if (currentOperation === operation.current) setError(message);
        return;
      }
      const saved = data.credential;
      rememberAppleIssuer(accountId, saved.issuer_id);
      onIssuerChange?.(saved.issuer_id);
      setCredentials((current) => [...(current ?? []).filter((credential) => credential.id !== saved.id), saved]);
      closeEditor();
      onChange(saved.id);
      setNotice(null);
    } catch {
      if (currentOperation === operation.current) setError("Couldn't reach Salebell. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy || !deleteId) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabaseBrowser().functions.invoke<{ deleted: boolean }>("apple-credentials", {
        body: { action: "delete", account_id: accountId, credential_id: deleteId },
      });
      if (error || !data?.deleted) {
        setError(error ? await functionError(error, "Couldn't delete that connection.") : "Couldn't delete that connection.");
        return;
      }
      setCredentials((current) => (current ?? []).filter((credential) => credential.id !== deleteId));
      onChange(null);
      setDeleteId(null);
      setNotice("Connection deleted. Your apps and their existing notification URLs are still configured.");
    } catch {
      setError("Couldn't reach Salebell. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {credentials ? <Field label={isIap ? "In-App Purchase key for test notifications" : "App Store Connect API key"} htmlFor={`${fieldId}-connection`} hint={isIap ? "App Store Connect keys import apps. An In-App Purchase key sends test notifications." : "Used to list your iOS apps and configure their notification URLs."}>
        <select id={`${fieldId}-connection`} className={inputClass} disabled={busy || reading} value={editing !== null ? "__new" : oneTime ? "__once" : value ?? ""} onChange={(event) => {
          const id = event.target.value;
          setDeleteId(null); setNotice(null); setError(null);
          if (id === "__new") { openEditor(); return; }
          closeEditor();
          onChange(id === "__once" ? null : id || null);
          if (id === "__once") { onOneTime?.(credentials); return; }
          const credential = credentials.find((candidate) => candidate.id === id);
          if (credential) { rememberAppleIssuer(accountId, credential.issuer_id); onIssuerChange?.(credential.issuer_id); }
        }}>
          <option value="">Select a saved key or upload one</option>
          {credentials.length ? <optgroup label="Saved Apple keys">{credentials.map((credential) => <option key={credential.id} value={credential.id} disabled={credential.provider !== provider}>
            {credential.label} · {credential.key_id}{credential.provider !== provider ? credential.provider === "apple_connect" ? " — app import only" : " — test notifications only" : ""}
          </option>)}</optgroup> : null}
          <option value="__new">Upload {isIap ? "an In-App Purchase key" : "an App Store Connect API key"}…</option>
          {onOneTime ? <option value="__once">Use a test key once without saving…</option> : null}
        </select>
      </Field> : <p className="text-sm text-muted" role="status">Loading saved Apple keys…</p>}
      {editing === null && compatible.length > 0 ? <>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Manage saved keys</summary>
          <div className="mt-3 space-y-2">{compatible.map((credential) => <div key={credential.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2"><span className="min-w-0 flex-1 truncate">{credential.label}</span><Button type="button" variant="ghost" size="sm" onClick={() => openEditor(credential)} disabled={busy}>Replace</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setDeleteId(credential.id); setError(null); setNotice(null); }} disabled={busy}>Delete</Button></div>)}</div>
        </details>
      </> : null}
      {editing !== null ? <form onSubmit={save} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{hasKey ? issuerFromFile ? "Your Apple key is ready" : "Enter your Apple team’s Issuer ID" : editing === "new" ? isIap ? "Upload an In-App Purchase key" : "Upload an App Store Connect API key" : "Upload the replacement key"}</h3>
          {!hasKey ? <a href={isIap ? "https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/generate-keys-for-in-app-purchases/" : "https://appstoreconnect.apple.com/access/integrations/api"} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-accent-text underline underline-offset-2">Get a key ↗</a> : null}
        </div>
        {!hasKey ? <p className="text-sm text-muted">{isIap ? "Use an In-App Purchase key." : <>Team API key · Access: <strong className="text-fg">App Manager</strong> <span className="text-xs">(Admin also works)</span></>}</p> : null}
        <fieldset disabled={busy} className="space-y-4">
          <label hidden={hasKey} htmlFor={`${fieldId}-file`} className={`${hasKey ? "hidden" : "flex"} relative cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-7 text-center hover:border-accent/60 focus-within:ring-2 focus-within:ring-accent/40`}>
            <ConnectionIcon kind="upload" className="size-6 text-accent-text" />
            <span className="text-sm font-medium">Choose your .p8 file</span>
            <span className="text-xs text-muted" role="status">{reading ? "Reading key…" : ".p8 or credential JSON · up to 16 KB"}</span>
            <input ref={upload} id={`${fieldId}-file`} aria-label="Apple key file" type="file" accept=".p8,.json" onChange={(event) => { void pick(event.target.files?.[0] ?? null); }} className="absolute inset-0 size-full cursor-pointer opacity-0" required />
          </label>
          {hasKey ? <>
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted" role="status"><ConnectionIcon kind="check" className="size-4 shrink-0 text-accent-text" /><span className="min-w-0 flex-1 truncate">{filename}</span><Button type="button" variant="ghost" size="sm" onClick={() => clearUpload()} disabled={busy}>Change</Button></div>
            {issuerFromFile ? <p className="text-xs text-muted">Issuer ID filled from your credential file or saved Apple team.</p> : issuerChoices.length > 1 ? <Field label="Apple team" htmlFor={`${fieldId}-team`}>
              <select id={`${fieldId}-team`} className={inputClass} value={issuerChoices.some((choice) => choice.issuerId === issuerId) ? issuerId : ""} onChange={(event) => { setIssuerId(event.target.value); setIssuerFromFile(!!event.target.value); }}>
                <option value="">Choose a saved team or enter another Issuer ID below</option>
                {issuerChoices.map((choice) => <option key={choice.issuerId} value={choice.issuerId}>{choice.label} · {choice.issuerId.slice(0, 8)}…</option>)}
              </select>
            </Field> : null}
            {!issuerFromFile ? <Field label="Issuer ID" htmlFor={`${fieldId}-issuer`} hint={isIap ? "Copy from above your In-App Purchase keys in Apple." : "Copy from above Team Keys in App Store Connect."}>
              <Input ref={issuerInput} id={`${fieldId}-issuer`} value={issuerId} onChange={(event) => setIssuerId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required maxLength={36} autoComplete="off" autoCapitalize="none" spellCheck={false} className="font-mono text-xs" aria-describedby={`${fieldId}-issuer-hint`} />
            </Field> : null}
            {!inferredKeyId ? <Field label="Key ID" htmlFor={`${fieldId}-key`} hint="Your file was renamed. Copy the Key ID from Apple.">
              <Input id={`${fieldId}-key`} value={keyId} onChange={(event) => setKeyId(event.target.value.toUpperCase())} maxLength={10} required autoComplete="off" spellCheck={false} className="font-mono" />
            </Field> : null}
            <Button type="submit" loading={busy} disabled={reading || !label.trim() || !keyId.trim() || !issuerId.trim()}>{isIap ? "Save test notification key" : "Load my iOS apps →"}</Button>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Key details</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Connection name" htmlFor={`${fieldId}-label`}><Input id={`${fieldId}-label`} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} autoComplete="off" /></Field>
                <Field label="Key ID" htmlFor={`${fieldId}-key-edit`}><Input id={`${fieldId}-key-edit`} value={keyId} onChange={(event) => setKeyId(event.target.value.toUpperCase())} maxLength={10} autoComplete="off" spellCheck={false} className="font-mono" /></Field>
                {issuerFromFile ? <Field label="Issuer ID" htmlFor={`${fieldId}-issuer-edit`}><Input id={`${fieldId}-issuer-edit`} value={issuerId} onChange={(event) => setIssuerId(event.target.value)} maxLength={36} autoComplete="off" spellCheck={false} className="font-mono text-xs" /></Field> : null}
              </div>
            </details>
            <p className="text-xs text-muted">Your key is stored encrypted.</p>
          </> : <details className="text-xs text-muted">
            <summary className="cursor-pointer">Where do I get this key?</summary>
            <p className="mt-2 leading-relaxed">Users and Access → Integrations → {isIap ? "In-App Purchase" : "App Store Connect API → Team Keys"}. {isIap ? "An Account Holder or Admin can generate the key." : "An Account Holder or Admin can create a team key. Choose App Manager for Access. Individual and APNs keys aren't supported."}</p>
          </details>}
        </fieldset>
        {credentials?.length ? <Button type="button" variant="ghost" size="sm" onClick={closeEditor} disabled={busy}>Use a saved key instead</Button> : null}
      </form> : null}
      {deleteId ? <div className="space-y-3">
        <Alert tone="warn">Delete this saved key? Salebell won&apos;t be able to use it for future Apple setup. Existing app notification URLs are kept. Revoke the key in Apple as well if you want to remove its Apple permissions.</Alert>
        <div className="flex gap-2"><Button type="button" variant="danger" size="sm" loading={busy} onClick={remove}>Delete saved key</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeleteId(null)}>Keep key</Button></div>
      </div> : null}
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="neutral">{notice}</Alert> : null}
    </div>
  );
}
