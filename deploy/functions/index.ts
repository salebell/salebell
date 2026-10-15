// Standalone Supabase Edge Runtime entrypoint. Auth remains in each existing handler:
// user handlers resolve the session through Auth; webhooks verify provider signatures.
// Supabase config.toml is for the CLI and is deliberately not used in production.
import { createFunctionRouter } from "./handler.ts";

Deno.serve(createFunctionRouter(async (slug) =>
  EdgeRuntime.userWorkers.create({
    servicePath: `/home/deno/functions/${slug}`,
    memoryLimitMb: 150,
    workerTimeoutMs: 400_000,
    noModuleCache: false,
    envVars: Object.entries({ ...Deno.env.toObject(), SUPABASE_FUNCTION_SLUG: slug }),
  })
));
