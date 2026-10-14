import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { parseEnv } from "node:util";
import { initialize, validateOrigin, encodeEnv } from "../scripts/self-host.mjs";

test("self-host initialization creates unique signed keys and private owner credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "salebell-install-"));
  try {
    initialize(directory, { siteUrl: "https://sales.example.com/", apiUrl: "https://api.example.com", email: "owner@example.com", project: "salebell-test" });
    const first = readFileSync(join(directory, ".env"), "utf8");
    const env = parseEnv(first);
    assert.equal(env.SITE_URL, "https://sales.example.com");
    assert.equal(env.SUPABASE_PUBLIC_URL, "https://api.example.com");
    assert.equal(env.OWNER_EMAIL, "owner@example.com");
    assert.equal(env.DISABLE_SIGNUP, "true");
    assert.equal(env.SMTP_HOST, "");
    for (const [name, role] of [["ANON_KEY", "anon"], ["SERVICE_ROLE_KEY", "service_role"]]) {
      const [header, body, signature] = env[name].split(".");
      assert.equal(JSON.parse(Buffer.from(body, "base64url").toString()).role, role);
      assert.equal(signature, createHmac("sha256", env.JWT_SECRET).update(`${header}.${body}`).digest("base64url"));
    }
    assert.notEqual(env.ANON_KEY, env.SERVICE_ROLE_KEY);
    const second = join(directory, "another-install");
    initialize(second, { siteUrl: "https://sales.example.com", apiUrl: "https://api.example.com", email: "owner@example.com" });
    const other = parseEnv(readFileSync(join(second, ".env"), "utf8"));
    assert.notEqual(env.JWT_SECRET, other.JWT_SECRET);
    assert.notEqual(env.POSTGRES_PASSWORD, other.POSTGRES_PASSWORD);
    assert.ok(readFileSync(join(directory, "owner-password"), "utf8").trim().length >= 32);
    assert.equal(statSync(join(directory, ".env")).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, "owner-password")).mode & 0o777, 0o600);
    assert.throws(() => initialize(directory, { siteUrl: "https://changed.example.com", apiUrl: "https://api.example.com", email: "owner@example.com" }), /already initialized/i);
    assert.equal(readFileSync(join(directory, ".env"), "utf8"), first);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an interrupted initialization never overwrites an existing owner password", () => {
  const directory = mkdtempSync(join(tmpdir(), "salebell-interrupted-"));
  try {
    writeFileSync(join(directory, "owner-password"), "existing-private-password", { mode: 0o600 });
    assert.throws(() => initialize(directory, { siteUrl: "https://sales.example.com", apiUrl: "https://api.example.com", email: "owner@example.com" }), /already initialized/i);
    assert.equal(readFileSync(join(directory, "owner-password"), "utf8"), "existing-private-password");
    assert.throws(() => readFileSync(join(directory, ".env")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("production URLs reject path injection, credentials, insecure origins and matching hostnames", () => {
  for (const value of ["http://example.com", "https://example.com/backend", "https://user:password@example.com", "https://example.com?x=1", "https://example.com#fragment", "https://example.com:443", "https://example.com\nfoo"]) {
    assert.throws(() => validateOrigin(value));
  }
  assert.equal(validateOrigin("https://example.com/"), "https://example.com");
  const directory = mkdtempSync(join(tmpdir(), "salebell-invalid-"));
  try {
    assert.throws(() => initialize(directory, { siteUrl: "https://example.com", apiUrl: "https://example.com", email: "owner@example.com" }), /different/i);
    assert.equal(statSync(directory).isDirectory(), true);
    assert.throws(() => readFileSync(join(directory, ".env")));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("dotenv values retain literal interpolation and multiline private keys", () => {
  const values = { SMTP_PASS: "p$word #quote' ", APNS_KEY_P8: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----" };
  assert.deepEqual({ ...parseEnv(encodeEnv(values)) }, values);
  assert.throws(() => encodeEnv({ PASSWORD: "bad\0value" }), /NUL/);
});

test("production URLs reject ports that the TLS proxy does not publish", () => {
  assert.throws(() => validateOrigin("https://sales.example.com:8443"), /without.*port/);
  assert.throws(() => validateOrigin("https://api.example.com:54321"), /without.*port/);
});
