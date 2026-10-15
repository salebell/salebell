import type { Metadata } from "next";
import { LegalPage, SupportContact } from "@/components/marketing/legal";
import { companyLine } from "@/components/marketing/site-footer";
import { ANALYTICS_ENABLED, IS_SELF_HOSTED, SOURCE_URL } from "@/lib/env";

export const metadata: Metadata = { title: "Privacy policy", alternates: { canonical: "/privacy" } };

const bases = [
  ["Running your account and the service: sign-in, apps, the dashboard, alerts, forwarding and the iPhone app", "Contract"],
  ["Billing Pro subscriptions", "Contract, and legal obligation for tax and accounting records"],
  ["Security: request logs, abuse prevention, debugging", "Legitimate interests (keeping Salebell and your data safe)"],
  ["Service emails such as sign-in codes and important account notices", "Contract"],
];

const processors = [
  ["Supabase", "Database, authentication, sign-in emails, encrypted store credentials in Vault and notification receiver functions", "United Kingdom (London, eu-west-2)"],
  ["Vercel", "Hosting this website and routing requests to Supabase", "United States and global edge network"],
  ["Stripe", "Payments, invoices and subscription management", "United States"],
  ["Apple", "Delivering iPhone push notifications (APNs), and requested app discovery, notification URL setup and test notification API calls", "United States"],
  ["Google", "Google Play purchase lookup and the Google Cloud Pub/Sub setup and notification delivery you configure", "Your Google Cloud project settings and Google's infrastructure"],
];

