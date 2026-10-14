"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Account, AppRow } from "@/lib/database.types";
import { friendlyError } from "@/lib/errors";
import { FREE_LIMITS } from "@/lib/plans";
import { hasFullFeatures, instanceSettings, type InstanceSettings } from "@/lib/deployment";
import { supabaseBrowser } from "@/lib/supabase/client";

type Role = "owner" | "admin" | "member";

export type Workspace = {
  user: { id: string; email: string };
  account: Account;
  role: Role;
  apps: AppRow[];
  instance: InstanceSettings;
};

type Ctx = {
  ws: Workspace | null;
  error: string | null;
  refresh: () => Promise<void>;
  patchApp: (id: string, patch: Partial<AppRow>) => void;
  removeApp: (id: string) => void;
};

const WorkspaceContext = createContext<Ctx | null>(null);

async function load(): Promise<Workspace> {
  const supabase = supabaseBrowser();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("signed_out");
  const user = { id: auth.user.id, email: auth.user.email ?? "" };

  // The auth.users trigger creates the workspace in the same transaction as the user, so it is there on first load.
  const { data: member, error: memberError } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(friendlyError(memberError));
  if (!member) throw new Error("We couldn't find a workspace for your account. Try reloading in a moment.");

  const [{ data: account, error: accountError }, { data: apps, error: appsError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("accounts").select("*").eq("id", member.account_id).single(),
    supabase.from("apps").select("*").eq("account_id", member.account_id).order("created_at").order("id"),
    supabase.rpc("instance_settings"),
  ]);
  if (accountError || !account) throw new Error(friendlyError(accountError));
  if (appsError) throw new Error(friendlyError(appsError));
  if (settingsError) throw new Error("Couldn't load instance settings. Apply the latest database migrations and reload.");
  return { user, account, role: member.role as Role, apps: apps ?? [], instance: instanceSettings(settings) };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWs(await load());
      setError(null);
    } catch (e) {
      if ((e as Error).message === "signed_out") {
        router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      setError((e as Error).message);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    refresh();
  }, [refresh]);

  const patchApp = useCallback((id: string, patch: Partial<AppRow>) => {
    setWs((cur) => (cur ? { ...cur, apps: cur.apps.map((a) => (a.id === id ? { ...a, ...patch } : a)) } : cur));
  }, []);

  const removeApp = useCallback((id: string) => {
    setWs((cur) => (cur ? { ...cur, apps: cur.apps.filter((app) => app.id !== id) } : cur));
  }, []);

  const value = useMemo(() => ({ ws, error, refresh, patchApp, removeApp }), [ws, error, refresh, patchApp, removeApp]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace outside WorkspaceProvider");
  return ctx;
}

/** Workspace that has loaded; only call below the shell's loading gate. */
export function useLoadedWorkspace() {
  const { ws, ...rest } = useWorkspace();
  if (!ws) throw new Error("Workspace not loaded");
  const isSelfHosted = ws.instance.deploymentMode === "self_hosted";
  const isPro = hasFullFeatures(ws.account.plan, ws.instance);
  const canManage = ws.role === "owner" || ws.role === "admin";
  // After a downgrade only the oldest N apps stay active at dispatch time (docs/PRODUCT.md section 5).
  const pausedAppIds = new Set(isPro ? [] : ws.apps.filter((a) => a.enabled).slice(FREE_LIMITS.apps).map((a) => a.id));
  return { ws, isPro, isSelfHosted, billingEnabled: ws.instance.billingEnabled, canManage, pausedAppIds, ...rest };
}
