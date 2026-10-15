import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { installerConfig, deploymentOrigin } from "@/lib/installer-config";
import { Logo } from "@/components/logo";
import { DeployForm } from "./deploy-form";

export const metadata: Metadata = { title: "Deploy your own Salebell", robots: { index: false, follow: false } };
export default async function DeployPage({ searchParams }: { searchParams: Promise<{ issue?: string; site?: string }> }) {
  await connection();
  const { issue, site } = await searchParams;
  let initialSite: string | null = null;
  try { if (site) initialSite = deploymentOrigin(site); } catch { /* the form accepts a valid production address */ }
  let config;
  try { config = installerConfig(); } catch { config = null; }
  return <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:py-20">
    <Logo />
    <h1 className="mt-8 text-3xl font-semibold tracking-tight">Deploy your own Salebell</h1>
    <p className="mt-3 leading-relaxed text-muted">Run the dashboard on Vercel and the backend on Supabase, in your own accounts. All Salebell features are included. Your providers handle infrastructure charges.</p>
    {config ? <>
      {!config.publicEnabled && <p className="mt-5 rounded-lg border border-border bg-surface p-3 text-sm text-muted">Preview installer. Public availability depends on completing provider integration checks.</p>}
      <DeployForm initialIssue={issue ?? null} initialSite={initialSite} />
    </> : <div className="mt-8 rounded-xl border border-border bg-surface p-6">
      <h2 className="font-semibold">Browser deployment is being prepared</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">The provider connections aren&apos;t enabled on this host yet. You can use the server installer or follow the Vercel and Supabase setup guide.</p>
      <p className="mt-4 text-sm"><Link href="/self-host" className="text-accent-text underline">Server installation</Link><span className="px-2 text-muted">·</span><a href="https://github.com/salebell/salebell/blob/main/docs/VERCEL_SUPABASE_DEPLOYMENT.md" className="text-accent-text underline">Vercel and Supabase guide</a></p>
    </div>}
  </main>;
}
