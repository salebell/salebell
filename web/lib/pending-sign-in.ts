// Matches auth.email.otp_expiry (900 s) in supabase/config.toml.
export const CODE_MINUTES = 15;
export const RESEND_SECONDS = 60;
export const PENDING_SIGN_IN_KEY = "salebell:sign-in:v1";

export type PendingSignIn = { email: string; sentAt: number };

/** Restore only an unexpired code request; never persist the code or a password. */
export function pendingSignIn(raw: string | null, now = Date.now()): PendingSignIn | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingSignIn> | null;
    if (
      !value ||
      typeof value.email !== "string" ||
      !value.email.trim() ||
      typeof value.sentAt !== "number" ||
      !Number.isFinite(value.sentAt) ||
      value.sentAt > now ||
      now - value.sentAt >= CODE_MINUTES * 60_000
    ) return null;
    return { email: value.email, sentAt: value.sentAt };
  } catch {
    return null;
  }
}

export function resendIn(sentAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));
}
