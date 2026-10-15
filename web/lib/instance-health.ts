import { apiRequest } from "./installer-providers.ts";
export async function instanceHealth(values: { origin: string; supabaseUrl: string; publicKey: string; release: string }, fetcher: typeof fetch = fetch) {
  try {
    const settings = await apiRequest<{ deployment_mode: string; billing_enabled: boolean }>(`${values.supabaseUrl}/rest/v1/rpc/instance_settings`, { method: "POST", headers: { apikey: values.publicKey, "content-type": "application/json" }, body: "{}" }, fetcher);
    if (settings.deployment_mode !== "self_hosted" || settings.billing_enabled !== false) throw new Error("not_ready");
    return Response.json({ release: values.release, mode: "self_hosted", origin: values.origin }, { headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ ready: false }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
