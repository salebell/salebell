"use client";

import Link from "next/link";
import { ForwardingForm } from "@/components/app/forwarding-form";
import { ServerFlow } from "@/components/app/server-flow";
import { useCurrentApp } from "@/components/app/use-current-app";
import { ButtonLink, Card } from "@/components/ui";

export default function ForwardingPage() {
  const { app } = useCurrentApp();
  if (!app) return null;
  if (app.store === "play_store") return <div className="max-w-3xl space-y-5"><div><h2 className="text-lg font-semibold tracking-tight">Keep another backend connected</h2><p className="mt-1 text-sm text-muted">Google Pub/Sub delivers each topic message independently to every subscription.</p></div><Card className="space-y-4 p-5"><ol className="list-decimal space-y-3 pl-5 text-sm text-muted"><li>Keep the topic already configured in Play Console when another backend uses it.</li><li>Create a separate authenticated, wrapped push subscription for Salebell on that topic. Use advanced manual setup under Setup to save its details.</li><li>Keep your other backend&apos;s subscription on the same topic. Each backend manages its own authentication, acknowledgments and retries.</li></ol><p className="text-sm text-muted">Salebell&apos;s Apple forwarding URLs do not apply to Google Play. Configure additional subscribers in <a href="https://console.cloud.google.com/cloudpubsub" target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-2">Google Cloud Pub/Sub ↗</a>.</p><ButtonLink href={`/app/apps/${app.id}/setup`} variant="secondary">View Google connection</ButtonLink></Card></div>;
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
