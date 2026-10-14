// Forwards the raw App Store notification to the developer's own server, so
// Salebell can sit in front of an existing App Store Connect URL.
import { deliveryErrorCode } from "./net.ts";

export type ForwardResult = { ok: boolean; status?: number; error?: string; ms: number };

export const FORWARD_TIMEOUT_MS = 10_000;
/** Set on forwarded requests; the webhook never forwards a request carrying it (no loops). */
export const FORWARDED_HEADER = "x-salebell-forwarded";

/**
 * POSTs body unchanged with its content type. Never throws; redirects are not followed.
 * Pass a guarded fetch in production. Errors are generic codes, never the URL.
 */
export async function forwardRaw(
  url: string,
  body: string,
  contentType: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = FORWARD_TIMEOUT_MS,
): Promise<ForwardResult> {
  const started = Date.now();
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": contentType, [FORWARDED_HEADER]: "1" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: deliveryErrorCode(error), ms: Date.now() - started };
  }
}
