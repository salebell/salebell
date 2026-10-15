import release from "@/installer/release.json";
import { instanceRelease } from "@/lib/instance-release";
import { SITE_URL, SUPABASE_URL, SUPABASE_KEY, DEPLOYMENT_MODE } from "@/lib/env";
export const dynamic = "force-dynamic";
export function GET() {
  return instanceRelease(release.id, { ...process.env, NEXT_PUBLIC_SITE_URL: SITE_URL, NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE_KEY, NEXT_PUBLIC_DEPLOYMENT_MODE: DEPLOYMENT_MODE });
}
