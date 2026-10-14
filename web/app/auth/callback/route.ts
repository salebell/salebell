import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";

// Sign-in link fallback. Emails show a 6-digit code once custom SMTP and the code template are set; until then
// Supabase's default email has a link that lands here with a PKCE code. It works in the browser that asked for it.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
  if (code && !(await supabase.auth.exchangeCodeForSession(code)).error) {
    return NextResponse.redirect(new URL(safeNext(searchParams.get("next"), origin), origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
