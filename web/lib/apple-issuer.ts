import type { SavedAppleCredential } from "./apple-connect.ts";

type Metadata = Pick<SavedAppleCredential, "key_id" | "issuer_id" | "label">;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cacheKey = (accountId: string) => `salebell:apple-issuer:v1:${accountId}`;

export function appleIssuerChoices(credentials: Metadata[]) {
  const choices = new Map<string, { issuerId: string; label: string }>();
  for (const credential of credentials) {
    const issuerId = credential.issuer_id.trim().toLowerCase();
    if (UUID.test(issuerId) && !choices.has(issuerId)) choices.set(issuerId, { issuerId, label: credential.label });
  }
  return [...choices.values()];
}

/** Reuse a known key's team, or a single saved team. Never guess between teams. */
export function suggestedAppleIssuer(credentials: Metadata[], keyId = "", remembered: string | null = null): string | null {
  const matches = appleIssuerChoices(credentials.filter((credential) => credential.key_id === keyId && keyId !== ""));
  if (matches.length) return matches.length === 1 ? matches[0].issuerId : null;
  const choices = appleIssuerChoices(credentials);
  if (choices.length) return choices.length === 1 ? choices[0].issuerId : null;
  return remembered && UUID.test(remembered) ? remembered.toLowerCase() : null;
}

/** Only the non-secret team identifier is cached; keys always remain in Vault or memory. */
export function rememberedAppleIssuer(accountId: string): string | null {
  try {
    const issuerId = localStorage.getItem(cacheKey(accountId));
    return issuerId && UUID.test(issuerId) ? issuerId.toLowerCase() : null;
  } catch { return null; }
}

export function rememberAppleIssuer(accountId: string, issuerId: string) {
  if (!UUID.test(issuerId.trim())) return;
  try { localStorage.setItem(cacheKey(accountId), issuerId.trim().toLowerCase()); }
  catch { /* Saved connection metadata still works when browser storage is unavailable. */ }
}
