// Deno DNS resolver for the outbound guard (A and AAAA records).
import { createGuardedFetch, type Resolver } from "./core/net.ts";

export const denoResolver: Resolver = async (hostname) => {
  const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(hostname, "A"), Deno.resolveDns(hostname, "AAAA")]);
  const addresses = [...(a.status === "fulfilled" ? a.value : []), ...(aaaa.status === "fulfilled" ? aaaa.value : [])];
  if (!addresses.length) throw a.status === "rejected" ? a.reason : new Error("no addresses");
  return addresses;
};

/** fetch for every customer-configured destination. */
export const guardedFetch = createGuardedFetch(denoResolver);
