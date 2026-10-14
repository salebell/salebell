export type DeploymentMode = "cloud" | "self_hosted";
export type InstanceSettings = { deploymentMode: DeploymentMode; billingEnabled: boolean };

export function deploymentMode(value: string | undefined): DeploymentMode {
  if (!value || value === "cloud") return "cloud";
  if (value === "self_hosted") return "self_hosted";
  throw new Error("NEXT_PUBLIC_DEPLOYMENT_MODE must be cloud or self_hosted.");
}

/** Only the database's instance_settings RPC determines workspace entitlements. */
export function instanceSettings(value: unknown): InstanceSettings {
  if (!value || typeof value !== "object" || !("deployment_mode" in value) || !("billing_enabled" in value)
    || (value.deployment_mode !== "cloud" && value.deployment_mode !== "self_hosted")
    || typeof value.billing_enabled !== "boolean") {
    throw new Error("Couldn't load instance settings. Apply the latest database migrations and reload.");
  }
  return { deploymentMode: value.deployment_mode, billingEnabled: value.deployment_mode === "cloud" && value.billing_enabled };
}

export function hasFullFeatures(plan: string, settings: InstanceSettings) {
  return settings.deploymentMode === "self_hosted" || plan === "pro";
}

export function initialSignInStep(mode: DeploymentMode, pendingCode: boolean): "email" | "code" | "password" {
  return pendingCode ? "code" : mode === "self_hosted" ? "password" : "email";
}

export function cloudBillingPath(interval: "month" | "year") {
  return `/app/billing?interval=${interval}`;
}
