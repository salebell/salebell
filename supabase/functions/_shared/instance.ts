import type { ServiceClient } from "./supabase.ts";

export type InstanceSettings = {
  deployment_mode: "cloud" | "self_hosted";
  billing_enabled: boolean;
};

/** Read the operator-owned mode on each billing request; never trust a client flag. */
export async function loadInstanceSettings(db: Pick<ServiceClient, "rpc">): Promise<InstanceSettings> {
  const settings = await db.rpc<InstanceSettings | null>("instance_settings", {});
  if (!settings || !["cloud", "self_hosted"].includes(settings.deployment_mode) ||
    settings.billing_enabled !== (settings.deployment_mode === "cloud")) {
    throw new Error("invalid_instance_settings");
  }
  return settings;
}
