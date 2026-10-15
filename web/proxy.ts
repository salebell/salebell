import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authRedirect } from "./lib/auth-redirect";
import { initialInstallRedirect } from "./lib/installer-bootstrap";

// Refreshes the session, guards /app/**, and takes returning users to their apps.
export async function proxy(request: NextRequest) {
  const setup = await initialInstallRedirect(request.nextUrl, process.env);
  if (setup) return NextResponse.redirect(setup);
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const destination = authRedirect(request.nextUrl, signedIn);
  if (destination) {
    const redirectResponse = NextResponse.redirect(destination);
    // A token may have been refreshed during getClaims; keep those cookies on redirects too.
    for (const cookie of response.cookies.getAll()) redirectResponse.cookies.set(cookie);
    return redirectResponse;
  }
  return response;
}

export const config = {
  matcher: ["/", "/app/:path*", "/login"],
};
