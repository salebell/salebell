import { safeNext } from "./safe-next.ts";

/** Choose an authentication redirect without changing public-page access. */
export function authRedirect(requestUrl: URL, signedIn: boolean): URL | null {
  const { pathname, search, origin } = requestUrl;

  if (!signedIn && (pathname === "/app" || pathname.startsWith("/app/"))) {
    const url = new URL("/login", origin);
    url.searchParams.set("next", pathname + search);
    return url;
  }
  if (signedIn && pathname === "/login") {
    return new URL(safeNext(requestUrl.searchParams.get("next"), origin), origin);
  }
  if (signedIn && pathname === "/") {
    const url = new URL(requestUrl);
    url.pathname = "/app";
    return url;
  }
  return null;
}
