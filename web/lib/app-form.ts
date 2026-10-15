export type AppStore = "app_store" | "play_store";

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9.-]*[A-Za-z0-9]$/;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function appDetailsError(store: AppStore, identifier: string, appleId = ""): string | null {
  if (store === "play_store") return identifier.trim().length <= 255 && PACKAGE_NAME.test(identifier.trim()) ? null : "Use the package name from Google Play Console, like com.example.app (up to 255 characters).";
  if (!BUNDLE_ID.test(identifier.trim())) return "Use the reverse-DNS bundle ID, like com.example.app.";
  if (appleId.trim() && !/^\d{6,12}$/.test(appleId.trim())) return "The Apple ID is a number, like 1234567890.";
  return null;
}

export function newAppPayload(accountId: string, store: AppStore, name: string, identifier: string, appleId = "") {
  const error = appDetailsError(store, identifier, appleId);
  if (error) throw new Error(error);
  return {
    account_id: accountId, name: name.trim(), store, bundle_id: identifier.trim(),
    package_name: store === "play_store" ? identifier.trim() : null,
    apple_app_id: store === "app_store" && appleId.trim() ? Number(appleId.trim()) : null,
  };
}
