"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { AddAppForm } from "./add-app-form";
import { AppleConnect } from "./apple-connect";
import { GoogleImport } from "./google-import";
import { PlatformCards } from "./platform-cards";
import { useLoadedWorkspace } from "./workspace";
import type { AppStore } from "@/lib/app-form";

export function AddAppOptions() {
  const { canManage } = useLoadedWorkspace();
  const [importing, setImporting] = useState(true);
  const [store, setStore] = useState<AppStore>("app_store");
  const [googleImporting, setGoogleImporting] = useState(true);
  if (!canManage) return <Alert tone="neutral">Ask your workspace owner or an admin to add an app.</Alert>;
  return (
    <div className="space-y-6">
      <PlatformCards value={store} onChange={setStore} />
      {store === "play_store" ? googleImporting ? <GoogleImport onCancel={() => setGoogleImporting(false)} /> : <div className="space-y-4"><h2 className="text-lg font-semibold tracking-tight">Add your Android app</h2><p className="text-sm text-muted">Enter your package name, then upload a service-account JSON key to connect Google Play notifications through Pub/Sub.</p><AddAppForm key="google" store="play_store" /><Button type="button" variant="ghost" size="sm" onClick={() => setGoogleImporting(true)}>Import from Google Play</Button></div> : importing ? <AppleConnect onCancel={() => setImporting(false)} /> : <>
        <AddAppForm />
        <Button type="button" variant="ghost" size="sm" onClick={() => setImporting(true)}>Import from App Store Connect</Button>
      </>}
    </div>
  );
}
