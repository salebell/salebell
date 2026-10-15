import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export function findSavedAppleApp<T extends { bundle_id: string; store: string }>(apps: readonly T[], bundleId: string | undefined): T | undefined {
  return apps.find((app) => app.store === "app_store" && app.bundle_id === bundleId);
}

export function loadSavedAppleApp(client: SupabaseClient<Database>, accountId: string, bundleId: string) {
  return client.from("apps").select("id,bundle_id,apple_app_id")
    .eq("account_id", accountId).eq("store", "app_store").eq("bundle_id", bundleId).maybeSingle();
}

export type SavedAppleCredential = {
  id: string;
  provider: "apple_connect" | "apple_iap";
  label: string;
  key_id: string;
  issuer_id: string;
  created_at: string;
  updated_at: string;
};

export type AppleApp = {
  apple_app_id: string;
  name: string;
  bundle_id: string;
  production_url: string | null;
  sandbox_url: string | null;
  production_version: string | null;
  sandbox_version: string | null;
};

export type AppleConnectionPreview = {
  app_id: string;
  apple_app_id: string;
  bundle_id: string;
  current: {
    production_url: string | null;
    sandbox_url: string | null;
    production_version: string | null;
    sandbox_version: string | null;
  };
  target: { production_url: string; sandbox_url: string };
  forwarding: { production_url: string | null; sandbox_url: string | null };
  expected_forwarding: { production_url: string | null; sandbox_url: string | null };
  already_configured: boolean;
};
