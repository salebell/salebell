"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeader } from "@/components/app/page-header";
import { useLoadedWorkspace } from "@/components/app/workspace";
import { IphoneAppNote } from "@/components/iphone-app";
import { LogoMark } from "@/components/logo";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { IOS_APP_URL } from "@/lib/env";
import { friendlyError, functionError } from "@/lib/errors";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function AccountPage() {
  const router = useRouter();
  const { ws, isSelfHosted, refresh } = useLoadedWorkspace();
  const [workspaceName, setWorkspaceName] = useState(ws.account.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = ws.role === "owner";

  async function rename(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(null);
    const { error } = await supabaseBrowser().from("accounts").update({ name: workspaceName.trim() }).eq("id", ws.account.id);
    setSaving(false);
    if (error) return setError(friendlyError(error));
    setSaved("Saved.");
    refresh();
  }

  async function signOut() {
    setSigningOut(true);
    await supabaseBrowser().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (confirm !== "DELETE") return;
    setDeleting(true);
    setError(null);
    const { error } = await supabaseBrowser().functions.invoke("delete-account", { body: {} });
    if (error) {
      setDeleting(false);
      return setError(await functionError(error, "We couldn't delete your account. Please try again."));
    }
    await supabaseBrowser().auth.signOut();
    router.replace("/?deleted=1");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Account" description={ws.user.email} />

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="font-semibold">Signed in as</h2>
          <p className="mt-0.5 break-all text-sm text-muted">{ws.user.email}</p>
        </div>
        <Button variant="secondary" loading={signingOut} onClick={signOut}>
          Sign out
        </Button>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="font-semibold">Workspace</h2>
        <form onSubmit={rename} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Workspace name" htmlFor="ws-name">
              <Input id="ws-name" required maxLength={100} value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} disabled={!isOwner} />
            </Field>
          </div>
          {isOwner && (
            <Button type="submit" variant="secondary" loading={saving} disabled={workspaceName.trim() === ws.account.name || !workspaceName.trim()}>
              Save
            </Button>
          )}
        </form>
        {saved && <p className="mt-2 text-sm text-accent-text" role="status">{saved}</p>}
      </Card>

      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <LogoMark className="size-14 shrink-0 rounded-2xl" />
        <div className="flex-1">
          <h2 className="font-semibold">Get the iPhone app</h2>
          <p className="mt-1 text-sm text-muted">
            {IOS_APP_URL ? (
              `Install Salebell, sign in with ${ws.user.email} and allow notifications. A cha-ching arrives on every in-app purchase.`
            ) : (
              <IphoneAppNote />
            )}
          </p>
        </div>
        {IOS_APP_URL && (
          <a href={IOS_APP_URL} className="inline-flex h-10 items-center justify-center rounded-lg bg-fg px-4 text-sm font-medium text-bg hover:opacity-90">
            Download on the App Store
          </a>
        )}
      </Card>

      <Card className="border-danger/35 p-5 sm:p-6">
        <h2 className="font-semibold text-danger">Delete account</h2>
        <p className="mt-1 text-sm text-muted">
          Deletes your sign-in and every workspace you solely own, with all apps, events, integrations and devices.{" "}
          {!isSelfHosted && "Any Pro subscription is canceled automatically. "}This can&apos;t be undone.
        </p>
        <form onSubmit={deleteAccount} className="mt-4 space-y-3">
          <Field label="Type DELETE to confirm" htmlFor="confirm-account-delete">
            <Input id="confirm-account-delete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="danger" loading={deleting} disabled={confirm !== "DELETE"}>
            Delete my account
          </Button>
        </form>
      </Card>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
