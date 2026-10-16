import { serviceClientFromEnv } from '../_shared/supabase.ts';
import { apnsConfigFromEnv } from '../_shared/core/apns.ts';
import { createRelayApnsSender } from './apns.ts';
import { createRelayHandler } from './handler.ts';

// Deliberate operator opt-in: merely deploying this function cannot enable enrollment.
const get = (name: string) => Deno.env.get(name);
const config = apnsConfigFromEnv(get);
if (get('SALEBELL_PUSH_RELAY_ENABLED') !== 'true' || !config) {
  Deno.serve(() => Response.json({ error: 'Relay unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } }));
} else {
  const db = serviceClientFromEnv(get);
  Deno.serve(createRelayHandler({ rpc: (name, args) => db.rpc(name, args), send: createRelayApnsSender(config) }));
}
