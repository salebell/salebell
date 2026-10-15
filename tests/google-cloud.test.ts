import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { GoogleSetupError, provisionGoogleRtdn } from "../supabase/functions/_shared/core/google_cloud.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials = { type: "service_account", project_id: "example-project", client_email: "play@example-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), private_key_id: "example-key" };
const expected = { appId: "11111111-2222-4333-8444-555555555555", receiverUrl: "https://example.com/hooks/google/0123456789abcdef0123456789abcdef" };
const topic = "projects/example-project/topics/salebell-11111111222243338444555555555555";
const subscription = "projects/example-project/subscriptions/salebell-11111111222243338444555555555555";
const pubsub = "https://pubsub.googleapis.com/v1/";
const sa = "https://iam.googleapis.com/v1/projects/example-project/serviceAccounts/play@example-project.iam.gserviceaccount.com";
const project = "https://cloudresourcemanager.googleapis.com/v1/projects/example-project";
const playMember = "serviceAccount:google-play-developer-notifications@system.gserviceaccount.com";
const pushMember = "serviceAccount:service-123456789012@gcp-sa-pubsub.iam.gserviceaccount.com";
const t0 = Date.parse("2026-10-14T12:00:00Z");
const desiredSubscription = () => ({ name: subscription, topic,
  pushConfig: { pushEndpoint: expected.receiverUrl, oidcToken: { serviceAccountEmail: credentials.client_email, audience: expected.receiverUrl } },
  ackDeadlineSeconds: 60, expirationPolicy: {}, retryPolicy: { minimumBackoff: "10s", maximumBackoff: "600s" } });
type Call = { url: string; method: string; init?: RequestInit; body?: Record<string, unknown> };

function server(options: { topic?: Record<string, unknown>; subscription?: Record<string, unknown>;
  topicPolicy?: Record<string, unknown>; saPolicy?: Record<string, unknown>; intercept?: (call: Call) => Response | undefined } = {}) {
  const calls: Call[] = [];
  let currentTopic = options.topic, currentSubscription = options.subscription;
  let topicPolicy = options.topicPolicy ?? { version: 3, etag: "topic-etag", bindings: [] };
  let saPolicy = options.saPolicy ?? { version: 3, etag: "sa-etag", bindings: [] };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    const body = init?.body && new Headers(init.headers).get("content-type") === "application/json" ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method, init, body }; calls.push(call);
    const intercepted = options.intercept?.(call); if (intercepted) return intercepted;
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "SECRET_OAUTH", token_type: "Bearer", expires_in: 3600 });
    if (url === project && method === "GET") return Response.json({ projectId: "example-project", projectNumber: "123456789012", lifecycleState: "ACTIVE" });
    if (url === pubsub + topic && method === "GET") return currentTopic ? Response.json(currentTopic) : new Response(null, { status: 404 });
    if (url === pubsub + topic && method === "PUT") { currentTopic = { name: topic, ...body }; return Response.json(currentTopic); }
    if (url === pubsub + subscription && method === "GET") return currentSubscription ? Response.json(currentSubscription) : new Response(null, { status: 404 });
    if (url === pubsub + subscription && method === "PUT") { currentSubscription = { name: subscription, ...body }; return Response.json(currentSubscription); }
    if (url === pubsub + topic + ":getIamPolicy?options.requestedPolicyVersion=3" && method === "GET") return Response.json(topicPolicy);
    if (url === pubsub + topic + ":setIamPolicy" && method === "POST") { topicPolicy = body!.policy as Record<string, unknown>; return Response.json(topicPolicy); }
    if (url === sa + ":getIamPolicy?options.requestedPolicyVersion=3" && method === "POST") return Response.json(saPolicy);
    if (url === sa + ":setIamPolicy" && method === "POST") { saPolicy = body!.policy as Record<string, unknown>; return Response.json(saPolicy); }
    assert.fail(`Unexpected fake Google request: ${method} ${url}`);
  }) as typeof fetch;
  return { fetcher, calls };
}
const mutations = (calls: Call[]) => calls.filter(call => call.method === "PUT" || call.url.endsWith(":setIamPolicy"));
const rejectsCode = (promise: Promise<unknown>, code: string) => assert.rejects(promise, error => {
  assert.ok(error instanceof GoogleSetupError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(error.cause, undefined);
  assert.ok(!/SECRET|https:|PRIVATE/.test(String(error)));
  return true;
});

test("Cloud setup signs the cloud scope and provisions authenticated wrapped delivery while preserving IAM policies", async () => {
  const conditional = { role: "roles/pubsub.publisher", members: [playMember], condition: { title: "temporary", expression: "false" } };
  const existing = { role: "roles/pubsub.viewer", members: ["user:operator@example.com"] };
  const conditionalToken = { role: "roles/iam.serviceAccountTokenCreator", members: [pushMember], condition: { title: "temporary", expression: "false" } };
  const fake = server({ topicPolicy: { version: 3, etag: "topic-etag", bindings: [conditional, existing], auditConfigs: [] },
    saPolicy: { version: 3, etag: "sa-etag", bindings: [conditionalToken] } });
  assert.deepEqual(await provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 }),
    { topic, subscription, serviceAccountEmail: credentials.client_email });
  const oauth = fake.calls[0];
  const assertion = new URLSearchParams(String(oauth.init?.body)).get("assertion")!;
  const [header, claims, signature] = assertion.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), { iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: t0 / 1000, exp: t0 / 1000 + 3600 });
  assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")));
  const created = fake.calls.find(call => call.url === pubsub + subscription && call.method === "PUT")!;
  assert.deepEqual(created.body, { topic, pushConfig: desiredSubscription().pushConfig, ackDeadlineSeconds: 60,
    expirationPolicy: {}, retryPolicy: { minimumBackoff: "10s", maximumBackoff: "600s" } });
  assert.deepEqual(fake.calls.find(call => call.url === pubsub + topic + ":setIamPolicy")!.body,
    { policy: { version: 3, etag: "topic-etag", bindings: [conditional, existing, { role: "roles/pubsub.publisher", members: [playMember] }], auditConfigs: [] } });
  assert.deepEqual(fake.calls.find(call => call.url === sa + ":setIamPolicy")!.body,
    { policy: { version: 3, etag: "sa-etag", bindings: [conditionalToken, { role: "roles/iam.serviceAccountTokenCreator", members: [pushMember] }] } });
  assert.equal(fake.calls.find(call => call.url === sa + ":getIamPolicy?options.requestedPolicyVersion=3")!.init?.body, undefined);
  for (const call of fake.calls) {
    assert.ok(["oauth2.googleapis.com", "pubsub.googleapis.com", "iam.googleapis.com", "cloudresourcemanager.googleapis.com"].includes(new URL(call.url).hostname));
    assert.equal(call.init?.redirect, "error");
    assert.ok(call.init?.signal instanceof AbortSignal);
    if (call !== oauth) assert.equal(new Headers(call.init?.headers).get("authorization"), "Bearer SECRET_OAUTH");
  }
});

