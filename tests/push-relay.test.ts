import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRelayHandler } from '../supabase/functions/push-relay/handler.ts';

const iid = '11111111-1111-4111-8111-111111111111';
const rid = '22222222-2222-4222-8222-222222222222';
const secret = 'a'.repeat(64), capability = 'b'.repeat(64), key = 'c'.repeat(64);
const token = 'd'.repeat(64);
function fixture(respond: (name: string, args: Record<string, unknown>) => unknown = () => ({})) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const pushes: { token: string; environment: string; payload: any }[] = [];
  const handler = createRelayHandler({
    rpc: async (name, args) => { calls.push({ name, args }); return respond(name, args); },
    send: async (t, environment, payload) => { pushes.push({ token: t, environment, payload }); return true; },
  });
  const post = (body: unknown) => handler(new Request('https://relay.example', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { calls, pushes, handler, post };
}
const enroll = { action: 'enroll', installation_id: iid, control_secret: secret, token, environment: 'production' };
const activate = { action: 'activate', installation_id: iid, control_secret: secret, revision: 1,
  backend: 'https://project.supabase.co', user_id: iid, route_id: rid, capability, content_key: key };

test('rejects malformed, extra, oversized, unsafe revisions and noncanonical origins before RPC', async () => {
  const f = fixture();
  for (const body of [null, [], {}, { ...enroll, token: 'bad' }, { ...enroll, target: 'victim' },
    { ...activate, revision: 0 }, { ...activate, revision: 2 ** 53 },
    ...['http://host.test', 'https://user@host.test', 'https://host.test/path', 'https://host.test/', 'https://HOST.test', 'https://host.test?x=1'].map(backend => ({ ...activate, backend })),
    { action: 'deliver', capability, notification_id: iid, title: 'x'.repeat(201), body: '' }]) {
    assert.equal((await f.post(body)).status, 400);
  }
  assert.equal((await f.handler(new Request('https://relay.example', { method: 'POST', body: 'x'.repeat(17000) }))).status, 413);
  assert.equal(f.calls.length, 0);
});

test('canonical HTTPS API origins including TLS IPs are identities, never fetch destinations', async () => {
  for (const backend of ['https://127.0.0.1', 'https://[::1]:8443', 'https://localhost', 'https://api.example.com:8443']) {
    const f = fixture(() => ({ route_id: rid }));
    assert.equal((await f.post({ ...activate, backend })).status, 200);
    assert.equal(f.calls[0].args.p_backend, backend);
    assert.equal(f.pushes.length, 0);
  }
});

test('enrollment never returns challenge, hashes credentials and sends proof only through APNs', async () => {
  const f = fixture(() => ({ enrolled: false }));
  const res = await f.post(enroll);
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['challenge_id']);
  const push = f.pushes[0];
  assert.equal(push.token, token);
  assert.equal(push.payload.relay_enrollment.installation_id, iid);
  assert.equal(push.payload.relay_enrollment.challenge_id, body.challenge_id);
  assert.match(push.payload.relay_enrollment.challenge, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(f.calls).includes(secret), false);
  assert.equal(JSON.stringify(f.calls).includes(push.payload.relay_enrollment.challenge), false);
});

test('confirmed same-token enrollment bypasses challenge send', async () => {
  const f = fixture(() => ({ enrolled: true }));
  assert.deepEqual(await (await f.post(enroll)).json(), { enrolled: true });
  assert.equal(f.pushes.length, 0);
});

test('confirmation, activation and revocation return only bounded public fields', async () => {
  const f = fixture((name) => name === 'relay_activate' ? { route_id: rid, token } : { enrolled: true, revoked: true, secret });
  assert.deepEqual(await (await f.post({ action: 'confirm', installation_id: iid, control_secret: secret, challenge_id: rid, challenge: capability })).json(), { enrolled: true });
  assert.deepEqual(await (await f.post(activate)).json(), { route_id: rid });
  assert.deepEqual(await (await f.post({ action: 'revoke', installation_id: iid, control_secret: secret, revision: 2 })).json(), { revoked: true });
  assert.equal(JSON.stringify(f.calls).includes(secret), false);
  assert.equal(JSON.stringify(f.calls).includes(capability), false);
});

