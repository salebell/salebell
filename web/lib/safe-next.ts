/**
 * Where to go after sign-in. Only same-origin paths are allowed: anything that resolves to another
 * origin (`//evil.com`, `/\evil.com`, `https://evil.com`, `javascript:`) falls back to /app.
 */
export function safeNext(next: string | null | undefined, origin: string, fallback = "/app"): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, origin);
    if (url.origin !== origin) return fallback;
    // Sending an authenticated user back to sign-in would create a redirect loop.
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname === "/login" || pathname === "/auth/callback") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
