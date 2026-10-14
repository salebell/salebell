// Small Response helpers shared by the browser-facing edge functions.
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS_HEADERS, ...headers } });

export const bearer = (req: Request): string | null =>
  req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;

/** Adds CORS, answers preflight, requires POST and turns unexpected errors into a 500. */
export function browserFunction(handler: (req: Request) => Promise<Response>, log: Pick<Console, "error"> = console) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== "POST") return json(405, { error: "POST required" });
    try {
      return await handler(req);
    } catch (error) {
      log.error("unhandled error", { error: String(error) });
      return json(500, { error: "internal_error" });
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}
