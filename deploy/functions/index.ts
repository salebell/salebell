// Standalone Supabase Edge Runtime entrypoint. Auth remains in each existing handler:
// user handlers resolve the session through Auth; webhooks verify provider signatures.
// Supabase config.toml is for the CLI and is deliberately not used in production.
const functions = new Set([
  "apple-webhook", "apple-credentials", "apple-connect", "apple-test", "test-alert",
  "fx-refresh", "billing", "stripe-webhook", "google-webhook", "google-connect", "delete-account",
]);

Deno.serve(async (request: Request) => {
  const slug = new URL(request.url).pathname.split("/")[1];
  if (!functions.has(slug)) return Response.json({ error: "function_not_found" }, { status: 404 });
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${slug}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 400_000,
      noModuleCache: false,
      envVars: Object.entries({ ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: slug }),
    });
    return await worker.fetch(request);
  } catch {
    console.error("Function worker failed", { function: slug });
    return Response.json({ error: "function_unavailable" }, { status: 503 });
  }
});
