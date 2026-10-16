/** Trusted managed relay. It never fetches customer backend URLs. */
export type RelayDependencies = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  send: (token: string, environment: 'production' | 'sandbox', payload: Record<string, unknown>) => Promise<boolean>;
};
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const generic = { title: 'Salebell', body: 'Open Salebell to see your latest activity.' };
class Rejected extends Error { readonly status: number; constructor(status: number) { super('Relay request rejected'); this.status = status; } }
function reject(status: number): never { throw new Rejected(status); }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const hash = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))));
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function canonicalBackend(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    // This is an identity binding, never a fetch destination. Accept the same
    // canonical HTTPS origins as the phone, including valid TLS IP/port origins.
    return u.protocol === 'https:' && u.origin === value && !u.username && !u.password;
  } catch { return false; }
}
function validate(o: Record<string, any>): void {
  const shared = ['action', 'installation_id', 'control_secret'];
  const fields: Record<string, string[]> = {
    enroll: [...shared, 'token', 'environment'], confirm: [...shared, 'challenge_id', 'challenge'],
    activate: [...shared, 'revision', 'backend', 'user_id', 'route_id', 'capability', 'content_key'],
    revoke: [...shared, 'revision'], deliver: ['action', 'capability', 'notification_id', 'title', 'body'],
  };
  const expected = typeof o.action === 'string' && Object.hasOwn(fields, o.action) ? fields[o.action] : undefined;
  if (!expected || expected.length !== Object.keys(o).length || expected.some(k => !Object.hasOwn(o, k))) reject(400);
  for (const k of ['installation_id', 'challenge_id', 'user_id', 'route_id', 'notification_id']) {
    if (k in o && (typeof o[k] !== 'string' || !UUID.test(o[k]))) reject(400);
  }
  for (const k of ['control_secret', 'challenge', 'capability', 'content_key']) {
    if (k in o && (typeof o[k] !== 'string' || !HEX.test(o[k]))) reject(400);
  }
  if ('revision' in o && (!Number.isSafeInteger(o.revision) || o.revision < 1)) reject(400);
  if ('backend' in o && !canonicalBackend(o.backend)) reject(400);
  if ('token' in o && (typeof o.token !== 'string' || !/^[0-9a-f]{64,200}$/.test(o.token) || o.token.length % 2)) reject(400);
  if ('environment' in o && !['production', 'sandbox'].includes(o.environment)) reject(400);
  if (o.action === 'deliver' && (typeof o.title !== 'string' || typeof o.body !== 'string' ||
    [...o.title].length > 200 || [...o.body].length > 1500)) reject(400);
}
async function readBody(request: Request): Promise<Record<string, any>> {
  const max = 16384;
  if (Number(request.headers.get('content-length')) > max) reject(413);
  const reader = request.body?.getReader();
  if (!reader) reject(400);
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader!.read();
      if (done) break;
      total += value.length;
      if (total > max) { void reader!.cancel(); reject(413); }
      chunks.push(value);
    }
  } finally { reader!.releaseLock(); }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') reject(400);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { reject(400); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) reject(400);
  return data as Record<string, any>;
}
export function createRelayHandler(deps: RelayDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'POST') reject(405);
      const o = await readBody(request);
      validate(o);
      if (o.action === 'deliver') {
        const encryptedLength = 4 * Math.ceil((encoder.encode(JSON.stringify({ title: o.title, body: o.body })).length + 16) / 3);
        const preview = { aps: { alert: generic, 'mutable-content': 1, sound: 'chaching.caf' },
          relay_route_id: '00000000-0000-0000-0000-000000000000',
          relay_encrypted: { nonce: 'A'.repeat(16), ciphertext: 'A'.repeat(encryptedLength) } };
        if (encoder.encode(JSON.stringify(preview)).length > 4096) reject(400);
      }
      const args: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === 'action' || k === 'title' || k === 'body') continue;
        if (['control_secret', 'capability', 'challenge'].includes(k)) args[`p_${k}_hash`] = await hash(v as string);
        else args[`p_${k}`] = v;
      }
      if (o.action === 'enroll') {
        const challenge = hex(crypto.getRandomValues(new Uint8Array(32)));
        const challengeID = crypto.randomUUID();
        args.p_challenge_id = challengeID;
        args.p_challenge_hash = await hash(challenge);
        const result = await deps.rpc('relay_enroll', args) as { enrolled?: boolean } | null;
        if (!result) reject(403);
        if (result.enrolled === true) return json({ enrolled: true });
        if (!await deps.send(o.token, o.environment, {
          aps: { alert: generic, 'content-available': 1 }, relay_enrollment: { installation_id: o.installation_id, challenge_id: challengeID, challenge },
        })) reject(503);
        return json({ challenge_id: challengeID }, 202);
      }
      if (o.action === 'deliver') {
        const route = await deps.rpc('relay_claim_delivery', args) as {
          route_id: string; token: string; environment: 'production' | 'sandbox'; content_key: string; duplicate: boolean; sent?: boolean;
        } | null;
        if (!route) reject(403);
        // Reservation is durable before sending: retries are at-most-once, including an uncertain Apple result.
        if (typeof route.duplicate !== 'boolean') reject(503);
        if (route.duplicate) return json(route.sent === true ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 });
        if (typeof route.route_id !== 'string' || !UUID.test(route.route_id) ||
          typeof route.token !== 'string' || !/^[0-9a-f]{64,200}$/.test(route.token) || route.token.length % 2 ||
          !['production', 'sandbox'].includes(route.environment) ||
          typeof route.content_key !== 'string' || !HEX.test(route.content_key)) reject(503);
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const rawKey = Uint8Array.from(route.content_key.match(/../g) ?? [], h => parseInt(h, 16));
        const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key,
          encoder.encode(JSON.stringify({ title: o.title, body: o.body }))));
        const payload = { aps: { alert: generic, 'mutable-content': 1, sound: 'chaching.caf' },
          relay_route_id: route.route_id, relay_encrypted: { nonce: b64(nonce), ciphertext: b64(ciphertext) } };
        // APNs limits payloads to 4 KiB. Reject oversized multibyte content without truncating ciphertext.
        if (encoder.encode(JSON.stringify(payload)).length > 4096) reject(400);
        if (await deps.rpc('relay_validate_delivery', args) !== true) reject(403);
        if (!await deps.send(route.token, route.environment, payload)) reject(503);
        await deps.rpc('relay_finish_delivery', args);
        return json({ sent: 1, failed: 0 });
      }
      const result = await deps.rpc(`relay_${o.action}`, args) as Record<string, unknown> | null;
      if (!result) reject(403);
      if (o.action === 'activate') return json({ route_id: result.route_id });
      if (o.action === 'confirm') return json({ enrolled: true });
      return json({ revoked: true });
    } catch (error) {
      return json({ error: 'Relay request rejected' }, error instanceof Rejected ? error.status : 503);
    }
  };
}
