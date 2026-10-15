import type { GoogleServiceAccount } from "./google_play_api.ts";
import { isAllowedHostname } from "./net.ts";

export type GoogleCloudCredentials = GoogleServiceAccount & { project_id: string; type?: string };
export class GoogleSetupError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = "GoogleSetupError"; this.code = code; }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBSUB_URL = "https://pubsub.googleapis.com/v1/";
const IAM_URL = "https://iam.googleapis.com/v1/";
const PROJECT_URL = "https://cloudresourcemanager.googleapis.com/v1/projects/";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE = 262_144;
type ObjectValue = Record<string, unknown>;
const record = (value: unknown): value is ObjectValue => !!value && typeof value === "object" && !Array.isArray(value);
function fail(code = "google_setup_unavailable"): never { throw new GoogleSetupError(code); }
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodedJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** Bounded parsing never retains an upstream response in an exception. */
async function responseJson(response: Response): Promise<ObjectValue> {
  const reader = response.body?.getReader();
  if (!reader || Number(response.headers.get("content-length")) > MAX_RESPONSE) {
    await reader?.cancel();
    return fail();
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE) { await reader.cancel(); return fail(); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const result: unknown = JSON.parse(text);
  if (!record(result)) return fail();
  return result;
}

/** This changes only app-specific resources; unrelated subscriptions are never patched. */
export async function provisionGoogleRtdn(credentials: GoogleCloudCredentials, expected: { appId: string; receiverUrl: string },
  options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<{ topic: string; subscription: string; serviceAccountEmail: string }> {
  try {
    if (!credentials || typeof credentials.project_id !== "string" || !PROJECT_ID.test(credentials.project_id)
      || (credentials.type !== undefined && credentials.type !== "service_account")
      || typeof credentials.client_email !== "string" || credentials.client_email.length > 254
      || !/^[a-z0-9][a-z0-9-]*@/.test(credentials.client_email)
      || credentials.client_email.split("@").length !== 2
      || credentials.client_email.split("@")[1] !== `${credentials.project_id}.iam.gserviceaccount.com`
      || typeof credentials.private_key !== "string" || credentials.private_key.length > 16_384
      || (credentials.private_key_id !== undefined && (typeof credentials.private_key_id !== "string"
        || !/^[A-Za-z0-9_-]{1,256}$/.test(credentials.private_key_id)))) fail("google_invalid_credentials");
    if (!expected || typeof expected.appId !== "string" || !UUID.test(expected.appId)
      || typeof expected.receiverUrl !== "string" || expected.receiverUrl.length > 2_048) fail("google_invalid_setup");
    try {
      const receiver = new URL(expected.receiverUrl);
      if (receiver.protocol !== "https:" || !isAllowedHostname(receiver.hostname) || receiver.username || receiver.password
        || receiver.search || receiver.hash || receiver.port || /[\s\x00-\x1f]/.test(expected.receiverUrl)) throw new Error();
    } catch { fail("google_invalid_setup"); }

    let key: CryptoKey;
    try {
      const pem = credentials.private_key.replace(/\\n/g, "\n");
      if (!/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/.test(pem)) throw new Error();
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), c => c.charCodeAt(0));
      key = await crypto.subtle.importKey("pkcs8", der, RSA, false, ["sign"]);
      if ((key.algorithm as RsaHashedKeyAlgorithm).modulusLength < 2048) throw new Error();
    } catch { return fail("google_invalid_credentials"); }

    const fetcher = options.fetcher ?? fetch;
    const send = async (url: string, method: string, body?: unknown, token?: string) => fetcher(url, {
      method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const seconds = Math.floor((options.now ?? Date.now)() / 1000);
    if (!Number.isSafeInteger(seconds) || seconds < 0) fail();
    const jwt = `${encodedJson({ alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) })}.${encodedJson({
      iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600,
    })}`;
    const signature = await crypto.subtle.sign(RSA, key!, new TextEncoder().encode(jwt));
    const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${jwt}.${base64url(new Uint8Array(signature))}` });
    const oauthResponse = await fetcher(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(), redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!oauthResponse.ok) { await oauthResponse.body?.cancel(); fail(); }
    const oauth = await responseJson(oauthResponse);
    if (typeof oauth.access_token !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(oauth.access_token)
      || typeof oauth.token_type !== "string" || oauth.token_type.toLowerCase() !== "bearer"
      || typeof oauth.expires_in !== "number" || !Number.isFinite(oauth.expires_in) || oauth.expires_in <= 0) fail();
    const token = oauth.access_token as string;

    // Error classification uses only structured codes; Google messages can contain secrets.
    const request = async (url: string, method = "GET", body?: unknown, allowed: number[] = []): Promise<ObjectValue | number> => {
      const response = await send(url, method, body, token);
      if (allowed.includes(response.status)) { await response.body?.cancel(); return response.status; }
      if (!response.ok) {
        if (response.status === 403) {
          let disabled = false;
          try {
            const result = await responseJson(response);
            disabled = record(result.error) && Array.isArray(result.error.details) && result.error.details.some(detail => record(detail)
              && detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && detail.reason === "SERVICE_DISABLED");
          } catch { /* Malformed error responses still deny permission. */ }
          fail(disabled ? "google_api_not_enabled" : "google_api_permission_denied");
        }
        await response.body?.cancel();
        fail();
      }
      return responseJson(response);
    };
    const project = await request(PROJECT_URL + credentials.project_id);
    if (!record(project) || project.projectId !== credentials.project_id || typeof project.projectNumber !== "string"
      || !/^[1-9][0-9]{0,29}$/.test(project.projectNumber)) fail();
    const name = `salebell-${expected.appId.replace(/-/g, "").toLowerCase()}`;
    const topic = `projects/${credentials.project_id}/topics/${name}`;
    const subscription = `projects/${credentials.project_id}/subscriptions/${name}`;
    const topicUrl = PUBSUB_URL + topic, subscriptionUrl = PUBSUB_URL + subscription;
    const serviceAccountUrl = `${IAM_URL}projects/${credentials.project_id}/serviceAccounts/${credentials.client_email}`;
    const desired = { topic, pushConfig: { pushEndpoint: expected.receiverUrl,
      oidcToken: { serviceAccountEmail: credentials.client_email, audience: expected.receiverUrl } },
      ackDeadlineSeconds: 60, expirationPolicy: {}, retryPolicy: { minimumBackoff: "10s", maximumBackoff: "600s" } };
    const conflict = () => fail("google_resource_conflict");
    const noTransforms = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);
    const validateTopic = (value: ObjectValue | number) => {
      if (!record(value) || typeof value.name !== "string") fail();
      if (value.name !== topic || value.schemaSettings !== undefined || value.ingestionDataSourceSettings !== undefined
        || !noTransforms(value.messageTransforms)) conflict();
    };
    const validateSubscription = (value: ObjectValue | number) => {
      if (!record(value) || typeof value.name !== "string") fail();
      if (value.name !== subscription || value.topic !== topic || !record(value.pushConfig)
        || value.pushConfig.pushEndpoint !== expected.receiverUrl || !record(value.pushConfig.oidcToken)
        || value.pushConfig.oidcToken.serviceAccountEmail !== credentials.client_email || value.pushConfig.oidcToken.audience !== expected.receiverUrl
        || value.pushConfig.noWrapper !== undefined || (value.pushConfig.pubsubWrapper !== undefined && !record(value.pushConfig.pubsubWrapper))
        || value.ackDeadlineSeconds !== 60 || !record(value.expirationPolicy) || value.expirationPolicy.ttl !== undefined
        || !record(value.retryPolicy) || value.retryPolicy.minimumBackoff !== "10s" || value.retryPolicy.maximumBackoff !== "600s"
        || (value.filter !== undefined && value.filter !== "") || (value.detached !== undefined && value.detached !== false)
        || value.bigqueryConfig !== undefined || value.cloudStorageConfig !== undefined || value.bigtableConfig !== undefined
        || value.deadLetterPolicy !== undefined || !noTransforms(value.messageTransforms)) conflict();
    };
    // Preflight both names before IAM writes, so an existing delivery conflict has no mutations.
    const existingTopic = await request(topicUrl, "GET", undefined, [404]);
    const existingSubscription = await request(subscriptionUrl, "GET", undefined, [404]);
    if (existingTopic !== 404) validateTopic(existingTopic);
    if (existingSubscription !== 404) validateSubscription(existingSubscription);
    const create = async (url: string, body: unknown, validate: (value: ObjectValue | number) => void) => {
      const result = await request(url, "PUT", body, [409]);
      validate(result === 409 ? await request(url) : result);
    };
    if (existingTopic === 404) await create(topicUrl, {}, validateTopic);

    /** Read/merge/write with etags preserves conditions, audit settings and concurrent grants. */
    const grant = async (url: string, method: "GET" | "POST", role: string, member: string) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const policy = await request(`${url}:getIamPolicy?options.requestedPolicyVersion=3`, method);
        if (!record(policy) || (policy.bindings !== undefined && !Array.isArray(policy.bindings))
          || (policy.etag !== undefined && typeof policy.etag !== "string")) fail();
        const bindings = (policy.bindings ?? []) as unknown[];
        if (bindings.length > 500 || bindings.some(binding => !record(binding) || typeof binding.role !== "string"
          || !Array.isArray(binding.members) || binding.members.some(member => typeof member !== "string"))) fail();
        const unconditional = bindings.find(binding => record(binding) && binding.role === role && binding.condition === undefined) as ObjectValue | undefined;
        if (unconditional && (unconditional.members as string[]).includes(member)) return;
        if (bindings.length && !policy.etag) fail();
        const merged = bindings.map(binding => unconditional && binding === unconditional
          ? { ...unconditional, members: [...unconditional.members as string[], member] } : binding);
        if (!unconditional) merged.push({ role, members: [member] });
        const result = await request(`${url}:setIamPolicy`, "POST", { policy: { ...policy, bindings: merged } }, [409]);
        if (result !== 409) {
          if (!record(result) || !Array.isArray(result.bindings) || !result.bindings.some(binding => record(binding)
            && binding.role === role && binding.condition === undefined && Array.isArray(binding.members) && binding.members.includes(member))) fail();
          return;
        }
      }
      fail();
    };
    await grant(topicUrl, "GET", "roles/pubsub.publisher", "serviceAccount:google-play-developer-notifications@system.gserviceaccount.com");
    await grant(serviceAccountUrl, "POST", "roles/iam.serviceAccountTokenCreator",
      `serviceAccount:service-${project.projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`);
    if (existingSubscription === 404) await create(subscriptionUrl, desired, validateSubscription);
    return { topic, subscription, serviceAccountEmail: credentials.client_email };
  } catch (error) {
    if (error instanceof GoogleSetupError) throw error;
    return fail();
  }
}
