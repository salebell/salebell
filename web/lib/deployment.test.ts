import assert from "node:assert/strict";
import test from "node:test";
import { deploymentMode, instanceSettings, hasFullFeatures, initialSignInStep, cloudBillingPath } from "./deployment.ts";

test("deployment mode defaults to cloud and rejects misspelled modes", () => {
  assert.equal(deploymentMode(undefined), "cloud");
  assert.equal(deploymentMode("self_hosted"), "self_hosted");
  assert.throws(() => deploymentMode("self-hosted"), /cloud.*self_hosted/);
});

test("authoritative self-hosted settings unlock features without a Pro subscription", () => {
  const settings = instanceSettings({ deployment_mode: "self_hosted", billing_enabled: false });
  assert.equal(hasFullFeatures("free", settings), true);
  assert.equal(settings.billingEnabled, false);
});

test("cloud Free remains limited and cloud Pro retains full features", () => {
  const settings = instanceSettings({ deployment_mode: "cloud", billing_enabled: true });
  assert.equal(hasFullFeatures("free", settings), false);
  assert.equal(hasFullFeatures("pro", settings), true);
});

test("invalid instance settings cannot silently unlock a workspace", () => {
  assert.throws(() => instanceSettings(null), /instance settings/i);
  assert.throws(() => instanceSettings({ deployment_mode: "self_hosted" }), /instance settings/i);
  assert.equal(instanceSettings({ deployment_mode: "self_hosted", billing_enabled: true }).billingEnabled, false);
});

test("self-hosted sign-in defaults to password and resumes an unexpired email-code request", () => {
  assert.equal(initialSignInStep("self_hosted", false), "password");
  assert.equal(initialSignInStep("self_hosted", true), "code");
  assert.equal(initialSignInStep("cloud", false), "email");
  assert.equal(initialSignInStep("cloud", true), "code");
});

test("pricing carries the chosen interval through sign-in to billing", () => {
  assert.equal(cloudBillingPath("month"), "/app/billing?interval=month");
  assert.equal(cloudBillingPath("year"), "/app/billing?interval=year");
});
