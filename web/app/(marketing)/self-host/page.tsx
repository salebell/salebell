import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { SOURCE_URL, CLOUD_URL, IS_SELF_HOSTED } from "@/lib/env";

export const metadata: Metadata = {
  title: "Self-host Salebell",
  description: "Run the MIT-licensed Salebell on your infrastructure with Docker Compose. Full features, your domain and credentials. Managed cloud is optional.",
  alternates: { canonical: "/self-host" },
};

export default function SelfHostPage() {
  return <article className="prose-sp mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
    <p className="!mt-0 text-sm font-medium text-accent-text">Open source · MIT license</p>
    <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Your infrastructure. Full Salebell.</h1>
    <p className="text-lg">Self-host apps, integrations, event history, revenue estimates, CSV export and raw Apple notification forwarding without a Salebell subscription. You pay for and operate your infrastructure and delivery providers.</p>
    <p>Apple App Store Server Notifications V2 work today. Android / Google Play RTDN support is <strong>Coming soon</strong>; no Google credentials or receiver are required today.</p>
    <div className="my-6 flex flex-wrap gap-3"><a href={SOURCE_URL} className="font-medium">Browse the repository ↗</a><a href={`${SOURCE_URL}/blob/HEAD/docs/SELF_HOSTING.md`} className="font-medium">Full installation and operations guide ↗</a></div>

    <h2>Install with Docker Compose</h2>
    <p>Use a server with Docker and the Docker Compose plugin, Node.js 22.6 or later for the setup command, and two domain names for the website and Supabase API. Follow the repository guide to configure DNS and public HTTPS before connecting Apple.</p>
    <pre><code>{`git clone ${SOURCE_URL} salebell
cd salebell
npm run self-host -- init --site-url https://sales.example.com --api-url https://api.example.com --email owner@example.com
npm run self-host -- up`}</code></pre>
    <p>The installer writes your deployment configuration and an owner password to <code>deploy/owner-password</code>. Public registration is closed. Sign in with the owner email and generated password; SMTP is optional for this flow.</p>
    <p>Keep the generated secrets private. Set up backups, install updates, and use the operations guide when stopping, upgrading or restoring your instance.</p>

    <h2>Connect your first app</h2>
    <ol>
      <li>Open your instance and sign in with the owner credentials.</li>
      <li>Import an app with an App Store Connect team key, or enter its name and bundle ID manually.</li>
      <li>Connect Version 2 Apple notifications. Preserve your existing backend&apos;s URLs through forwarding before replacing them.</li>
      <li>Confirm receipt with a real sandbox purchase or an optional Apple test, then choose your alert channels.</li>
    </ol>
    <p><Link href="/docs">Read the app connection guide</Link>. Your instance generates URLs using its configured website origin.</p>

    <h2 id="iphone">iPhone alerts on your instance</h2>
    <p>The hosted Salebell iPhone app connects to the hosted service. For a self-hosted instance, build the iOS app with your Supabase URL, public key and site URL. Configure your own Apple bundle ID, signing team, App Group and APNs key, then register your device by signing in to that build.</p>
    <p><a href={`${SOURCE_URL}/blob/HEAD/ios/README.md`}>iOS build and APNs instructions ↗</a>. Slack, Discord, Telegram, Pushover, PostHog and webhook integrations can be used without building an iPhone app.</p>

    <h2>Prefer managed cloud?</h2>
    <p>Cloud Free covers one app. Cloud Pro adds more apps and integrations, full history and CSV export. Self-hosting remains available under MIT.</p>
    <div className="mt-5 flex flex-wrap gap-3"><ButtonLink href="/pricing" variant="secondary">Compare options</ButtonLink><ButtonLink href={IS_SELF_HOSTED ? `${CLOUD_URL}/login` : "/login"}>Try cloud free</ButtonLink></div>
  </article>;
}
