export const MAX_GOOGLE_CREDENTIAL_BYTES = 32_768;

export type GoogleCredentials = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
  private_key_id?: string;
  client_id?: string;
};

export type GoogleConnection = {
  topic: string | null;
  subscription: string;
  audience: string;
  service_account_email: string;
  updated_at: string;
};

export type GoogleConnectionStatus = { connection: GoogleConnection | null; verified: boolean };
export type GoogleSetupMode = "automatic" | "manual";
export type GoogleManualFields = { topic: string; subscription: string; serviceAccountEmail: string };

const SERVICE_ACCOUNT_EMAIL = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PRIVATE_KEY = /^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----$/;
const RESOURCE = /^projects\/[A-Za-z0-9][A-Za-z0-9.:-]*\/(topics|subscriptions)\/[A-Za-z][A-Za-z0-9._~+%\-]{2,254}$/;

/** Validate locally without including any uploaded secret in an error. The server validates the RSA key. */
export function parseGoogleCredentialFile(name: string, text: string): GoogleCredentials {
  if (new TextEncoder().encode(text).length > MAX_GOOGLE_CREDENTIAL_BYTES) throw new Error("Choose a service-account JSON file under 32 KB.");
  if (!/\.json$/i.test(name)) throw new Error("Choose the JSON key downloaded for your Google service account.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Couldn't read that JSON file. Download a new service-account JSON key from Google Cloud."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a Google service-account JSON key.");
  const fields = value as Record<string, unknown>;
  if (fields.type !== "service_account" || typeof fields.project_id !== "string" || !PROJECT_ID.test(fields.project_id.trim()) || typeof fields.client_email !== "string" || !SERVICE_ACCOUNT_EMAIL.test(fields.client_email.trim())) {
    throw new Error("The JSON must contain service_account credentials with a project ID and service-account email.");
  }
  const privateKey = typeof fields.private_key === "string" ? fields.private_key.trim().replace(/\r\n/g, "\n") : "";
  if (!PRIVATE_KEY.test(privateKey) || privateKey.length < 100 || privateKey.length > 16_384) throw new Error("The JSON doesn't contain a valid private key. Download a new service-account key from Google Cloud.");
  return {
    type: "service_account", project_id: fields.project_id.trim(), client_email: fields.client_email.trim(), private_key: privateKey,
    ...(typeof fields.private_key_id === "string" ? { private_key_id: fields.private_key_id } : {}),
    ...(typeof fields.client_id === "string" ? { client_id: fields.client_id } : {}),
  };
}

export function googleManualError(fields: GoogleManualFields): string | null {
  if (!RESOURCE.test(fields.topic.trim()) || !fields.topic.trim().includes("/topics/")) return "Enter the full topic name, like projects/example-project/topics/play-events.";
  if (!RESOURCE.test(fields.subscription.trim()) || !fields.subscription.trim().includes("/subscriptions/")) return "Enter the full subscription name, like projects/example-project/subscriptions/play-events-push.";
  if (fields.serviceAccountEmail.trim() && !SERVICE_ACCOUNT_EMAIL.test(fields.serviceAccountEmail.trim())) return "Enter a Google service-account email for authenticated push.";
  return null;
}

export function buildGoogleConfigureRequest(appId: string, credentials: GoogleCredentials, mode: GoogleSetupMode, fields: GoogleManualFields) {
  const base = { action: "configure" as const, app_id: appId, credentials, mode };
  if (mode === "automatic") return base;
  const error = googleManualError(fields);
  if (error) throw new Error(error);
  return { ...base, topic: fields.topic.trim(), subscription: fields.subscription.trim(), ...(fields.serviceAccountEmail.trim() ? { service_account_email: fields.serviceAccountEmail.trim() } : {}) };
}

export function googleConnectionVerified(connection: Pick<GoogleConnection, "updated_at"> | null, app: { last_event_production_at: string | null; last_event_sandbox_at: string | null }): boolean {
  if (!connection) return false;
  const configuredAt = Date.parse(connection.updated_at);
  return Number.isFinite(configuredAt) && [app.last_event_production_at, app.last_event_sandbox_at].some((at) => at !== null && Date.parse(at) >= configuredAt);
}

const ERRORS: Record<string, string> = {
  unauthorized: "Your session expired. Sign in again.",
  admin_required: "Ask your workspace owner or an admin to manage the Google connection.",
  invalid_credentials: "Choose a valid Google service-account JSON key. If it was revoked, download a new key.",
  invalid_google_credentials: "Choose a valid Google service-account JSON key. If it was revoked, download a new key.",
  google_invalid_credentials: "Choose a valid Google service-account JSON key. If it was revoked, download a new key.",
  google_api_permission_denied: "Google denied permission. Review the automatic setup prerequisites below, or use advanced manual setup with an existing Pub/Sub subscription.",
  google_api_not_enabled: "Enable the Pub/Sub API, IAM API and Cloud Resource Manager API for automatic setup, plus the Google Play Android Developer API for purchase lookups, then try again.",
  google_resource_conflict: "A Pub/Sub resource already exists with different settings. Review it in Google Cloud or use advanced manual setup.",
  google_setup_unavailable: "Google setup is temporarily unavailable. Try again later.",
  receiver_not_configured: "This Salebell instance's Google receiver isn't configured. Ask the instance administrator to enable it.",
  credential_storage_unavailable: "Encrypted credential storage is unavailable. Ask the instance administrator to configure it.",
  preview_changed: "This app's settings changed. Reload the page and try connecting again.",
  app_not_found: "This app is no longer available in your workspace.",
  invalid_google_connection: "Check the topic, subscription and authenticated push details.",
  invalid_topic: "Enter the full Pub/Sub topic resource name.",
  invalid_subscription: "Enter the full Pub/Sub subscription resource name.",
  google_discovery_unavailable: "Google's app list is temporarily unavailable. Try again, or enter the package name manually.",
  google_invalid_cursor: "That app-list page expired. Load your Android apps again.",
};

export function googleSetupError(code: string | undefined): string {
  return (code && ERRORS[code]) || "Couldn't complete Google setup. Try again.";
}

export async function googleFunctionError(error: unknown, purpose: "setup" | "discover" = "setup"): Promise<string> {
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.clone().json();
      if (body?.error === "rate_limited") return "Too many setup requests. Wait a minute and try again.";
      if (purpose === "discover" && body?.error === "google_api_not_enabled") return "Enable the Google Play Developer Reporting API (playdeveloperreporting.googleapis.com) in this service account's Google Cloud project, then load your apps again. You can also enter the package name manually.";
      if (purpose === "discover" && body?.error === "google_api_permission_denied") return "This service account can't list your Play apps. Invite its email in Play Console and grant app-information access to the apps you want to import, then try again. You can also enter the package name manually.";
      return googleSetupError(typeof body?.error === "string" ? body.error : undefined);
    } catch { /* Never display raw provider responses or credential details. */ }
  }
  return "Couldn't reach Google setup. Check your connection and try again.";
}
