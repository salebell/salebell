const MAX_BYTES = 16_384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function boundedText(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validReply(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort().join(",");
  return (keys === "enrolled" && row.enrolled === true)
    || (keys === "revoked" && row.revoked === true)
    || (keys === "challenge_id" && typeof row.challenge_id === "string" && UUID.test(row.challenge_id))
    || (keys === "route_id" && typeof row.route_id === "string" && UUID.test(row.route_id))
    || (keys === "failed,sent" && row.sent === 1 && row.failed === 0);
}

/** Public stable endpoint; its destination and enable flag are operator settings. */
export function createPushRelayProxy(get: (name: string) => string | undefined, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    if (get("SALEBELL_PUSH_RELAY_ENABLED") !== "true") return json(404, { error: "not_found" });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json(415, { error: "json_required" });
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return json(413, { error: "request_too_large" });
    let body: string;
    try {
      body = await boundedText(request.body);
      const value = JSON.parse(body);
      if (!value || typeof value !== "object" || Array.isArray(value)) return json(400, { error: "invalid_request" });
    } catch (error) { return json(error instanceof Error && error.message === "too_large" ? 413 : 400, { error: "invalid_request" }); }
    try {
      const origin = new URL(get("SUPABASE_URL") || get("NEXT_PUBLIC_SUPABASE_URL") || "");
      if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || (origin.pathname !== "/" && origin.pathname !== "")) throw new Error("invalid_config");
      const response = await fetcher(`${origin.origin}/functions/v1/push-relay`, {
        method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return response.status >= 400 && response.status < 500 ? json(response.status, { error: "relay_rejected" }) : json(502, { error: "relay_unavailable" });
      }
      if (response.status !== 200 && response.status !== 202) throw new Error("invalid_status");
      const value = JSON.parse(await boundedText(response.body));
      if (!validReply(value)) throw new Error("invalid_response");
      return json(response.status, value);
    } catch { return json(502, { error: "relay_unavailable" }); }
  };
}
