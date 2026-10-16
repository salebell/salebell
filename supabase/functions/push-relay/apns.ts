import { APNS_HOSTS, createProviderToken, TOKEN_TTL_MS, type ApnsConfig } from '../_shared/core/apns.ts';
/** No server-supplied topic, URL, expiration or fallback. No provider errors/secrets are logged. */
export function createRelayApnsSender(config: ApnsConfig, fetcher: typeof fetch = fetch, clock: () => number = Date.now) {
  let cached: { token: string; until: number } | null = null;
  return async (token: string, environment: 'production' | 'sandbox', payload: Record<string, unknown>): Promise<boolean> => {
    try {
      if (!/^[0-9a-f]{64,200}$/.test(token) || token.length % 2 || !Object.hasOwn(APNS_HOSTS, environment)) return false;
      const body = JSON.stringify(payload);
      if (new TextEncoder().encode(body).length > 4096) return false;
      const now = clock();
      if (!cached || cached.until <= now) cached = { token: await createProviderToken(config, now), until: now + TOKEN_TTL_MS };
      const response = await fetcher(`${APNS_HOSTS[environment]}/3/device/${token}`, {
        method: 'POST', redirect: 'error', headers: {
          authorization: `bearer ${cached.token}`, 'apns-topic': config.topic,
          'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': '0', 'content-type': 'application/json',
        }, body, signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      if (response.status === 403) cached = null;
      return response.ok;
    } catch { return false; }
  };
}
