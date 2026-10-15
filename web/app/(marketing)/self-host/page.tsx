import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { SOURCE_URL, IS_SELF_HOSTED } from "@/lib/env";
import { installerConfig } from "@/lib/installer-config";

export const metadata: Metadata = {
  title: "Self-host Salebell",
  description: "Run the MIT-licensed Salebell on your infrastructure with Docker Compose. Full features, your domain and credentials. Managed cloud is optional.",
  alternates: { canonical: "/self-host" },
};

export default function SelfHostPage() {
  let browserInstaller: string | null = null;
  try { const config = installerConfig(); if (config?.publicEnabled) browserInstaller = config.origin; } catch { /* keep the supported manual paths available */ }
  return <article className="prose-sp mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
    <p className="!mt-0 text-sm font-medium text-accent-text">Open source · MIT license</p>
    <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Your infrastructure. Full Salebell.</h1>
    <p>Prefer Vercel and hosted Supabase? <a className="text-accent-text underline" href={`${SOURCE_URL}/blob/HEAD/docs/VERCEL_SUPABASE_DEPLOYMENT.md`}>Follow the hosted installation guide</a>. Each installation uses your own provider accounts; custom domains are optional.</p>
    {browserInstaller && <div className="my-6"><ButtonLink href={`${browserInstaller}/deploy`}>Deploy Salebell</ButtonLink><p className="mt-2 text-sm text-muted">Connect your Vercel and Supabase accounts and finish setup in your browser.</p></div>}
    <p className="text-lg">Self-host apps, integrations, event history, revenue estimates, CSV export and raw Apple notification forwarding without a Salebell subscription. You pay for and operate your infrastructure and delivery providers.</p>
    <p>You do not need a Supabase account, Vercel account, email provider or iPhone build to get started. Docker runs the dashboard, database and notification receivers on your server.</p>
    <div className="my-6 flex flex-wrap gap-3"><a href={`${SOURCE_URL}/blob/HEAD/docs/SELF_HOSTING.md`} className="font-medium">Step-by-step installation guide ↗</a><a href={SOURCE_URL} className="font-medium">Browse the source ↗</a></div>

    <h2>1. Prepare your server</h2>
    <ul>
      <li>Install Git, Node.js 22.6 or later, and Docker Engine with Docker Compose v2.</li>
      <li>Point two domain names at your server&apos;s public IP: one for the dashboard and one for the API.</li>
      <li>Open ports 80 and 443 and make sure no other service uses them. HTTPS certificates are set up automatically.</li>
    </ul>
    <p>For example, use <code>salebell.example.com</code> for the dashboard and <code>api.salebell.example.com</code> for the API. Replace both examples below with your hostnames.</p>

    <h2>2. Install on the server</h2>
    <pre><code>{`git clone ${SOURCE_URL} salebell
cd salebell

npm run self-host -- init \\
  --site-url https://salebell.example.com \\
  --api-url https://api.salebell.example.com \\
  --email owner@example.com

npm run self-host -- up`}</code></pre>
    <p>Use your email address for <code>--email</code>. The installer creates your configuration and owner account, builds the dashboard and checks the services. Wait for <strong>Salebell is ready at ...</strong>. No separate npm install or Supabase CLI is required.</p>

    <h2>3. Sign in</h2>
    <p>Read your generated password on the server:</p>
    <pre><code>cat deploy/owner-password</code></pre>
    <p>Open your dashboard&apos;s <code>/login</code> page and sign in with your email and that password. No email code is needed. Public registration is closed by default.</p>
    <p>Keep <code>deploy/.env</code> and <code>deploy/owner-password</code> private. To change settings later, edit the existing <code>deploy/.env</code> and run <code>npm run self-host -- up</code> again.</p>

    <h2>4. Connect your first app</h2>
    <ol>
      <li>Open your instance and sign in with the owner credentials.</li>
      <li>Import an app with an App Store Connect team key, or enter its name and bundle ID manually.</li>
      <li>Connect Version 2 Apple notifications. Preserve your existing backend&apos;s URLs through forwarding before replacing them.</li>
      <li>Make a sandbox purchase and confirm the event appears. If you use the optional Apple test, confirm its notification arrives.</li>
      <li>Choose an alert channel and send a test alert, or skip alerts and use the dashboard alone.</li>
    </ol>
    <p><Link href="/docs">Read the app connection guide</Link>. Your instance generates URLs using its configured website origin.</p>

    <h2>5. Save a backup</h2>
    <pre><code>npm run self-host -- backup</code></pre>
    <p>Copy the entire backup directory printed by the command to private storage outside this server. It contains your database, credentials and encryption material. <a href={`${SOURCE_URL}/blob/HEAD/docs/SELF_HOSTING_OPERATIONS.md`}>Updates, backups and recovery ↗</a>.</p>

    <h2 id="iphone">Optional: iPhone alerts</h2>
    <p>The hosted Salebell iPhone app connects to the hosted service. For a self-hosted instance, build the iOS app with your Supabase URL, public key and site URL. Configure your own Apple bundle ID, signing team, App Group and APNs key, then register your device by signing in to that build.</p>
    <p><a href={`${SOURCE_URL}/blob/HEAD/ios/README.md`}>iOS build and APNs instructions ↗</a>. Slack, Discord, Telegram, Pushover, PostHog and webhook integrations can be used without building an iPhone app.</p>
    <p>Apple in-app purchases and subscriptions are supported. Google Play RTDN is available in preview. <a href={`${SOURCE_URL}/blob/HEAD/docs/GOOGLE_PLAY_RTDN.md`}>Google Play setup and limitations ↗</a>.</p>

    {!IS_SELF_HOSTED && <>
    <h2>Prefer managed cloud?</h2>
    <p>Cloud Free covers one app. Cloud Pro adds more apps and integrations, full history and CSV export. Self-hosting remains available under MIT.</p>
    <div className="mt-5 flex flex-wrap gap-3"><ButtonLink href="/pricing" variant="secondary">Compare options</ButtonLink><ButtonLink href="/login">Try cloud free</ButtonLink></div>
    </>}
  </article>;
}