test('delivery resolves one route, encrypts text with AES GCM and leaves only generic fallback', async () => {
  const f = fixture((name) => name === 'relay_validate_delivery' ? true : { route_id: rid, token, environment: 'sandbox', content_key: key, duplicate: false });
  assert.deepEqual(await (await f.post({ action: 'deliver', capability, notification_id: iid, title: 'Private sale', body: 'Paid 45 USD' })).json(), { sent: 1, failed: 0 });
  assert.equal(f.pushes.length, 1);
  const p = f.pushes[0].payload;
  assert.equal(p.relay_route_id, rid);
  assert.deepEqual(p.aps.alert, { title: 'Salebell', body: 'Open Salebell to see your latest activity.' });
  assert.equal(p.aps['mutable-content'], 1);
  assert.equal(p.aps.sound, 'chaching.caf');
  assert.equal(JSON.stringify(p).includes('Private sale'), false);
  const cryptoKey = await crypto.subtle.importKey('raw', Buffer.from(key, 'hex'), 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(p.relay_encrypted.nonce, 'base64') }, cryptoKey, Buffer.from(p.relay_encrypted.ciphertext, 'base64'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), { title: 'Private sale', body: 'Paid 45 USD' });
});

test('dedupe acknowledges delivery without another APNs call', async () => {
  const f = fixture(() => ({ duplicate: true, sent: true }));
  assert.deepEqual(await (await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' })).json(), { sent: 1, failed: 0 });
  assert.equal(f.pushes.length, 0);
});

test('database/limiter/APNs failure sanitizes output and never falls back to broadcast', async () => {
  const f = fixture(() => { throw new Error(`private ${secret} ${token}`); });
  const res = await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'Relay request rejected' });
  assert.equal(f.pushes.length, 0);
  const denied = fixture(() => null);
  assert.equal((await denied.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' })).status, 403);
});

import { createRelayApnsSender } from '../supabase/functions/push-relay/apns.ts';
import { generateKeyPairSync } from 'node:crypto';
test('real APNs sender fixes host/topic, disables queueing and never sends a token from an untrusted URL', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const requests: { url: string; init: RequestInit }[] = [];
  const sender = createRelayApnsSender({ keyP8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'com.salebell.salebell' },
    (async (url, init) => { requests.push({ url: String(url), init: init! }); return new Response(null, { status: 200 }); }) as typeof fetch);
  assert.equal(await sender(token, 'sandbox', { aps: { alert: { title: 'Salebell' } } }), true);
  assert.equal(requests[0].url, `https://api.sandbox.push.apple.com/3/device/${token}`);
  const headers = requests[0].init.headers as Record<string, string>;
  assert.equal(headers['apns-expiration'], '0');
  assert.equal(headers['apns-topic'], 'com.salebell.salebell');
  assert.equal(headers['apns-push-type'], 'alert');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(await sender('https://evil.test', 'sandbox', {}), false);
  assert.equal(requests.length, 1);
});

test('rejects spoofed content type and multibyte APNs overflow before consuming dedupe', async () => {
  const f = fixture(() => ({ route_id: rid, token, environment: 'production', content_key: key, duplicate: false }));
  assert.equal((await f.handler(new Request('https://relay.example', { method: 'POST',
    headers: { 'content-type': 'notapplication/json' }, body: JSON.stringify(enroll) }))).status, 400);
  assert.equal((await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '😀'.repeat(1500) })).status, 400);
  assert.equal(f.calls.length, 0);
});


test('failed or in-flight duplicate never claims successful APNs delivery', async () => {
  const f = fixture(() => ({ duplicate: true, sent: false }));
  assert.deepEqual(await (await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' })).json(), { sent: 0, failed: 1 });
  assert.equal(f.pushes.length, 0);
});

test('revocation during encryption prevents APNs send', async () => {
  const f = fixture((name) => name === 'relay_validate_delivery' ? false : { route_id: rid, token, environment: 'sandbox', content_key: key, duplicate: false });
  assert.equal((await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' })).status, 403);
  assert.equal(f.pushes.length, 0);
});

test('invalid database route fields fail closed', async () => {
  for (const bad of [{ token: 'bad' }, { content_key: 'bad' }, { route_id: 'bad' }, { environment: 'elsewhere' }, { duplicate: 'false' }]) {
    const f = fixture(() => ({ route_id: rid, token, environment: 'sandbox', content_key: key, duplicate: false, ...bad }));
    assert.equal((await f.post({ action: 'deliver', capability, notification_id: iid, title: '', body: '' })).status, 503);
    assert.equal(f.pushes.length, 0);
  }
});

test('unknown and inherited action names are malformed requests', async () => {
  const f = fixture();
  for (const action of ['constructor', '__proto__', 'missing']) assert.equal((await f.post({ action })).status, 400);
  assert.equal(f.calls.length, 0);
});
