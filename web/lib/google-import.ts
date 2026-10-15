import type { SupabaseClient } from "@supabase/supabase-js";
import { appDetailsError } from "./app-form.ts";
import type { Database } from "./database.types.ts";
import type { GoogleCredentials } from "./google-connect.ts";

export type GoogleDiscoveredApp = { package_name: string; display_name: string };
export type GoogleDiscoveryPage = { apps: GoogleDiscoveredApp[]; next_cursor: string | null };
const validCursor = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);

/** Only return validated metadata; never include raw discovery responses in errors. */
export function parseGoogleDiscoveryPage(value: unknown): GoogleDiscoveryPage {
  const invalid = () => new Error("Couldn't read the Google Play app list. Try again.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.apps) || !(page.next_cursor === null || validCursor(page.next_cursor))) throw invalid();
  const apps = page.apps.map((value): GoogleDiscoveredApp => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const app = value as Record<string, unknown>;
    if (typeof app.package_name !== "string" || !app.package_name.trim() || appDetailsError("play_store", app.package_name) || typeof app.display_name !== "string" || app.display_name.length > 500) throw invalid();
    const packageName = app.package_name.trim();
    return { package_name: packageName, display_name: app.display_name.trim() || packageName };
  });
  return { apps, next_cursor: page.next_cursor };
}

export function buildGoogleDiscoverRequest(accountId: string, credentials: GoogleCredentials, cursor?: string) {
  if (cursor !== undefined && !validCursor(cursor)) throw new Error("That app-list page is invalid. Load your Android apps again.");
  return { action: "discover" as const, account_id: accountId, credentials, ...(cursor ? { cursor } : {}) };
}

export function findSavedGoogleApp<T extends { account_id: string; store: string; package_name: string | null }>(apps: readonly T[], accountId: string, packageName: string): T | undefined {
  return apps.find((app) => app.account_id === accountId && app.store === "play_store" && app.package_name === packageName);
}

export function loadSavedGoogleApp(client: SupabaseClient<Database>, accountId: string, packageName: string) {
  return client.from("apps").select("*")
    .eq("account_id", accountId).eq("store", "play_store").eq("package_name", packageName).maybeSingle();
}

export function googleImportedAppName(app: GoogleDiscoveredApp): string {
  // Avoid leaving half of a surrogate pair when an emoji crosses the input limit.
  return (app.display_name.trim() || app.package_name).slice(0, 100).replace(/[\uD800-\uDBFF]$/, "");
}
