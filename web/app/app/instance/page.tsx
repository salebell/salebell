"use client";

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { useLoadedWorkspace } from "@/components/app/workspace";
import { CopyField } from "@/components/copy-button";
import { IphoneAppNote } from "@/components/iphone-app";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { SITE_URL, SOURCE_URL, SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

export default function InstancePage() {
  const { ws, isSelfHosted } = useLoadedWorkspace();
  if (!isSelfHosted) redirect("/app/billing");

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Your instance" description={ws.account.name} />
      <Card className="space-y-3 p-5 sm:p-6">
        <Badge tone="accent">Self-hosted</Badge>
        <h2 className="text-xl font-semibold">All features included</h2>
        <p className="text-sm text-muted">Apps, integrations, full event history, forwarding and CSV export are available without a Salebell subscription. There are no commercial plan limits.</p>
        <p className="text-sm text-muted">Your operator manages hosting, updates, backups and delivery credentials. A compatible shared iPhone app connects through Settings → Server using this instance&apos;s website URL, API URL and public key, then your instance login. No customer APNs keys or app publication are needed. Distribution and the managed push relay require operator rollout. Google Play support is available in preview.</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/docs" variant="secondary">Connect an app</ButtonLink>
          <ButtonLink href="/self-host" variant="secondary">Self-hosting guide</ButtonLink>
          <a href={SOURCE_URL} className="self-center text-sm font-medium text-accent-text underline underline-offset-2">Source code ↗</a>
        </div>
      </Card>
      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Connect the iPhone app</h2>
        <p className="text-sm text-muted">In a compatible shared Salebell app, open Settings → Server and enter these three public values, then sign in with your account on this instance.</p>
        <CopyField id="iphone-site-url" label="Website URL" value={SITE_URL} />
        <CopyField id="iphone-api-url" label="Supabase API URL" value={SUPABASE_URL} />
        <CopyField id="iphone-public-key" label="Public / publishable key" value={SUPABASE_KEY} />
        <p className="text-sm text-muted">The shared build and managed relay must be available and enabled by their operator before iPhone push works. These fields contain public connection settings; your sign-in grants access to your workspace.</p>
        <div className="text-sm"><IphoneAppNote /></div>
      </Card>
    </div>
  );
}
