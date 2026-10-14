import assert from "node:assert/strict";
import test from "node:test";
import { collectPages, eventCursor } from "./event-pages.ts";

test("an export fails instead of returning a partial set after a later page error", async () => {
  await assert.rejects(collectPages(async (from) => {
    if (from === 0) return { data: ["first", "second"], error: null };
    return { data: null, error: new Error("connection lost") };
  }, 2), /connection lost/);
});

test("an export collects every page and stops after a short final page", async () => {
  const rows = await collectPages(async (from) => ({ data: from === 0 ? ["a", "b"] : ["c"], error: null }), 2);
  assert.deepEqual(rows, ["a", "b", "c"]);
});

test("a database export error becomes a useful Error instead of an opaque object", async () => {
  await assert.rejects(collectPages(async () => ({ data: null, error: { message: "permission denied", code: "42501" } })),
    (error) => error instanceof Error && error.message === "permission denied");
});

test("descending pagination includes the ID tie-breaker at a shared timestamp", () => {
  assert.equal(eventCursor({ occurred_at: "2026-10-14T12:00:00+00:00", id: "abc-123" }),
    'occurred_at.lt."2026-10-14T12:00:00+00:00",and(occurred_at.eq."2026-10-14T12:00:00+00:00",id.lt.abc-123)');
});
