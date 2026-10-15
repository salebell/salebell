import test from "node:test";
import assert from "node:assert/strict";
import { advanceInstallation, bindTarget } from "./installer-runner.ts";
import { migrationSQL, reservationSQL } from "./installer-sql.ts";
import type { InstallJob, Release } from "./installer-types.ts";
import { SupabaseProvider, VercelProvider } from "./installer-providers.ts";

const job = (): InstallJob => ({ id: "72b256b8-1426-4ac3-8d3a-9a77d85fae1f", version: 1, phase: "migrations", cursor: 0, createdAt: 100, expiresAt: Date.now() + 100000, vercel: { access: "v", configurationId: "icfg_x" }, supabase: { access: "s" }, target: { projectId: "prj_x", projectName: "salebell", supabaseRef: "abcdefghijklmnopqrst", supabaseName: "salebell", origin: "https://instance.vercel.app", publicKey: "public", configurationId: "icfg_x" } });
const release: Release = { id: "a".repeat(64), migrations: [{ name: "20261015000000_example.sql", sha256: "b".repeat(64), sql: "begin;\ncreate table public.example(id int);\ncommit;" }], functions: [] };
test("migration step checks the committed marker before applying after a lost response", async () => {
  let writes = 0;
  const db = new SupabaseProvider("abcdefghijklmnopqrst", "s", async (_url, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.startsWith("select filename")) return Response.json([{ filename: "20261015000000_example.sql", sha256: "b".repeat(64) }]);
    writes++; return Response.json([]);
  });
  const next = await advanceInstallation(job(), release, { db, vercel: new VercelProvider("v"), revision: "c".repeat(40) });
  assert.equal(next.cursor, 1); assert.equal(writes, 0);
});
test("migration checksum mismatch stops provisioning", async () => {
  const db = new SupabaseProvider("abcdefghijklmnopqrst", "s", async () => Response.json([{ filename: "20261015000000_example.sql", sha256: "wrong" }]));
  await assert.rejects(advanceInstallation(job(), release, { db, vercel: new VercelProvider("v"), revision: "c".repeat(40) }), /migration_conflict/);
});
test("SQL wrapper validates migration identity and removes only its outer transaction", () => {
  const sql = migrationSQL(release.migrations[0]);
  assert.ok(sql.includes("pg_advisory_xact_lock"));
  assert.ok(sql.includes("create table public.example(id int);"));
  assert.ok(!sql.includes("'begin;"));
  assert.throws(() => migrationSQL({ ...release.migrations[0], name: "x';drop table apps;--" }));
  assert.throws(() => reservationSQL("not-a-uuid", release.id));
});
test("target binding rejects mismatched Supabase environment before any provisioning", async () => {
  const v = new VercelProvider("v", undefined, async url => {
    const path = new URL(String(url)).pathname;
    if (path.includes("configuration")) return Response.json({ id: "icfg_x", integrationId: "oac_x", projects: ["prj_x"] });
    if (path.endsWith("/env")) return Response.json({ envs: [{ key: "NEXT_PUBLIC_SUPABASE_URL", value: "https://wrong.example" }] });
    if (path.endsWith("/domains")) return Response.json({ domains: [{ name: "instance.vercel.app" }] });
    return Response.json({ id: "prj_x", name: "salebell", link: { type: "github", repoId: 1 } });
  });
  const s = new SupabaseProvider("abcdefghijklmnopqrst", "s", async () => Response.json({ id: "abcdefghijklmnopqrst", name: "database" }));
  await assert.rejects(bindTarget(job(), "prj_x", v, s, "oac_x"), /project_mismatch/);
});
test("retry of a failed web deployment schedules a new deployment rather than polling the failed one", async () => {
  const value = job(); value.phase = "verify"; value.error = "deployment_failed"; value.deploymentId = "dpl_failed";
  const next = await advanceInstallation(value, release, { db: new SupabaseProvider("abcdefghijklmnopqrst", "s"), vercel: new VercelProvider("v"), revision: "c".repeat(40) });
  assert.equal(next.phase, "deploy"); assert.equal(next.deploymentId, undefined); assert.equal(next.error, undefined);
});
test("signup closes before the locked empty-project check and application migrations", async () => {
  let closed = false;
  const db = new SupabaseProvider("abcdefghijklmnopqrst", "s", async (url, init) => {
    if (new URL(String(url)).pathname.endsWith("/functions")) return Response.json([]);
    if (new URL(String(url)).pathname.endsWith("/config/auth")) { closed = true; return Response.json({}); }
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.startsWith("select to_regclass")) return Response.json([{ installed: null }]);
    if (query.startsWith("select exists")) return Response.json([{ occupied: false }]);
    assert.equal(closed, true, "registration is closed before reserving a checked empty project");
    return Response.json([]);
  });
  const value = job(); value.phase = "validate";
  assert.equal((await advanceInstallation(value, release, { db, vercel: new VercelProvider("v"), revision: "c".repeat(40) })).phase, "migrations");
});
