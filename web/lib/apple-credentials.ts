export const MAX_APPLE_CREDENTIAL_BYTES = 16_384;

export type AppleCredentials = {
  key_id: string;
  issuer_id: string;
  private_key: string;
};

const KEY_ID = /^[A-Z0-9]{10}$/;
const ISSUER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PRIVATE_KEY = /^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+\s+-----END PRIVATE KEY-----$/;

export function appleKeyIdFromFilename(name: string): string {
  return name.match(/^(?:AuthKey|SubscriptionKey)_([A-Z0-9]{10})\.p8$/i)?.[1].toUpperCase() ?? "";
}

export function appleCredentialMetadataError(keyId: string, issuerId: string): string | null {
  if (!KEY_ID.test(keyId.trim())) return "Enter the 10-character Key ID shown in App Store Connect.";
  if (!ISSUER_ID.test(issuerId.trim())) return "Enter the Issuer ID shown above your Apple keys in App Store Connect.";
  return null;
}

/** Read only the supported Apple key fields; never include file contents in an error. */
export function parseAppleCredentialFile(name: string, text: string): Partial<AppleCredentials> & { private_key: string } {
  if (new TextEncoder().encode(text).length > MAX_APPLE_CREDENTIAL_BYTES) {
    throw new Error("That file is too large. Choose an Apple .p8 key or a credential JSON file under 16 KB.");
  }

  let keyId = appleKeyIdFromFilename(name);
  let issuerId = "";
  let privateKey = text;
  if (/\.json$/i.test(name)) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("Couldn't read that JSON file. Use a credential file with key_id, issuer_id and private_key (or key).");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The credential JSON must contain key_id, issuer_id and private_key (or key).");
    }
    const fields = value as Record<string, unknown>;
    const key = fields.key_id ?? fields.keyId;
    const issuer = fields.issuer_id ?? fields.issuerId;
    const secret = fields.private_key ?? fields.privateKey ?? fields.key;
    if (typeof key !== "string" || typeof issuer !== "string" || typeof secret !== "string") {
      throw new Error("The credential JSON must contain key_id, issuer_id and private_key (or key).");
    }
    keyId = key.trim().toUpperCase();
    issuerId = issuer.trim();
    privateKey = secret;
    if (fields.is_key_content_base64 === true) {
      try {
        privateKey = atob(privateKey);
      } catch {
        throw new Error("Couldn't read the encoded private key in that JSON file.");
      }
    }
    const metadataError = appleCredentialMetadataError(keyId, issuerId);
    if (metadataError) throw new Error(metadataError);
  } else if (!/\.p8$/i.test(name)) {
    throw new Error("Choose an Apple .p8 key file or a credential JSON file.");
  }

  privateKey = privateKey.trim().replace(/\r\n/g, "\n");
  if (!PRIVATE_KEY.test(privateKey) || privateKey.length < 100 || privateKey.length > 4_000) {
    throw new Error("That file doesn't contain a valid .p8 private key. Download the appropriate key from App Store Connect.");
  }
  return { key_id: keyId || undefined, issuer_id: issuerId || undefined, private_key: privateKey };
}
