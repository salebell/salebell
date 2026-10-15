import { deploymentOrigin, httpsOrigin } from "./installer-config.ts";

// This endpoint exposes only already-public connection settings. Never include
// native integration secrets, service keys, or provider authorization tokens.
export function instanceRelease(release: string, env: Record<string, string | undefined>) {
  const headers = { "cache-control": "no-store" };
  try {
    if (env.VERCEL !== "1" || env.SALEBELL_BROWSER_INSTALL !== "true" || env.NEXT_PUBLIC_DEPLOYMENT_MODE !== "self_hosted") return Response.json({ release }, { headers });
    const origin = deploymentOrigin(env.NEXT_PUBLIC_SITE_URL ?? "");
    const installerOrigin = httpsOrigin(env.SALEBELL_INSTALLER_ORIGIN ?? "");
    return Response.json({ release, mode: "self_hosted", setup: true, origin, installerOrigin,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, publicKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, { headers });
  } catch { return Response.json({ release }, { headers }); }
}
