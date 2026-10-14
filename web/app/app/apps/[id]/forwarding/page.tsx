"use client";

import Link from "next/link";
import { ForwardingForm } from "@/components/app/forwarding-form";
import { ServerFlow } from "@/components/app/server-flow";
import { useCurrentApp } from "@/components/app/use-current-app";
import { Card } from "@/components/ui";

export default function ForwardingPage() {
  const { app } = useCurrentApp();
  if (!app) return null;
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Keep your existing server connected</h2>
        <p className="mt-1 text-[0.9375rem] text-muted">
          Add the URLs your server already uses. Salebell will pass Apple notifications to it unchanged. Included on every plan.
        </p>
      </div>
      <ServerFlow app={app} />
      <Card className="p-5 sm:p-6">
        <ForwardingForm app={app} />
      </Card>
      <details className="rounded-xl border border-border bg-surface-2 p-4">
      <summary className="cursor-pointer text-sm text-muted">How notifications reach your server</summary>
      <ul className="mt-3 space-y-2 text-sm text-muted">
        <li>• The body is forwarded unchanged, so your server can keep verifying Apple&apos;s signature.</li>
        <li>
          • Forwarded requests carry <code className="font-mono text-xs">x-salebell-forwarded: 1</code>. Redirects aren&apos;t followed, so use
          your server&apos;s final URL.
        </li>
        <li>• Production notifications go to the production URL, sandbox notifications to the sandbox URL.</li>
        <li>
          • Forwarding runs in the background after Salebell answers Apple: one attempt, 10-second timeout, failures logged. Use
          Apple&apos;s Get Notification History endpoint to backfill anything your server missed.
        </li>
        <li>• Only notifications that pass Apple signature and bundle ID checks are forwarded.</li>
        <li>
          • Forwarding is on every plan. <Link href="/docs#forwarding" className="text-accent-text underline underline-offset-2">Read more</Link>
        </li>
      </ul>
      </details>
    </div>
  );
}
