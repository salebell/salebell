/**
 * Client-side mirror of the backend's outbound URL rule (forward URLs, webhooks, ntfy server, PostHog host):
 * https only, and never an IP literal or localhost. The database checks again on write, including private ranges.
 */
export function outboundUrlError(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a full URL that starts with https://.";
  }
  if (url.protocol !== "https:") return "Must start with https://.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return "Salebell can't reach localhost. Use a public https address.";
  // The URL parser normalises decimal/hex IPv4 forms to dotted quads; IPv6 literals keep their brackets.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return "Use a host name, not an IP address.";
  return null;
}