export default function PrivacyPage() {
  if (IS_SELF_HOSTED) return <LegalPage title="Self-hosted instance privacy" updated="14 October 2026">
    <p>This is an independently operated Salebell instance, provided by {companyLine()}. Its operator controls the infrastructure, account access, backups and retention. Using this instance does not create a Salebell Cloud account.</p>
    <SupportContact prefix="Contact this instance's operator about privacy at" />
    <h2>Data held by this instance</h2>
    <p>Salebell stores account email addresses, workspace and app settings, verified Apple and Google event data, alert destinations and delivery records. Saved Apple signing keys and Google service-account keys are encrypted in the instance&apos;s Supabase Vault. The operator controls the database and its backups.</p>
    <p>Apple events may include transaction IDs, prices, currencies and an appAccountToken supplied by your app. Device push tokens are stored when an iPhone app built for this instance registers for alerts. Integration credentials and forwarding URLs are used to send the notifications you configure.</p>
    <h2>External services</h2>
    <p>Connecting Apple sends the API requests you initiate to Apple. Configured alert channels and forwarding servers receive the event data needed for delivery. iPhone push uses Apple APNs when the operator configures it. Email delivery is optional and uses the operator&apos;s chosen provider.</p>
    <p>Connecting Google uses your service-account key for the Google Cloud setup you request and Google Play purchase lookups. Raw purchase tokens are used for lookup and retained as hashes in event history. Disconnecting deletes the saved key from Salebell; Google Cloud resources remain in your project.</p>
    <p>Self-hosted builds do not load Vercel Web Analytics. Salebell uses authentication cookies to keep you signed in. The operator&apos;s infrastructure may keep request logs; ask them about the providers, storage locations and retention they have configured.</p>
    <h2>Access and deletion</h2>
    <p>All event history and CSV export are available without a cloud subscription. Account settings let you delete your sign-in and workspaces you solely own. Ask the operator about backups, any additional policies, or help exercising your data rights.</p>
    <h2>Inspect the software</h2>
    <p>The MIT-licensed <a href={SOURCE_URL}>source code</a> documents the service. The operator is responsible for their deployment and its privacy practices.</p>
  </LegalPage>;

  return (
    <LegalPage title="Privacy policy" updated="14 October 2026">
      <p>
        This policy explains what Salebell collects when you use the website, the dashboard and the iPhone app, why, and the rights you
        have. We collect only what we need to run the service. We don&apos;t sell data or use it for advertising.
      </p>

      <h2>Who we are</h2>
      <p>
        Salebell is operated by {companyLine()}, the controller of the personal data described here (&quot;we&quot;). For the purchase
        data your apps send us, we process it on your instructions.
      </p>
      <SupportContact prefix="Contact us about privacy at" />

      <h2>What we collect</h2>
      <h3>Your account</h3>
      <ul>
        <li>Your email address, used to sign you in with a one-time code and to contact you about your account.</li>
        <li>Your workspace name, the apps you add (name, store, bundle ID or Android package name, optional Apple ID) and your forwarding URLs.</li>
        <li>
          Integration settings you enter, such as Slack or Discord webhook URLs, Telegram bot tokens, Pushover keys, PostHog API keys
          and webhook signing secrets. Only owners and admins of your workspace can read them.
        </li>
        <li>
          If you choose to save an Apple connection: your App Store Connect team or In-App Purchase signing key, Key ID, Issuer ID
          and connection name. Private keys are encrypted in Supabase Vault and cannot be read back through the browser.
          Workspace owners and admins can replace or delete saved connections. We use them for the Apple setup and test API calls you request.
          You can also use an In-App Purchase key for a one-time test without saving it.
        </li>
        <li>
          If you use the iPhone app: the device&apos;s push notification token, its app version and your alert preferences, so we can
          send you notifications.
        </li>
        <li>If you connect Google Play: the service-account JSON key, project identity, topic, subscription, audience and push account. The key is encrypted in Vault and cannot be downloaded from the dashboard. Workspace owners and admins can replace it or disconnect the app.</li>
        <li>
          If you subscribe to Pro: your Stripe customer and subscription IDs and the subscription status. Card details are handled by
          Stripe and never reach us.
        </li>
      </ul>
      <h3>Notifications from Apple</h3>
      <p>
        When Apple sends an App Store Server Notification to your Salebell URL, we verify its signature and store the decoded payload:
        notification type, product ID, price and currency, storefront country, transaction IDs, dates, and the{" "}
        <code>appAccountToken</code> if your app sets one. We don&apos;t keep the raw signed token. Apple doesn&apos;t include your
        customers&apos; names, email addresses or Apple Account details in these notifications, so we never receive them.
      </p>
      <h3>Notifications from Google Play</h3>
      <p>We verify authenticated Pub/Sub delivery, look up purchase state with Google Play, and retain the event type, date, product and order metadata and a purchase-token hash. Raw purchase and OAuth tokens are not retained in event history. Google revenue remains unknown in the preview. Automatic setup also sends the topic, receiver and access settings you request to your Google Cloud project.</p>
      <h3>Technical data</h3>
      <p>
        Our hosting providers keep standard request logs (such as IP address, time and URL) to operate and secure the service. We use
        only the cookies needed to keep you signed in. There are no analytics or advertising cookies.{" "}
        {ANALYTICS_ENABLED ? "We count page views with Vercel Web Analytics, which uses no cookies and doesn't identify you or track you across sites." : "Website analytics are disabled on this deployment."}
      </p>

      <h2>Why we use it, and our lawful basis</h2>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Purpose</th>
              <th scope="col" className="px-3 py-2 font-medium">Lawful basis (UK GDPR)</th>
            </tr>
          </thead>
          <tbody>
            {bases.map(([purpose, basis]) => (
              <tr key={purpose} className="border-t border-border align-top">
                <td className="px-3 py-2">{purpose}</td>
                <td className="px-3 py-2">{basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Who processes it for us</h2>
      <div className="my-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Processor</th>
              <th scope="col" className="px-3 py-2 font-medium">What for</th>
              <th scope="col" className="px-3 py-2 font-medium">Where</th>
            </tr>
          </thead>
          <tbody>
            {processors.map(([name, what, where]) => (
              <tr key={name} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">{name}</td>
                <td className="px-3 py-2">{what}</td>
                <td className="px-3 py-2">{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The integrations and forwarding URLs you configure (for example Slack, Discord, Telegram, Pushover, PostHog or your own server)
        receive the event data you choose to send them, under their own terms. They are not our processors.
      </p>

      <h2>International transfers</h2>
      <p>
        Your workspace data is stored in the United Kingdom (Supabase, London). Vercel, Stripe and Apple may process personal data in
        the United States. Those transfers are protected by the UK International Data Transfer Agreement or the UK Addendum to the EU
        Standard Contractual Clauses in each provider&apos;s data processing terms.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account, app, integration and event data: while your account exists. On the Free plan, history older than 30 days is hidden
          from the dashboard but not deleted, so it returns if you upgrade.
        </li>
        <li>
          Saved Apple keys: until you delete the saved connection or its workspace. Copies in backups expire on our providers&apos;
          normal backup schedule. Deleting a connection from Salebell does not revoke the key in Apple.
        </li>
        <li>
          When you delete your account from Account settings, we delete your user and every workspace you solely own, including its
          apps, events, integrations, saved Apple and Google keys and devices, and cancel any Pro subscription. Copies in our providers&apos; backups expire on their
          normal backup schedule.
        </li>
        <li>Saved Google keys: until you disconnect or delete the app or workspace. Backup copies follow the normal backup schedule. Disconnecting does not revoke the Google key or delete topics, subscriptions or IAM grants in your project.</li>
        <li>Billing records: as long as UK tax and accounting law requires (currently six years).</li>
        <li>Request logs: kept by our hosting providers for a short period for security and debugging.</li>
      </ul>

      <h2>Your rights</h2>
      <p>Under UK data protection law you have the right to:</p>
      <ul>
        <li>access the personal data we hold about you and get a copy of it;</li>
        <li>have inaccurate data corrected;</li>
        <li>have your data erased (you can also delete your account yourself at any time);</li>
        <li>restrict or object to processing, including processing based on our legitimate interests;</li>
        <li>receive data you gave us in a portable format (Pro workspaces can also export events as CSV).</li>
      </ul>
      <p>
        You can complain to the Information Commissioner&apos;s Office (ICO), the UK data protection regulator, at{" "}
        <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk</a>. We&apos;d appreciate the chance to sort out any concern first.
      </p>
      <SupportContact prefix="To exercise any of these rights, email" />

      <h2>Children</h2>
      <p>Salebell is a tool for app developers and businesses. It isn&apos;t meant for children and we don&apos;t knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we&apos;ll update the date above and tell signed-in users.</p>
    </LegalPage>
  );
}
