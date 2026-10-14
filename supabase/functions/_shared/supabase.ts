// Minimal Supabase REST/Auth client over fetch for edge functions (no SDK).
export type AuthUser = { id: string; email?: string };

export function createServiceClient(url: string, serviceKey: string, fetcher: typeof fetch = fetch) {
  const headers: Record<string, string> = { apikey: serviceKey, "content-type": "application/json" };
  // Legacy service_role keys are JWTs; new sb_secret_ keys go in apikey only.
  if (serviceKey.startsWith("eyJ")) headers.authorization = `Bearer ${serviceKey}`;

  async function call<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await fetcher(`${url}${path}`, {
      method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} HTTP ${res.status}: ${text.slice(0, 300)}`);
    // Functions returning void come back as 204 with an empty body.
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    rpc: <T>(fn: string, args: Record<string, unknown>) => call<T>("POST", `/rest/v1/rpc/${fn}`, args),
    select: <T>(pathAndQuery: string) => call<T>("GET", `/rest/v1/${pathAndQuery}`),
    /** Resolves a user access token; null when it is missing, expired or invalid. */
    async getUser(jwt: string | null): Promise<AuthUser | null> {
      if (!jwt) return null;
      const res = await fetcher(`${url}/auth/v1/user`, {
        headers: { apikey: serviceKey, authorization: `Bearer ${jwt}` }, signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw new Error(`auth/v1/user HTTP ${res.status}`);
      const user = await res.json() as AuthUser;
      return user?.id ? user : null;
    },
    deleteUser: (id: string) => call<unknown>("DELETE", `/auth/v1/admin/users/${encodeURIComponent(id)}`),
  };
}

export type ServiceClient = ReturnType<typeof createServiceClient>;

/** Service client from the edge runtime's built-in env. */
export function serviceClientFromEnv(get: (name: string) => string | undefined): ServiceClient {
  const url = get("SUPABASE_URL"), key = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createServiceClient(url, key);
}