test("Cloud setup reuses matching existing resources without writing policies that already grant access", async () => {
  const fake = server({ topic: { name: topic }, subscription: { ...desiredSubscription(), pushConfig: { ...desiredSubscription().pushConfig, pubsubWrapper: {} } },
    topicPolicy: { etag: "topic-etag", bindings: [{ role: "roles/pubsub.publisher", members: [playMember] }] },
    saPolicy: { etag: "sa-etag", bindings: [{ role: "roles/iam.serviceAccountTokenCreator", members: [pushMember] }] } });
  await provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 });
  assert.deepEqual(mutations(fake.calls), []);
});

test("Cloud setup refuses mismatching or filtered existing delivery without changing any remote resource", async () => {
  const variants = [
    { topic: "projects/example-project/topics/other" },
    { pushConfig: { ...desiredSubscription().pushConfig, pushEndpoint: "https://other.example.com/hooks" } },
    { pushConfig: { ...desiredSubscription().pushConfig, oidcToken: { ...desiredSubscription().pushConfig.oidcToken, audience: "https://other.example.com" } } },
    { pushConfig: { ...desiredSubscription().pushConfig, oidcToken: { ...desiredSubscription().pushConfig.oidcToken, serviceAccountEmail: "other@example-project.iam.gserviceaccount.com" } } },
    { pushConfig: { ...desiredSubscription().pushConfig, noWrapper: { writeMetadata: true } } },
    { ackDeadlineSeconds: 10 }, { retryPolicy: { minimumBackoff: "1s", maximumBackoff: "600s" } },
    { expirationPolicy: { ttl: "86400s" } }, { filter: "attributes.other = \"value\"" }, { detached: true },
    { messageTransforms: [{ javascriptUdf: { code: "return null;" } }] }, { deadLetterPolicy: { deadLetterTopic: topic, maxDeliveryAttempts: 5 } },
  ];
  for (const variant of variants) {
    const fake = server({ topic: { name: topic }, subscription: { ...desiredSubscription(), ...variant } });
    await rejectsCode(provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 }), "google_resource_conflict");
    assert.deepEqual(mutations(fake.calls), []);
  }
});

test("Cloud setup refuses existing topics that require a schema or transform notifications", async () => {
  for (const variant of [{ name: "projects/example-project/topics/other" }, { schemaSettings: { schema: "projects/example-project/schemas/other" } },
    { messageTransforms: [{ javascriptUdf: { code: "return null;" } }] }]) {
    const fake = server({ topic: { name: topic, ...variant } });
    await rejectsCode(provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 }), "google_resource_conflict");
    assert.deepEqual(mutations(fake.calls), []);
  }
});

