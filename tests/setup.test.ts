import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { localEnvironment, updateLocalEnv } from "../scripts/dev.mjs";
import { readSetupEnv } from "../scripts/setup-env.mjs";

const run = promisify(execFile);
const OWNER = new URL("../scripts/setup.sh", import.meta.url).pathname;

test("local env uses only local Supabase public keys and preserves optional settings", () => {
  const values = localEnvironment({ API_URL: "http://127.0.0.1:54321", PUBLISHABLE_KEY: "sb_publishable_local", SERVICE_ROLE_KEY: "never_copy" });
  assert.equal(Object.keys(values).length, 4);
  assert.equal(values.NEXT_PUBLIC_DEPLOYMENT_MODE, "self_hosted");
  assert.equal(localEnvironment({ API_URL: "http://localhost:54321", ANON_KEY: "key" }, "cloud").NEXT_PUBLIC_DEPLOYMENT_MODE, "cloud");
  assert.throws(() => localEnvironment({ API_URL: "http://localhost:54321", ANON_KEY: "key" }, "invalid"), /deployment mode/);
  assert.equal(values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "sb_publishable_local");
  assert.equal(localEnvironment({ API_URL: "http://localhost:54321", ANON_KEY: "legacy_public_key" }).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "legacy_public_key");
  const updated = updateLocalEnv("# Keep this\nNEXT_PUBLIC_SUPABASE_URL=http://localhost:54321\nNEXT_PUBLIC_SUPPORT_EMAIL=support@example.com\n", values);
  assert.match(updated, /# Keep this/);
  assert.match(updated, /NEXT_PUBLIC_SUPPORT_EMAIL=support@example.com/);
  assert.match(updated, /NEXT_PUBLIC_SUPABASE_URL=http:\/\/127.0.0.1:54321/);
  assert.doesNotMatch(updated, /never_copy/);
  assert.throws(() => localEnvironment({ API_URL: "https://hosted.supabase.co", ANON_KEY: "key" }), /only starts local/);
  assert.throws(() => updateLocalEnv("NEXT_PUBLIC_SUPABASE_URL=https://hosted.supabase.co\n", values), /Move that file aside/);
  assert.throws(() => updateLocalEnv("NEXT_PUBLIC_SITE_URL=https://salebell.vercel.app\n", values), /hosted NEXT_PUBLIC_SITE_URL/);
});

test("dev --setup-only runs local commands and writes generated env without owner credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "salebell-dev-"));
  try {
    mkdirSync(join(dir, "scripts")); mkdirSync(join(dir, "web")); mkdirSync(join(dir, "bin"));
    copyFileSync(new URL("../scripts/dev.mjs", import.meta.url), join(dir, "scripts/dev.mjs"));
    writeFileSync(join(dir, "web/.env.local.example"), "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\n");
    writeFileSync(join(dir, ".env.setup"), "echo must_not_run > owner-was-run\n");
    const log = join(dir, "commands");
    for (const command of ["docker", "npm", "supabase"]) {
      writeFileSync(join(dir, "bin", command), `#!/bin/sh\nprintf '%s\\n' '${command} '"$*" >> "$COMMAND_LOG"\n${command === "supabase" ? `if [ "$1" = status ]; then printf '%s\\n' '{"API_URL":"http://127.0.0.1:54321","ANON_KEY":"local-public-key"}'; fi` : ""}\n`, { mode: 0o755 });
    }
    const npmStub = join(dir, "bin/npm.mjs");
    writeFileSync(npmStub, 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.COMMAND_LOG, `npm ${process.argv.slice(2).join(" ")}\\n`);');
    await run(process.execPath, [join(dir, "scripts/dev.mjs"), "--setup-only"], { env: { PATH: join(dir, "bin"), COMMAND_LOG: log, npm_execpath: npmStub } });
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["supabase --version", "docker info", "npm ci --prefix web", "supabase start", "supabase migration up --local", "supabase db query --local update private.instance_settings set deployment_mode = 'self_hosted' where singleton;", "supabase status -o json"]);
    assert.match(readFileSync(join(dir, "web/.env.local"), "utf8"), /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-public-key/);
    assert.match(readFileSync(join(dir, "web/.env.local"), "utf8"), /NEXT_PUBLIC_DEPLOYMENT_MODE=self_hosted/);
    assert.equal(existsSync(join(dir, "owner-was-run")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("owner env treats shell substitutions as literal data and ignores arbitrary environment variables", () => {
  assert.deepEqual(Object.fromEntries(readSetupEnv('STRIPE_SECRET_KEY="$(touch unwanted)"\nPATH=/bad\nNODE_OPTIONS=--bad\nSENDER_EMAIL="hello@example.com"\n')), {
    STRIPE_SECRET_KEY: "$(touch unwanted)", SENDER_EMAIL: "hello@example.com",
  });
});

test("owner check does not auto-load .env.setup or call external services", async () => {
  const { stdout } = await run("bash", [OWNER, "--check", "--project-ref", "abcdefghijklmnopqrst", "--site-url", "https://example.com", "--steps", "auth"], { env: { PATH: process.env.PATH } });
  assert.match(stdout, /Validation only; no remote changes/);
  assert.match(stdout, /auth: credentials missing/);
  assert.doesNotMatch(stdout, /email:|stripe:|push:/);
  await assert.rejects(run("bash", [OWNER, "--yes", "--check", "--project-ref", "abcdefghijklmnopqrst", "--site-url", "https://example.com"], { env: { PATH: process.env.PATH } }), /--yes requires an explicit --env-file/);
});

test("owner check reads only an explicit dotenv file without executing its contents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "salebell-owner-"));
  try {
    const file = join(dir, "setup.env");
    const marker = join(dir, "executed");
    writeFileSync(file, `SUPABASE_PROJECT_REF=abcdefghijklmnopqrst\nSITE_URL=https://example.com\nSUPABASE_ACCESS_TOKEN="$(touch '${marker}')"\nRESEND_API_KEY=re_test\nSENDER_EMAIL=hello@example.com\n`);
    const { stdout } = await run("bash", [OWNER, "--env-file", file, "--check", "--steps", "email"], { env: { PATH: process.env.PATH } });
    assert.match(stdout, /email: credentials present/);
    assert.equal(existsSync(marker), false);
    assert.doesNotMatch(stdout, /re_test|touch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("owner auth setup supplies the automation origin without requiring Stripe", async () => {
  const dir = mkdtempSync(join(tmpdir(), "salebell-auth-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const authFile = join(dir, "auth.json");
    const secretsFile = join(dir, "secrets.env");
    const envFile = join(dir, "owner.env");
    writeFileSync(envFile, "SUPABASE_PROJECT_REF=abcdefghijklmnopqrst\nSITE_URL=https://example.com\nSUPABASE_ACCESS_TOKEN=sbp_dummy_test_token\n");
    writeFileSync(join(bin, "curl"), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--data-binary" ]; then shift; /bin/cp "${1#@}" "$CAPTURE_AUTH"; fi\n  shift\ndone\n', { mode: 0o755 });
    writeFileSync(join(bin, "supabase"), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = "--env-file" ]; then shift; /bin/cp "$1" "$CAPTURE_SECRETS"; fi\n  shift\ndone\n', { mode: 0o755 });
    const { stdout } = await run("bash", [OWNER, "--env-file", envFile, "--yes", "--steps", "auth"], {
      env: { PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`, CAPTURE_AUTH: authFile, CAPTURE_SECRETS: secretsFile },
    });
    const auth = JSON.parse(readFileSync(authFile, "utf8"));
    assert.equal(auth.site_url, "https://example.com");
    assert.equal(auth.mailer_otp_length, 6);
    assert.equal(readFileSync(secretsFile, "utf8"), 'SITE_URL="https://example.com"\n');
    assert.doesNotMatch(stdout, /sbp_dummy_test_token/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
