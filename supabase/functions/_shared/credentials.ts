import type { ServiceClient } from "./supabase.ts";

export type AppleCredentialProvider = "apple_connect" | "apple_iap";
export type AppleCredentials = { key_id: string; issuer_id: string; private_key: string };
export type AppleCredentialMetadata = {
  id: string; label: string; provider: AppleCredentialProvider; key_id: string; issuer_id: string;
  created_at: string; updated_at: string;
};

/** Server-only: the RPC authorizes the verified caller and decrypts the selected Vault secret. */
export async function loadAppleCredentials(
  db: ServiceClient, credentialId: string, accountId: string, userId: string,
  provider: AppleCredentialProvider = "apple_connect",
): Promise<AppleCredentials | null> {
  return db.rpc<AppleCredentials | null>("load_apple_credential", {
    p_id: credentialId, p_account: accountId, p_user: userId, p_provider: provider,
  });
}

/** Validate the supported EC signing-key format without sending it to Apple. */
export async function validApplePrivateKey(value: string): Promise<boolean> {
  if (!value.trim().startsWith("-----BEGIN PRIVATE KEY-----") || value.length > 4_000) return false;
  try {
    const base64 = value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
    const der = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    return true;
  } catch { return false; }
}
