import test from "node:test";
import assert from "node:assert/strict";
import { advanceInstallation, bindTarget } from "./installer-runner.ts";
import { migrationSQL, reservationSQL } from "./installer-sql.ts";
import type { InstallJob, Release } from "./installer-types.ts";
import { SupabaseProvider } from "./installer-providers.ts";

const job = (): InstallJob => ({ id: "72b256b8-1426-4ac3-8d3a-9a77d85fae1f", version: 1, phase: "migrations", cursor: 0, createdAt: 100, expiresAt: Date.now() + 100000, supabase: { access: "s" }, target: { projectName: "salebell", supabaseRef: "abcdefghijklmnopqrst", supabaseName: "salebell", origin: "https://instance.vercel.app", publicKey: "public" } });
const release: Release = { id: "a".repeat(64), migrations: [{ name: "20261015000000_example.sql", sha256: "b".repeat(64), sql: "begin;\ncreate table public.example(id int);\ncommit;" }], functions: [] };
test("migration step checks the committed marker before applying after a lost response", async () => {
  let writes = 0;
  const db = new SupabaseProvider("abcdefghijklmnopqrst", "s", async (_url, init) => {
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.startsWith("select filename")) return Response.json([{ filename: "20261015000000_example.sql", sha256: "b".repeat(64) }]);
    writes++; return Response.json([]);
  });
  const next = await advanceInstallation(job(), release, { db, installerOrigin: "https://install.example" });
  assert.equal(next.cursor, 1); assert.equal(writes, 0);
});
test("migration checksum mismatch stops provisioning", async () => {
  const db = new SupabaseProvider("abcdefghijklmnopqrst", "s", async () => Response.json([{ filename: "20261015000000_example.sql", sha256: "wrong" }]));
  await assert.rejects(advanceInstallation(job(), release, { db, installerOrigin: "https://install.example" }), /migration_conflict/);
});
test("SQL wrapper validates migration identity and removes only its outer transaction", () => {
  const sql = migrationSQL(release.migrations[0]);
  assert.ok(sql.includes("pg_advisory_xact_lock"));
  assert.ok(sql.includes("create table public.example(id int);"));
  assert.ok(!sql.includes("'begin;"));
  assert.throws(() => migrationSQL({ ...release.migrations[0], name: "x';drop table apps;--" }));
  assert.throws(() => reservationSQL("not-a-uuid", release.id));
});
const info = { release: release.id, mode: "self_hosted", setup: true, origin: "https://instance.vercel.app", installerOrigin: "https://install.example", supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co", publicKey: "public" };
test("target binding checks authorized database keys before any provisioning", async () => {
  let mutations = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method && init.method !== "GET") mutations++;
    const path = new URL(String(url)).pathname;
    if (path === "/api/instance-release") return Response.json(info);
    if (path.endsWith("/api-keys")) return Response.json([{ name: "anon", api_key: "different" }]);
    return Response.json({ id: "abcdefghijklmnopqrst", name: "database" });
  };
  await assert.rejects(bindTarget(info.origin, "authorized", release, { origin: info.installerOrigin, controlUrl: "https://control.supabase.co" }, fetcher), /project_mismatch/);
  assert.equal(mutations, 0);
});
test("target binding excludes the operator website and control database", async () => {
  const config = { origin: info.installerOrigin, controlUrl: info.supabaseUrl };
  await assert.rejects(bindTarget("https://operator.vercel.app", "s", release, { ...config, origin: "https://operator.vercel.app" }, async () => { throw new Error("must not fetch"); }), /project_mismatch/);
  await assert.rejects(bindTarget(info.origin, "s", release, config, async () => Response.json(info)), /project_mismatch/);
});
test("target binding rejects a wrong release, mode, setup flag, installer or origin", async () => {
  for (const change of [{ release: "old" }, { mode: "cloud" }, { setup: false }, { installerOrigin: "https://other.example" }, { origin: "https://other.vercel.app" }, { supabaseUrl: "https://localhost" }]) {
    await assert.rejects(bindTarget(info.origin, "s", release, { origin: info.installerOrigin, controlUrl: "https://control.supabase.co" }, async () => Response.json({ ...info, ...change })), /project_mismatch|release_mismatch/);
  }
});
test("verification uses the ready website and never requests a second Vercel deployment", async () => {
  const value = job(); value.phase = "verify";
  const next = await advanceInstallation(value, release, { db: new SupabaseProvider("abcdefghijklmnopqrst", "s"), installerOrigin: info.installerOrigin, fetcher: async url => {
    const u = new URL(String(url));
    assert.equal(u.origin, info.origin);
    if (u.pathname === "/api/instance-release") return Response.json(info);
    if (u.pathname === "/api/instance-health") return Response.json({ release: release.id, mode: "self_hosted", origin: info.origin });
    return new Response(null, { status: 404 });
  } });
  assert.equal(next.phase, "owner");
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
  assert.equal((await advanceInstallation(value, release, { db, installerOrigin: "https://install.example", fetcher: async () => Response.json(info) })).phase, "migrations");
});
