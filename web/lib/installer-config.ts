type Environment = Record<string, string | undefined>;
export type InstallerConfig = {
  origin: string;
  supabaseClientId: string; supabaseSecret: string; encryptionKey: string;
  controlUrl: string; controlKey: string; releaseRef: string; supabaseProduct: string;
  publicEnabled: boolean; cleanupSecret: string;
};
export function httpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid_origin");
  return url.origin;
}
export function siteOrigin(env: Environment): string {
  if (env.NEXT_PUBLIC_SITE_URL) {
    const value = env.NEXT_PUBLIC_SITE_URL;
    // Preserve the existing local development HTTP origin.
    if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(value)) return value;
    return httpsOrigin(value);
  }
  if (env.VERCEL === "1" && env.VERCEL_PROJECT_PRODUCTION_URL && /^[a-z0-9.-]+\.vercel\.app$/i.test(env.VERCEL_PROJECT_PRODUCTION_URL)) {
    return httpsOrigin(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  throw new Error("Missing NEXT_PUBLIC_SITE_URL or trusted Vercel production hostname.");
}
export function installerConfig(env: Environment = process.env): InstallerConfig | null {
  if (env.INSTALLER_ENABLED !== "true") return null;
  const names = ["INSTALLER_ORIGIN", "INSTALLER_SUPABASE_CLIENT_ID", "INSTALLER_SUPABASE_CLIENT_SECRET", "INSTALLER_ENCRYPTION_KEY", "INSTALLER_CONTROL_URL", "INSTALLER_CONTROL_KEY", "INSTALLER_RELEASE_REF", "INSTALLER_SUPABASE_PRODUCT", "INSTALLER_CLEANUP_SECRET"];
  if (names.some(name => !env[name]?.trim()) || !/^[a-f0-9]{64}$/i.test(env.INSTALLER_ENCRYPTION_KEY!) || !/^[a-f0-9]{40}$/i.test(env.INSTALLER_RELEASE_REF!) || !/^[a-z0-9-]+$/.test(env.INSTALLER_SUPABASE_PRODUCT!)) throw new Error("Incomplete installer configuration.");
  return {
    origin: httpsOrigin(env.INSTALLER_ORIGIN!),
    supabaseClientId: env.INSTALLER_SUPABASE_CLIENT_ID!, supabaseSecret: env.INSTALLER_SUPABASE_CLIENT_SECRET!, encryptionKey: env.INSTALLER_ENCRYPTION_KEY!,
    controlUrl: httpsOrigin(env.INSTALLER_CONTROL_URL!), controlKey: env.INSTALLER_CONTROL_KEY!, releaseRef: env.INSTALLER_RELEASE_REF!, supabaseProduct: env.INSTALLER_SUPABASE_PRODUCT!,
    publicEnabled: env.INSTALLER_PUBLIC_ENABLED === "true", cleanupSecret: env.INSTALLER_CLEANUP_SECRET!,
  };
}
// Initial installations use provider-owned public hostnames, never arbitrary fetch targets.
export function deploymentOrigin(value: string): string {
  try {
    const origin = httpsOrigin(value);
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/i.test(new URL(origin).hostname)) return origin;
  } catch { /* return the same actionable error for all unsupported addresses */ }
  throw new Error("invalid_deployment_url");
}
export function deployUrl(config: Pick<InstallerConfig, "origin" | "releaseRef" | "supabaseProduct">) {
  const url = new URL("https://vercel.com/new/clone");
  url.searchParams.set("repository-url", `https://github.com/salebell/salebell/tree/${config.releaseRef}`);
  url.searchParams.set("root-directory", "web");
  url.searchParams.set("project-name", "salebell");
  url.searchParams.set("repository-name", "salebell");
  url.searchParams.set("products", JSON.stringify([{ type: "integration", integrationSlug: "supabase", productSlug: config.supabaseProduct, protocol: "storage" }]));
  const defaults = { NEXT_PUBLIC_DEPLOYMENT_MODE: "self_hosted", SALEBELL_BROWSER_INSTALL: "true", SALEBELL_INSTALLER_ORIGIN: config.origin };
  url.searchParams.set("env", Object.keys(defaults).join(","));
  url.searchParams.set("envDefaults", JSON.stringify(defaults));
  url.searchParams.set("envDescription", "Salebell setup defaults. Keep these values to finish installation in your browser.");
  // Visit the new site after deployment: its Finish setup link supplies its own
  // production address, so no provider callback or Vercel authorization is needed.
  return url.href;
}
