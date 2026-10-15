export async function initialInstallRedirect(url: URL, env: Record<string, string | undefined>, fetcher: typeof fetch = fetch): Promise<URL | null> {
  if (env.VERCEL !== "1" || env.SALEBELL_BROWSER_INSTALL !== "true" || env.NEXT_PUBLIC_DEPLOYMENT_MODE !== "self_hosted" || !["/", "/login"].includes(url.pathname)) return null;
  try {
    const result = await fetcher(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/instance_settings`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "", "content-type": "application/json" }, body: "{}", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
    if (result.status === 404) { await result.body?.cancel(); return new URL("/install", url.origin); }
    await result.body?.cancel();
  } catch { /* retain the normal sign-in flow on a transient provider outage */ }
  return null;
}
