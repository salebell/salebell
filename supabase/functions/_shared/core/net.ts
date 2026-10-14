// Outbound request guard against SSRF: every customer-configurable destination
// (integrations, forward URLs) goes through guardedFetch. https only, no IP literals or
// private names, every resolved address must be public, and redirects are never followed.
// Runtime-agnostic: DNS resolution is injected (Deno.resolveDns in edge functions).

export type Resolver = (hostname: string) => Promise<string[]>;

export class BlockedDestinationError extends Error {
  constructor() {
    super("blocked_destination");
    this.name = "BlockedDestinationError";
  }
}

/** Generic, URL-free error codes stored in alert_deliveries and returned to clients. */
export type DeliveryErrorCode = "timeout" | "blocked_destination" | "connection_failed";

export function deliveryErrorCode(error: unknown): DeliveryErrorCode {
  if (error instanceof BlockedDestinationError) return "blocked_destination";
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError") return "timeout";
  return "connection_failed";
}

const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Same rules as private.is_public_https_url in the database. */
export function isAllowedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host.includes(":") || host.startsWith("[") || IPV4.test(host)) return false; // IP literals
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$/.test(host)) return false;
  return !BLOCKED_SUFFIX.test(host);
}

function v4Private(a: number, b: number, c: number): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || // this-network, private, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF assignments, TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113); // TEST-NET-2/3
}

function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const [head, tail, extra] = s.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const fill = t === null ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (t === null && h.length !== 8)) return null;
  const parts = [...h, ...Array(fill).fill("0"), ...(t ?? [])].map((x) => parseInt(x, 16));
  return parts.length === 8 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? parts : null;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges. */
export function isPrivateAddress(ip: string): boolean {
  const m = ip.match(IPV4);
  if (m) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return true;
    return v4Private(a, b, c);
  }
  const h = expandV6(ip);
  if (!h) return true; // unparseable: refuse
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  const embeddedV4 = () => v4Private(h[6] >> 8, h[6] & 0xff, h[7] >> 8);
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return embeddedV4(); // ::ffff:a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) return embeddedV4(); // NAT64
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true; // discard
  return false;
}

/**
 * fetch wrapper enforcing the destination rules. Throws BlockedDestinationError for a
 * refused destination; DNS failures surface as ordinary (connection_failed) errors.
 * DNS is resolved separately from the connection, so a rebinding attacker could still
 * race it; the private-name and IP-literal rules apply regardless.
 */
export function createGuardedFetch(resolve: Resolver, base: typeof fetch = fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" || url.username || url.password || !isAllowedHostname(url.hostname)) {
      throw new BlockedDestinationError();
    }
    const addresses = await resolve(url.hostname);
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new BlockedDestinationError();
    return await base(input, { ...init, redirect: "manual" });
  }) as typeof fetch;
}
