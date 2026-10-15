import { instanceHealth } from "@/lib/instance-health";
import { SITE_URL, SUPABASE_URL, SUPABASE_KEY } from "@/lib/env";
import release from "@/installer/release.json";
export const dynamic = "force-dynamic";
export function GET() {
  return instanceHealth({ origin: SITE_URL, supabaseUrl: SUPABASE_URL, publicKey: SUPABASE_KEY, release: release.id });
}
