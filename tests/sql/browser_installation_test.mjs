import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { migrationSQL, reservationSQL, settingsSQL } from "../../web/lib/installer-sql.ts";

const binary = process.env.BROWSER_PSQL_BIN;
const args = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-h", process.env.BROWSER_PGHOST, "-p", process.env.BROWSER_PGPORT, "-U", "postgres", "-d", "salebell_browser_install_test"];
function run(sql, expectedError) {
  const result = spawnSync(binary, args, { input: sql, encoding: "utf8" });
  if (expectedError) {
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(expectedError), result.stderr);
  } else assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const release = JSON.parse(readFileSync(new URL("../../web/installer/release.json", import.meta.url), "utf8"));
const id = "72b256b8-1426-4ac3-8d3a-9a77d85fae1f";
run(`begin; create table public.unrelated(id int);\n${reservationSQL(id, release.id).replace(/^begin;/, "")}`, "project_not_empty");
run(reservationSQL(id, release.id));
for (const migration of release.migrations) run(migrationSQL(migration));
for (const migration of release.migrations) run(migrationSQL(migration));
assert.equal(run("select count(*) from private.browser_migrations;"), String(release.migrations.length));
run(settingsSQL("abcdefghijklmnopqrst"));
run(settingsSQL("abcdefghijklmnopqrst"));
assert.equal(run("select public.instance_settings()->>'deployment_mode';"), "self_hosted");
assert.equal(run("select count(*) from vault.secrets where name = 'project_url';"), "1");
run(migrationSQL({ ...release.migrations[0], sha256: "0".repeat(64) }), "migration_conflict");
run(reservationSQL("72b256b8-1426-4ac3-8d3a-9a77d85fae20", release.id), "installation_conflict");
console.log("Browser installation SQL: all migrations applied, replayed and conflict-checked.");
