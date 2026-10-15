import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PendingOAuth, Provider } from "./installer-types.ts";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export function equalSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
}
export function seal(value: unknown, key: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function unseal<T>(value: string, key: string, context: string): T {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
export function newState(provider: Provider, now = Date.now()) {
  const value = randomToken();
  return { value, pending: { provider, hash: digest(value), expires: now + 600_000 } satisfies PendingOAuth };
}
export function consumeState(pending: PendingOAuth | undefined, value: string, provider: Provider, now = Date.now()): undefined {
  if (!pending || pending.provider !== provider || now >= pending.expires || !equalSecret(pending.hash, digest(value))) {
    throw new Error("oauth_state_invalid");
  }
  return undefined;
}
