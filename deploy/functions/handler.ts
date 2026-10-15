type Worker = { fetch: (request: Request) => Promise<Response> };

// This entrypoint serves the self-hosted Compose stack. Cloud billing functions
// remain in the public source but are deployed only by the managed service.
const functions = new Set([
  "apple-webhook", "apple-credentials", "apple-connect", "apple-test", "test-alert",
  "fx-refresh", "google-webhook", "google-connect", "delete-account",
]);

export function createFunctionRouter(createWorker: (slug: string) => Promise<Worker>) {
  return async (request: Request): Promise<Response> => {
    const slug = new URL(request.url).pathname.split("/")[1];
    if (!functions.has(slug)) return Response.json({ error: "function_not_found" }, { status: 404 });
    try {
      const worker = await createWorker(slug);
      return await worker.fetch(request);
    } catch {
      console.error("Function worker failed", { function: slug });
      return Response.json({ error: "function_unavailable" }, { status: 503 });
    }
  };
}
