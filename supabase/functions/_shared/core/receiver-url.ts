export type ReceiverHosts = { siteUrl?: string; supabaseUrl?: string; internalSupabaseUrl?: string };

function hostname(value: string | undefined): string | null {
  try { return new URL(value ?? "").hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return null; }
}

/** Shared hosting domains are not identities: only this project's receiver can loop. */
export function isSalebellReceiver(value: string | URL, hosts: ReceiverHosts): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const path = decodeURIComponent(url.pathname);
    const siteHost = hostname(hosts.siteUrl);
    const knownSite = host === "salebell.vercel.app";
    if ((host === siteHost || knownSite) && /^\/hooks\/apple(?:\/|$)/.test(path)) return true;
    return [hosts.supabaseUrl, hosts.internalSupabaseUrl].some((base) => {
      if (!base || host !== hostname(base)) return false;
      const prefix = decodeURIComponent(new URL(base).pathname).replace(/\/$/, "");
      return ["", prefix].some((root) => {
        const receiver = `${root}/functions/v1/apple-webhook`;
        return path === receiver || path.startsWith(`${receiver}/`);
      });
    });
  } catch { return false; }
}
