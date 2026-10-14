import { outboundUrlError } from "./outbound-url.ts";

/** Mirrors the edge receiver check; other customers on Supabase/Vercel are valid destinations. */
export function forwardingUrlError(value: string, hosts: { siteUrl: string; supabaseUrl: string }): string | null {
  if (!value) return null;
  const error = outboundUrlError(value);
  if (error) return error;
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const siteHost = new URL(hosts.siteUrl).hostname.toLowerCase().replace(/\.$/, "");
  const supabaseHost = new URL(hosts.supabaseUrl).hostname.toLowerCase().replace(/\.$/, "");
  let path: string;
  let apiPrefix: string;
  try {
    path = decodeURIComponent(url.pathname);
    apiPrefix = decodeURIComponent(new URL(hosts.supabaseUrl).pathname).replace(/\/$/, "");
  } catch { return "Enter a valid URL."; }
  const knownSite = host === "salebell.vercel.app";
  const siteReceiver = (host === siteHost || knownSite) && /^\/hooks\/apple(?:\/|$)/.test(path);
  const edgeReceiver = host === supabaseHost && ["", apiPrefix].some((prefix) => {
    const receiver = `${prefix}/functions/v1/apple-webhook`;
    return path === receiver || path.startsWith(`${receiver}/`);
  });
  return siteReceiver || edgeReceiver ? "Use your server's notification URL. This Salebell URL would create a forwarding loop." : null;
}
