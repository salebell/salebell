import { deploymentMode } from "./deployment.ts";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
// next.config.ts validates these before dev/build, so URLs never fall back to a live project.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/$/, "");
export const DEPLOYMENT_MODE = deploymentMode(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE);
export const IS_SELF_HOSTED = DEPLOYMENT_MODE === "self_hosted";
export const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL || "https://github.com/salebell/salebell";
export const CLOUD_URL = (process.env.NEXT_PUBLIC_CLOUD_URL || "https://salebell.vercel.app").replace(/\/$/, "");
export const ANALYTICS_ENABLED = !IS_SELF_HOSTED && process.env.NEXT_PUBLIC_ENABLE_ANALYTICS !== "false";
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || null;
// Both modes use the same published companion. Configure a compatible release's
// App Store/TestFlight link; do not imply that unshipped runtime settings are live.
export const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || null;
export const COMPANY_NUMBER = process.env.NEXT_PUBLIC_COMPANY_NUMBER || null;
export const COMPANY_ADDRESS = process.env.NEXT_PUBLIC_COMPANY_ADDRESS || null;
export const COMPANY_NAME = process.env.NEXT_PUBLIC_COMPANY_NAME || (IS_SELF_HOSTED ? "Instance operator" : "Salebell");

export function webhookUrl(webhookKey: string, env: "production" | "sandbox") {
  return `${SITE_URL}/hooks/apple/${webhookKey}/${env}`;
}
