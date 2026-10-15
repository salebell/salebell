import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGoogleConfigureRequest, googleConnectionVerified, googleFunctionError, googleSetupError, parseGoogleCredentialFile } from "./google-connect.ts";

const credentials = {
  type: "service_account" as const,
  project_id: "example-project",
  client_email: "notifications@example-project.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(512)}\n-----END PRIVATE KEY-----`,
};

test("Google JSON import keeps only supported service-account fields and normalizes key newlines", () => {
  const text = JSON.stringify({ ...credentials, private_key: credentials.private_key.replaceAll("\n", "\r\n"), token_uri: "https://untrusted.example/token", private_key_id: "example-key-id" });
  assert.deepEqual(parseGoogleCredentialFile("service-account.json", text), { ...credentials, private_key_id: "example-key-id" });
});

test("Google JSON import rejects unsupported credentials and oversize files without exposing secrets", () => {
  for (const [name, text] of [
    ["key.txt", JSON.stringify(credentials)],
    ["key.json", "SECRET_DO_NOT_ECHO"],
    ["key.json", "[]"],
    ["key.json", JSON.stringify({ ...credentials, type: "authorized_user" })],
    ["key.json", JSON.stringify({ ...credentials, project_id: "" })],
    ["key.json", JSON.stringify({ ...credentials, client_email: "person@example.com" })],
    ["key.json", JSON.stringify({ ...credentials, private_key: "SECRET_DO_NOT_ECHO" })],
    ["key.json", " ".repeat(32_769)],
  ]) {
    assert.throws(() => parseGoogleCredentialFile(name, text), (error: unknown) => error instanceof Error && !error.message.includes("SECRET_DO_NOT_ECHO"));
  }
});

test("automatic configure sends the app and parsed credentials without manual fields", () => {
  assert.deepEqual(buildGoogleConfigureRequest("example-app-id", credentials, "automatic", { topic: "stale", subscription: "stale", serviceAccountEmail: "stale" }), {
    action: "configure", app_id: "example-app-id", credentials, mode: "automatic",
  });
});

test("manual configure requires full Pub/Sub resources and trims optional push identity", () => {
  assert.throws(() => buildGoogleConfigureRequest("example-app-id", credentials, "manual", { topic: "topic", subscription: "subscription", serviceAccountEmail: "" }));
  assert.throws(() => buildGoogleConfigureRequest("example-app-id", credentials, "manual", { topic: "projects/example-project/topics/events", subscription: "", serviceAccountEmail: "" }));
  assert.deepEqual(buildGoogleConfigureRequest("example-app-id", credentials, "manual", { topic: " projects/example-project/topics/events ", subscription: " projects/example-project/subscriptions/events-push ", serviceAccountEmail: " " }), {
    action: "configure", app_id: "example-app-id", credentials, mode: "manual", topic: "projects/example-project/topics/events", subscription: "projects/example-project/subscriptions/events-push",
  });
  assert.throws(() => buildGoogleConfigureRequest("example-app-id", credentials, "manual", { topic: "projects/example-project/topics/events", subscription: "projects/example-project/subscriptions/events-push", serviceAccountEmail: "person@example.com" }));
});

test("connection verification requires a persisted event at or after the current setup", () => {
  const connection = { updated_at: "2026-10-14T12:00:00Z" };
  assert.equal(googleConnectionVerified(connection, { last_event_production_at: "2026-10-14T11:59:59Z", last_event_sandbox_at: null }), false);
  assert.equal(googleConnectionVerified(connection, { last_event_production_at: null, last_event_sandbox_at: "2026-10-14T12:00:00Z" }), true);
  assert.equal(googleConnectionVerified(connection, { last_event_production_at: "invalid", last_event_sandbox_at: null }), false);
  assert.equal(googleConnectionVerified(null, { last_event_production_at: "2026-10-14T12:01:00Z", last_event_sandbox_at: null }), false);
});

test("Google setup errors give permission recovery while hiding unknown server details", () => {
  assert.match(googleSetupError("google_api_permission_denied"), /manual/i);
  assert.match(googleSetupError("google_api_not_enabled"), /Pub\/Sub API/);
  assert.equal(googleSetupError("SECRET_DO_NOT_ECHO"), "Couldn't complete Google setup. Try again.");
});

test("Google discovery errors identify the Reporting API prerequisite and hide raw provider details", async () => {
  const disabled = { context: Response.json({ error: "google_api_not_enabled", details: "SECRET_DO_NOT_ECHO" }) };
  const message = await googleFunctionError(disabled, "discover");
  assert.match(message, /playdeveloperreporting\.googleapis\.com/);
  assert.equal(message.includes("SECRET_DO_NOT_ECHO"), false);
  assert.match(await googleFunctionError({ context: Response.json({ error: "google_api_permission_denied" }) }, "discover"), /Play Console/);
  assert.equal(await googleFunctionError({ context: Response.json({ error: "SECRET_DO_NOT_ECHO" }) }, "discover"), "Couldn't complete Google setup. Try again.");
});
