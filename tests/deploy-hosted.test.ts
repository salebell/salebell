import assert from "node:assert/strict";
import test from "node:test";
import { hostedMigrationSQL } from "../scripts/deploy-hosted.mjs";
import { sqlLiteral } from "../web/lib/installer-sql.ts";

test("hosted installer preserves dollar quoting and regex anchors in migration history", () => {
  const sql = "begin;\ncreate function public.example() returns text language sql as $$ select '$&'::text $$;\nselect 'https://[^[:space:]]*$';\ncommit;";
  const result = hostedMigrationSQL({ name: "20261016000000_example.sql", sha256: "a".repeat(64), sql });
  assert.ok(result.includes(`array[${sqlLiteral(sql)}]`), "CLI migration history must store the exact original SQL");
  assert.ok(result.endsWith("on conflict(version) do nothing;\ncommit;"));
});
