import type { NextConfig } from "next";
import { deploymentMode } from "./lib/deployment.ts";

const mode = deploymentMode(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE);

const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SITE_URL"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  throw new Error(
    `Missing web configuration: ${missing.join(", ")}. Run npm run dev -- --setup-only from the repository root, ` +
      "or copy web/.env.local.example to web/.env.local and fill in the values before starting the web app.",
  );
}

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SITE_URL", ...(process.env.SUPABASE_INTERNAL_URL ? ["SUPABASE_INTERNAL_URL"] : [])]) {
  try {
    const url = new URL(process.env[key]!);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${key} must be a complete http:// or https:// URL.`);
  }
}
const supabaseUrl = (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!.replace(/\/$/, "");

// The legal pages and footer render without these, but a launch build should have them.
const LEGAL_ENV = ["NEXT_PUBLIC_SUPPORT_EMAIL", "NEXT_PUBLIC_COMPANY_NUMBER", "NEXT_PUBLIC_COMPANY_ADDRESS"];
const missingLegal = LEGAL_ENV.filter((k) => !process.env[k]);
if (mode === "cloud" && process.env.NODE_ENV === "production" && missingLegal.length) {
  console.warn(
    `\n⚠️  Salebell legal details missing: ${missingLegal.join(", ")}.\n` +
      "   Configure the cloud operator's contact and registration details in your deployment environment.\n",
  );
}

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // App Store Connect posts here; Next proxies the request to the instance's edge function.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/hooks/apple/:key/:env",
          destination: `${supabaseUrl}/functions/v1/apple-webhook/:key/:env`,
        },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/((?!hooks/).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // No script-src: Next's inline bootstrap scripts would need per-request nonces, which makes every page dynamic.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
