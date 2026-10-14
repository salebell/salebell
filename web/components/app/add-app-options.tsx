"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { AddAppForm } from "./add-app-form";
import { AppleConnect } from "./apple-connect";
import { PlatformCards } from "./platform-cards";
import { useLoadedWorkspace } from "./workspace";

export function AddAppOptions() {
  const { canManage } = useLoadedWorkspace();
  const [importing, setImporting] = useState(true);
  if (!canManage) return <Alert tone="neutral">Ask your workspace owner or an admin to add an app.</Alert>;
  return (
    <div className="space-y-6">
      <PlatformCards />
      {importing ? <AppleConnect onCancel={() => setImporting(false)} /> : <>
        <AddAppForm />
        <Button type="button" variant="ghost" size="sm" onClick={() => setImporting(true)}>Import from App Store Connect</Button>
      </>}
    </div>
  );
}
