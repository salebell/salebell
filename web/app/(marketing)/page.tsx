import Link from "next/link";
import { Suspense } from "react";
import { AscFieldMock } from "@/components/marketing/asc-field-mock";
import { DeletedNotice } from "@/components/marketing/deleted-notice";
import { Faq } from "@/components/marketing/faq";
import { PhoneMock } from "@/components/marketing/phone-mock";
import { IphoneAppNote } from "@/components/iphone-app";
import { ButtonLink, SectionHeading } from "@/components/ui";
import { FOUNDER, PRICES } from "@/lib/plans";
import { CLOUD_URL, IS_SELF_HOSTED, SOURCE_URL } from "@/lib/env";

const features = [
  {
    title: "Open source. Your choice of hosting.",
    body: "Run Salebell on your infrastructure under the MIT license, or use optional managed cloud. Keep StoreKit 2: no SDK or app update is needed.",
    icon: "M4 7h16M4 12h10M4 17h7",
  },
  {
    title: "Seconds, not tomorrow",
    body: "Sales and Trends lags by a day. Apple sends a server notification as each purchase happens, and you hear about it seconds after Apple sends it.",
    icon: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  },
  {
    title: "Keeps your existing server",
    body: "App Store Connect allows one URL per environment. Already using it? Add it as a forwarding URL and we pass every notification on with the body unchanged.",
    icon: "M5 12h14m-5-5 5 5-5 5",
  },
  {
    title: "Verified against Apple's signature",
    body: "Each notification is a JWS signed by Apple. We check the certificate chain up to Apple's root and match your bundle ID before anything is stored or sent.",
    icon: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  },
  {
    title: "The bad news, too",
    body: "Refunds, billing issues, cancellations and expirations arrive next to purchases and renewals, so you hear about churn while you can still do something.",
    icon: "M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  },
  {
    title: "Where you already look",
    body: "The Salebell iPhone app, Slack, Discord, Telegram, Pushover, PostHog or your own webhook. Each one has a Send test alert button.",
    icon: "M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9",
  },
];

const faqs = [
  {
    q: "Can I self-host the full product?",
    a: <p>Yes. Salebell is MIT licensed. Self-hosted instances include apps, integrations, full history, forwarding and CSV export without a Salebell subscription. You manage the infrastructure and delivery credentials. <Link href="/self-host" className="text-accent-text underline underline-offset-2">Read the self-hosting guide</Link>.</p>,
  },
  {
    q: "What do you store?",
    a: (
      <>
        <p>
          For each notification: the decoded, signature-verified payload Apple sends, which includes the product ID, price and currency,
          storefront country, transaction IDs, and the <code className="font-mono text-[0.85em]">appAccountToken</code> if your app sets
          one. We don&apos;t store the raw signed token.
        </p>
        <p>
          Apple doesn&apos;t include your customers&apos; names, emails or Apple Account details in these notifications, so we never have
          them. We also store your account email and the integration settings you enter. Details are in the{" "}
          <Link href="/privacy" className="text-accent-text underline underline-offset-2">privacy policy</Link>.
        </p>
      </>
    ),
  },
  {
    q: "Does it track paid-app downloads?",
    a: (
      <p>
        No. App Store Server Notifications cover in-app purchases and subscriptions: purchases, free trials, renewals, refunds, billing
        issues and cancellations. Apple doesn&apos;t send a notification when someone pays to download a paid app, so Salebell can&apos;t
        see those sales. For upfront paid downloads, Sales and Trends in App Store Connect is still the place to look.
      </p>
    ),
  },
  {
    q: "How do you know a notification really came from Apple?",
    a: (
      <p>
        Every App Store Server Notification (version 2) is a JWS signed with a certificate chain that ends at Apple&apos;s root
        certificate. We verify that chain and the signature, then check that the bundle ID and environment match the app you registered.
        Anything that fails is rejected and never reaches your phone, your channels or your forwarding URL. Your webhook URL also contains
        a random key, but we don&apos;t rely on it alone.
      </p>
    ),
  },
  {
    q: "I already have a server URL in App Store Connect. Can I still use Salebell?",
    a: (
      <>
        <p>
          Yes. Put the Salebell URLs in App Store Connect and add your current URLs as forwarding URLs in Salebell. We forward every
          verified notification to them with the body unchanged, so your server keeps verifying Apple&apos;s signature as it does today.
        </p>
        <p>
          Each forward is one attempt with a 10-second timeout, and failures are logged. If your server needs to catch up after its own
          downtime, Apple&apos;s Get Notification History API returns everything Apple sent. Forwarding is included on every plan.
        </p>
      </>
    ),
  },
  {
    q: "Does it work with sandbox and TestFlight purchases?",
    a: (
      <p>
        Yes. Paste the sandbox URL into the Sandbox Server URL field and purchases made with a Sandbox Apple Account or in TestFlight
        appear in Salebell with a Sandbox label. They&apos;re kept out of your revenue numbers by default, and iPhone alerts for sandbox
        purchases are off unless you turn them on.
      </p>
    ),
  },
  {
    q: "How accurate are the revenue numbers?",
    a: (
      <p>
        We show the price the customer paid, as Apple reports it in the transaction, before Apple&apos;s commission and taxes. Totals in
        other currencies are converted to an estimated USD figure with daily exchange rates. Treat them as a real-time pulse. For payouts
        and accounting, App Store Connect remains the source of truth.
      </p>
    ),
  },
  {
    q: "What happens if Salebell is down?",
    a: (
      <p>
        If we can&apos;t accept a production notification, Apple retries it five times: 1, 12, 24, 48 and 72 hours after the previous
        attempt. Sandbox notifications are sent only once. Notifications are idempotent on our side, so a retry never double-counts a
        purchase or sends a duplicate alert.
      </p>
    ),
  },
  {
    q: "Can I cancel Cloud Pro any time?",
    a: (
      <p>
        Yes. Pro is billed through Stripe and you can cancel from the billing page. If you go back to Free, nothing is deleted: extra
        apps and integrations pause and older history is hidden until you upgrade again.
      </p>
    ),
  },
];

const destinations: [string, string, string?][] = [
  ["📱", "iPhone push", "cha-ching sound"],
  ["💬", "Slack and Discord"],
  ["✈️", "Telegram and Pushover"],
  ["🪝", "Your webhook or PostHog"],
  ["↪️", "Your own server", "forwarded unchanged"],
];

function FlowArrow({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-2 text-center lg:py-0" aria-hidden="true">
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted">{label}</span>
      <svg viewBox="0 0 80 24" className="my-7 h-6 w-20 rotate-90 text-accent lg:my-0 lg:rotate-0">
        <path d="M2 12h70" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round">
          <animate attributeName="stroke-dashoffset" from="18" to="0" dur="0.9s" repeatCount="indefinite" />
        </path>
        <path d="m66 5 8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <Suspense>
        <DeletedNotice />
      </Suspense>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:pb-20">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-accent" />
              </span>
              Open source · Apple App Store available today
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-[1.04] tracking-[-0.035em] text-balance sm:text-6xl">
              Hear about your next in-app purchase.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted text-pretty sm:text-xl">
              Salebell turns Apple&apos;s App Store Server Notifications into purchase alerts and a live revenue dashboard. Purchases,
              renewals, trials and refunds, with no SDK. Self-host the full product or use our optional managed cloud.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/login" size="lg">
                {IS_SELF_HOSTED ? "Open dashboard" : "Start free on cloud"}
              </ButtonLink>
              <ButtonLink href="/self-host" size="lg" variant="secondary">
                Self-host Salebell
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-muted">MIT licensed. Self-host without plan limits. Cloud Free covers one app.</p>
            <p className="mt-2 text-sm text-muted">Android / Google Play RTDN: <span className="font-medium">Coming soon</span>.</p>
            <p className="mt-2 text-sm text-muted">
              <IphoneAppNote />
            </p>
          </div>
          <PhoneMock />
        </div>
      </section>

      {/* Forwarding and the no-SDK promise */}
      <section className="border-t border-border bg-accent-soft/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <svg viewBox="0 0 24 24" className="mt-0.5 size-6 shrink-0 text-accent-text" aria-hidden="true">
              <path d="M4 12h12m-4-5 5 5-5 5M20 5v14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="font-semibold">Keep your server. Salebell forwards every notification unchanged.</p>
              <p className="mt-0.5 text-sm text-muted">
                Already using the App Store Connect URL? Add it as a forwarding URL and your backend keeps getting Apple&apos;s signed
                payloads, byte for byte.
              </p>
            </div>
          </div>
          <p className="shrink-0 font-mono text-sm font-medium text-accent-text md:text-right">
            No SDK. No RevenueCat migration. Two URLs.
          </p>
        </div>
      </section>

      {/* The flow: App Store Connect field → Salebell → where alerts go */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,0.8fr)]">
            <div className="mx-auto w-full max-w-md lg:max-w-none">
              <p className="mb-3 text-sm font-medium">
                <span className="mr-2 font-mono text-accent-text">01</span>Paste your URLs in App Store Connect
              </p>
              <AscFieldMock />
            </div>
            <FlowArrow label="Apple signs" />
            <div className="mx-auto flex flex-col items-center gap-2 rounded-xl border border-border bg-surface px-5 py-4 text-center">
              <span className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-accent-text">02</span>
              <p className="text-sm font-medium">Salebell verifies</p>
              <ul className="space-y-0.5 text-xs text-muted">
                <li>Signature chain ✓</li>
                <li>Bundle ID ✓</li>
                <li>Forward to your server ✓</li>
              </ul>
            </div>
            <FlowArrow label="seconds later" />
            <div className="mx-auto w-full max-w-md lg:max-w-none">
              <p className="mb-3 text-sm font-medium">
                <span className="mr-2 font-mono text-accent-text">03</span>You hear about it
              </p>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface text-sm">
                {destinations.map(([emoji, label, note]) => (
                  <li key={label} className="flex items-center gap-3 px-4 py-2.5">
                    <span aria-hidden="true">{emoji}</span>
                    <span className="font-medium">{label}</span>
                    {note && <span className="ml-auto text-xs text-muted">{note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-t border-border bg-surface/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHeading eyebrow="Why Salebell" title="Your in-app revenue, as it happens. Nothing in your binary.">
            Inspect the verification and delivery code, run your own instance, or leave the infrastructure to managed cloud.
          </SectionHeading>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="bg-surface p-6 sm:p-7">
                <svg viewBox="0 0 24 24" className="size-6 text-accent-text" aria-hidden="true">
                  <path d={f.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Setup in three steps */}
      <section className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-2">
          <SectionHeading eyebrow="Setup" title="Connect Apple, then choose your alerts.">
            Import apps with an App Store Connect team key, or enter app details manually. An In-App Purchase key is only needed for an optional Apple test.
          </SectionHeading>
          <ol className="space-y-6">
            {[
              ["Choose your app", "Import from App Store Connect with a team key, or use manual setup with the app name and bundle ID."],
              ["Connect notifications", "Let Salebell configure Version 2 URLs and preserve supported existing servers, or paste the URLs manually."],
              ["Choose alerts", "Connect Slack, Discord, Telegram or another destination. Incoming events are recorded even without an alert channel."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border-strong bg-surface font-mono text-sm font-medium">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
            <li className="pl-[3.25rem]">
              <Link href="/docs" className="text-sm font-medium text-accent-text underline underline-offset-4">
                See the full setup guide
              </Link>
            </li>
          </ol>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-t border-border bg-surface/50">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Free to self-host. Optional cloud from $0.</h2>
            <p className="mt-2 text-muted">
              Self-host includes the full product. Cloud Pro is ${PRICES.month}/month or ${PRICES.year}/year for more apps, integrations and full history. Founding cloud members get{" "}
              {FOUNDER.percent}% off forever with code {FOUNDER.code}.
            </p>
          </div>
          <div className="flex gap-3">
            <ButtonLink href="/pricing" variant="secondary">
              Compare plans
            </ButtonLink>
            <ButtonLink href={IS_SELF_HOSTED ? `${CLOUD_URL}/login` : "/login"}>Try cloud free</ButtonLink>
          </div>
        </div>
      </section>

      <section className="border-t border-border"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-4 py-10 sm:px-6"><div><h2 className="text-xl font-semibold">Own your instance and your data</h2><p className="mt-2 text-sm text-muted">Deploy Salebell with Docker Compose. Use your domain, your database and your delivery credentials.</p></div><div className="flex gap-3"><ButtonLink href="/self-host" variant="secondary">Installation guide</ButtonLink><a href={SOURCE_URL} className="self-center text-sm font-medium text-accent-text underline underline-offset-2">View source ↗</a></div></div></section>

      {/* FAQ */}
      <section className="border-t border-border" id="faq">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionHeading eyebrow="FAQ" title="Straight answers" />
          <div className="mt-10">
            <Faq items={faqs} />
          </div>
        </div>
      </section>
    </>
  );
}
