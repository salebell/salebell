export type PlanLimit = "apps" | "channels" | "history" | "export";

type ErrorLike = { message?: string; code?: string; details?: string } | null | undefined;

/** Recognises the backend's plan-limit errors (`plan_limit:apps`, `plan_limit:channels`). */
export function planLimitOf(error: ErrorLike): PlanLimit | null {
  const text = `${error?.message ?? ""} ${error?.details ?? ""}`;
  const match = text.match(/plan_limit:(apps|channels)/);
  return match ? (match[1] as PlanLimit) : null;
}

export function friendlyError(error: ErrorLike, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  if (error.code === "23505") return "That already exists. Bundle IDs must be unique within your workspace.";
  if (error.code === "23514") return "One of the values isn't allowed. Check the fields and try again.";
  if (error.code === "42501") return "You don't have permission to do that. Ask the workspace owner.";
  if (error.message?.includes("Failed to fetch")) return "Can't reach Salebell. Check your connection and try again.";
  return error.message || fallback;
}

// Error codes the edge functions return, in words a customer can act on.
const FUNCTION_ERRORS: Record<string, string> = {
  unauthorized: "Your session expired. Sign in again.",
  owner_only: "Only the workspace owner can manage billing.",
  already_pro: "This workspace is already on Pro.",
  no_customer: "There's no subscription to manage yet.",
  billing_not_configured: "Billing isn't switched on yet. Please try again later.",
  invalid_key_id: "The Key ID should be 10 letters and numbers, like ABCDE12345.",
  invalid_issuer_id: "The Issuer ID should look like 57246542-96fe-1a63-e053-0824d011072a.",
  invalid_private_key: "That doesn't look like a valid Apple private key file (.p8).",
  admin_required: "Only workspace owners and admins can manage saved Apple keys and automatic setup.",
  invalid_account_id: "Couldn't identify your workspace. Reload the page and try again.",
  invalid_app_id: "Couldn't identify that app. Reload the page and try again.",
  invalid_credential_id: "Choose a saved Apple connection, or upload a new one.",
  credential_not_found: "That saved Apple connection is no longer available. Choose another one or upload a new key.",
  credential_storage_unavailable: "Saved Apple connections are temporarily unavailable. Please try again later.",
  credential_limit: "This workspace has 20 saved Apple connections. Replace or delete an existing connection before adding another.",
  invalid_credentials: "Check the Apple connection name, Key ID, Issuer ID and private key file.",
  invalid_credential_label: "Give the Apple connection a name of 100 characters or fewer.",
  invalid_provider: "Choose the correct Apple key type for this step.",
  credential_provider_mismatch: "This saved key is for a different Apple API. Choose the correct key type for this step.",
  apple_rejected_key: "Apple rejected the key. Check its key type, Key ID and Issuer ID, or replace the saved key.",
  apple_permission_denied: "This Apple key can't manage the app. Use an App Store Connect team API key with Access set to App Manager or Admin.",
  apple_app_not_found: "Apple couldn't find this app for that key. Check the key's app access.",
  apple_unavailable: "Apple is temporarily unavailable. Please try again later.",
  apple_invalid_response: "Apple returned an unexpected response. Please try again later.",
  apple_rate_limited: "Apple is limiting requests. Wait a few minutes before trying again.",
  apple_connect_not_configured: "Automatic Apple setup isn't switched on yet. You can use manual setup in the meantime.",
  apple_app_id_required: "Import this app from Apple, or add its numeric Apple ID in Settings first.",
  apple_app_mismatch: "The Apple app doesn't match this bundle ID. Check the app details before continuing.",
  forwarding_requires_manual_setup: "Your existing server needs manual setup. Keep it connected under Your server, then save both URLs in Apple.",
  notification_v1_requires_manual_setup: "Apple currently uses Version 1 notifications. Review your existing server's Version 2 support and use manual setup to migrate it.",
  forwarding_conflict: "Apple's server URLs differ from the ones you've saved. Review Your server and continue with manual setup.",
  preview_changed: "Apple or your server settings changed. Try connecting again to review the latest settings.",
  apple_configuration_unconfirmed: "Apple may have saved these settings. Try connecting again to check.",
  invalid_cursor: "Couldn't load the next page of Apple apps. Refresh the app list and try again.",
  rate_limit_unavailable: "Automatic Apple setup is temporarily unavailable. Please try again later.",
  internal_error: "Couldn't complete that request. Please try again.",
  "app not found": "That app wasn't found in your workspace.",
  "channel not found": "That integration no longer exists. Reload the page.",
};

/** A delivery failure (test alert or alert_deliveries row) in plain words. */
export function deliveryError(error: string | null | undefined, status?: number | null): string {
  const http = error?.match(/^http_(\d{3})$/)?.[1] ?? (status && status >= 300 ? String(status) : null);
  if (http) return `Your server returned ${http}`;
  switch (error) {
    case "connection_failed":
      return "Couldn't connect";
    case "timeout":
      return "Timed out";
    case "blocked_destination":
      return "That address isn't allowed";
    case "paused_on_free":
    case "plan_limit:channels":
      return "Paused on the Free plan";
    default:
      return error || "Unknown error";
  }
}

/** Reads `{ error | message }` from a failed supabase.functions.invoke call. */
export async function functionError(error: unknown, fallback: string) {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.clone().json();
      const message = body?.error ?? body?.message;
      if (message === "rate_limited") {
        const wait = Number(body?.retry_after);
        return wait > 0 ? `Slow down, try again in ${Math.ceil(wait)}s.` : "Slow down, try again in a minute.";
      }
      if (typeof message === "string") return FUNCTION_ERRORS[message] ?? message;
    } catch {
      // Not JSON; fall through.
    }
  }
  return (error as Error)?.message || fallback;
}
