import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Faq } from "@/components/marketing/faq";
import { PricingTable } from "@/components/marketing/pricing-table";
import { FOUNDER, FOUNDER_SENTENCE, PRICES, YEARLY_SAVING } from "@/lib/plans";
import { IS_SELF_HOSTED, SOURCE_URL } from "@/lib/env";
import { ButtonLink } from "@/components/ui";
import { IphoneAppNote } from "@/components/iphone-app";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Self-host Salebell for free under MIT, or use optional managed Cloud Free and Cloud Pro. Cloud Pro is $9/month or $79/year.",
  alternates: { canonical: "/pricing" },
};

const faqs = [
  {
    q: "Do I need a subscription to self-host?",
    a: <p>No. The MIT-licensed software includes apps, integrations, full history and CSV export. You operate and pay for your infrastructure, email and delivery providers. Cloud plans apply only to the managed service.</p>,
  },
  {
    q: "What counts as an integration?",
    a: <p>Each Slack, Discord, Telegram, webhook, PostHog or Pushover destination you add. iPhone push alerts from the Salebell app are separate and included on both plans.</p>,
  },
  {
    q: "What does the FOUNDER code do?",
    a: <p>Enter {FOUNDER.code} at Stripe Checkout to take {FOUNDER.percent}% off Pro for as long as you stay subscribed: ${FOUNDER.month}/month, or about ${FOUNDER.year}/year on yearly billing. It works for the first {FOUNDER.seats} customers.</p>,
  },
  {
    q: "Does Salebell see paid-app downloads?",
    a: <p>No. Apple&apos;s server notifications cover in-app purchases and subscriptions, not upfront paid downloads, so Salebell alerts on purchases, trials, renewals, refunds and billing issues inside your app.</p>,
  },
  {
    q: "What happens if I downgrade?",
    a: <p>Nothing is deleted. Your oldest app and oldest integration keep working, extras pause, and history older than 30 days is hidden. Upgrade again and everything comes back.</p>,
  },
  {
    q: "Is forwarding really on the free plan?",
    a: <p>Yes. If you can&apos;t keep your existing server, you can&apos;t adopt Salebell, so forwarding is on every plan.</p>,
  },
  {
    q: "How do I pay?",
    a: <p>By card through Stripe Checkout. Invoices, card changes and cancellation are in the Stripe customer portal, linked from your billing page.</p>,
  },
];

export default function PricingPage() {
  if (IS_SELF_HOSTED) redirect("/self-host");
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Self-host free. Cloud when you want it.</h1>
        <p className="mt-4 text-lg text-muted text-pretty">
          Run the full product on your infrastructure, or let us host it. Cloud starts free with one app; Cloud Pro is <span className="font-medium text-fg">${PRICES.month}/month or ${PRICES.year}/year (save {YEARLY_SAVING}%)</span>.
        </p>
      </div>
      <section className="mb-10 rounded-2xl border border-border bg-surface p-6 sm:p-7" aria-labelledby="self-hosted-plan">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 id="self-hosted-plan" className="text-xl font-semibold">Self-hosted</h2><p className="mt-2 text-3xl font-semibold">$0 <span className="text-sm font-normal text-muted">software license</span></p></div><ButtonLink href="/self-host" variant="secondary">Self-host Salebell</ButtonLink></div>
        <p className="mt-4 text-sm text-muted">All apps and integrations, full history, CSV export and forwarding. You manage hosting, updates, backups and delivery credentials. Your infrastructure and provider costs are separate.</p>
        <p className="mt-3 text-sm"><a href={SOURCE_URL} className="text-accent-text underline underline-offset-2">Read the source · MIT license ↗</a></p>
      </section>
      <h2 className="mb-6 text-center text-2xl font-semibold">Optional managed cloud</h2>
      <p className="mx-auto mb-8 max-w-3xl rounded-xl border border-dashed border-accent/50 bg-accent-soft/50 px-4 py-3 text-center text-sm text-pretty">
        {FOUNDER_SENTENCE}
      </p>
      <PricingTable />
      <p className="mt-6 text-center text-sm text-muted">Prices in USD. Taxes may apply depending on where you are.</p>
      <p className="mt-3 text-center text-sm text-muted">Apple App Store is available today. Android / Google Play RTDN: Preview.</p>
      <p className="mt-3 text-center text-sm text-muted"><IphoneAppNote /></p>
      <div className="mt-16">
        <h2 className="mb-6 text-xl font-semibold tracking-tight">Billing questions</h2>
        <Faq items={faqs} />
      </div>
    </div>
  );
}
