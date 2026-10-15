import { installerConfig } from "@/lib/installer-config";
import { createInstallerHandler } from "@/lib/installer-http";
import release from "@/installer/release.json";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ action: string }> }) {
  let config;
  try { config = installerConfig(); } catch { return Response.json({ error: "installer_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
  const { action } = await context.params;
  return createInstallerHandler(config, release)(request, action);
}
export const GET = handle;
export const POST = handle;
