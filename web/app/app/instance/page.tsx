"use client";

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { useLoadedWorkspace } from "@/components/app/workspace";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { SOURCE_URL } from "@/lib/env";

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
        <p className="text-sm text-muted">Your operator manages hosting, updates, backups and delivery credentials. iPhone alerts require a companion app built for this instance. Google Play support is available in preview.</p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/docs" variant="secondary">Connect an app</ButtonLink>
          <ButtonLink href="/self-host" variant="secondary">Self-hosting guide</ButtonLink>
          <a href={SOURCE_URL} className="self-center text-sm font-medium text-accent-text underline underline-offset-2">Source code ↗</a>
        </div>
      </Card>
    </div>
  );
}