test("Cloud setup resolves create races by reading the winner and never overwrites a conflicting subscription", async () => {
  for (const conflicting of [false, true]) {
    let racedTopic = false, racedSubscription = false;
    const fake = server({ intercept: call => {
      if (call.url === pubsub + topic && call.method === "PUT") { racedTopic = true; return new Response(null, { status: 409 }); }
      if (call.url === pubsub + topic && call.method === "GET" && racedTopic) return Response.json({ name: topic });
      if (call.url === pubsub + subscription && call.method === "PUT") { racedSubscription = true; return new Response(null, { status: 409 }); }
      if (call.url === pubsub + subscription && call.method === "GET" && racedSubscription) return Response.json({ ...desiredSubscription(), ...(conflicting ? { filter: "attributes.other = \"value\"" } : {}) });
    } });
    const result = provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 });
    if (conflicting) await rejectsCode(result, "google_resource_conflict");
    else assert.deepEqual(await result, { topic, subscription, serviceAccountEmail: credentials.client_email });
    assert.equal(fake.calls.filter(call => call.method === "PUT" && call.url === pubsub + subscription).length, 1);
  }
});

test("Cloud setup retries a stale policy etag with a fresh merge preserving concurrent grants", async () => {
  let sets = 0;
  const fake = server({ intercept: call => {
    if (call.url === pubsub + topic + ":setIamPolicy" && ++sets === 1) return new Response(null, { status: 409 });
    if (call.url === pubsub + topic + ":getIamPolicy?options.requestedPolicyVersion=3" && sets === 1) return Response.json({ version: 3, etag: "new-etag",
      bindings: [{ role: "roles/pubsub.viewer", members: ["user:concurrent@example.com"] }] });
  } });
  await provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 });
  assert.deepEqual(fake.calls.filter(call => call.url === pubsub + topic + ":setIamPolicy").at(-1)!.body,
    { policy: { version: 3, etag: "new-etag", bindings: [{ role: "roles/pubsub.viewer", members: ["user:concurrent@example.com"] }, { role: "roles/pubsub.publisher", members: [playMember] }] } });
});

test("Cloud setup appends to unconditional grants and requires the API to confirm new access", async () => {
  const fake = server({ topicPolicy: { etag: "topic-etag", bindings: [{ role: "roles/pubsub.publisher", members: ["user:operator@example.com"] }] } });
  await provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 });
  assert.deepEqual(fake.calls.find(call => call.url === pubsub + topic + ":setIamPolicy")!.body,
    { policy: { etag: "topic-etag", bindings: [{ role: "roles/pubsub.publisher", members: ["user:operator@example.com", playMember] }] } });
  const unconfirmed = server({ intercept: call => call.url.endsWith(":setIamPolicy") ? Response.json({ etag: "unchanged", bindings: [] }) : undefined });
  await rejectsCode(provisionGoogleRtdn(credentials, expected, { fetcher: unconfirmed.fetcher, now: () => t0 }), "google_setup_unavailable");
});

test("Cloud setup rejects malformed credentials, cross-project push identities and untrusted setup shapes before requests", async () => {
  for (const variant of [{ type: "authorized_user" }, { project_id: "../PRIVATE" }, { client_email: "play@other-project.iam.gserviceaccount.com" },
    { client_email: "PRIVATE@evil.example.com" }, { private_key: "PRIVATE" }]) {
    const fake = server();
    await rejectsCode(provisionGoogleRtdn({ ...credentials, ...variant }, expected, { fetcher: fake.fetcher, now: () => t0 }), "google_invalid_credentials");
    assert.equal(fake.calls.length, 0);
  }
  for (const variant of [{ appId: "../PRIVATE" }, { receiverUrl: "http://example.com/hooks" }, { receiverUrl: "https://localhost/hooks" },
    { receiverUrl: "https://example.com/hooks?secret=PRIVATE" }]) {
    const fake = server();
    await rejectsCode(provisionGoogleRtdn(credentials, { ...expected, ...variant }, { fetcher: fake.fetcher, now: () => t0 }), "google_invalid_setup");
    assert.equal(fake.calls.length, 0);
  }
});

test("Cloud setup distinguishes disabled APIs only through structured Google error details and sanitizes all upstream errors", async () => {
  for (const [status, body, code] of [
    [403, { error: { message: "PRIVATE SERVICE_DISABLED https://example.com" } }, "google_api_permission_denied"],
    [403, { error: { details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED", domain: "googleapis.com" }] } }, "google_api_not_enabled"],
    [401, { error: { message: "PRIVATE SECRET_OAUTH" } }, "google_setup_unavailable"],
    [429, { error: { message: "PRIVATE" } }, "google_setup_unavailable"],
    [503, { error: { message: "PRIVATE" } }, "google_setup_unavailable"],
  ] as const) {
    const fake = server({ intercept: call => call.url === project ? Response.json(body, { status }) : undefined });
    await rejectsCode(provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 }), code);
  }
  for (const response of [() => new Response("PRIVATE not JSON"), () => Response.json({ projectNumber: "PRIVATE" }),
    () => { throw new Error("PRIVATE https://example.com/SECRET_OAUTH"); }]) {
    const fake = server({ intercept: call => call.url === project ? response() : undefined });
    await rejectsCode(provisionGoogleRtdn(credentials, expected, { fetcher: fake.fetcher, now: () => t0 }), "google_setup_unavailable");
  }
});
