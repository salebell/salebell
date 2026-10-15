import test from "node:test";
import assert from "node:assert/strict";
import { apiRequest, ProviderError, SupabaseProvider } from "./installer-providers.ts";

test("provider failures do not expose secret response bodies", async () => {
  await assert.rejects(apiRequest("https://api.supabase.com/v1/projects", {}, async () => new Response("token=private database password", { status: 403 })), (error: unknown) => error instanceof ProviderError && error.code === "provider_authorization" && !error.message.includes("private"));
  await assert.rejects(apiRequest("https://api.supabase.com/v1/projects", {}, async () => new Response("secret", { status: 429, headers: { "retry-after": "12" } })), (error: unknown) => error instanceof ProviderError && error.retryAfter === 12);
});
test("SQL request uses the authorized project and bounded nonredirecting fetch", async () => {
  let reached = false;
  const provider = new SupabaseProvider("abcdefghijklmnopqrst", "private", async (url, init) => {
    assert.equal(String(url), "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), { query: "select 1", read_only: false });
    reached = true;
    return Response.json([{ value: 1 }]);
  });
  assert.deepEqual(await provider.query("select 1"), [{ value: 1 }]);
  assert.ok(reached);
});
test("function upload preserves source paths and JWT protection", async () => {
  const provider = new SupabaseProvider("abcdefghijklmnopqrst", "private", async (_url, init) => {
    const form = init?.body as FormData;
    assert.deepEqual(JSON.parse(String(form.get("metadata"))), { name: "apple-test", entrypoint_path: "apple-test/index.ts", verify_jwt: true });
    const files = form.getAll("file") as File[];
    assert.deepEqual(files.map(file => file.name), ["apple-test/index.ts", "_shared/example.ts"]);
    assert.equal(await files[1].text(), "export const x = 1;");
    return Response.json({ slug: "apple-test", status: "ACTIVE" }, { status: 201 });
  });
  await provider.deployFunction({ slug: "apple-test", verifyJwt: true, files: [{ name: "apple-test/index.ts", content: "import '../_shared/example.ts';" }, { name: "_shared/example.ts", content: "export const x = 1;" }] });
});
