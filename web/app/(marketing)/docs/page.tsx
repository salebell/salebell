import type { Metadata } from "next";
import Link from "next/link";
import { IphoneAppNote } from "@/components/iphone-app";
import { IS_SELF_HOSTED, webhookUrl } from "@/lib/env";

export const metadata: Metadata = {
  title: "Setup guide",
  description:
    "Import your iOS app with App Store Connect or use manual setup, preserve an existing server, confirm Apple notification receipt, and choose optional alerts. Google Play RTDN setup in preview.",
  alternates: { canonical: "/docs" },
};

const toc = [
  ["before", "Before you start"],
  ["add-app", "1. Add your app"],
  ["forwarding", "2. Keep your existing server"],
  ["asc", "3. Connect Apple notifications"],
  ["test", "4. Check your connection"],
  ["alerts", "5. Set up alerts (optional)"],
  ["webhook-format", "Webhook format"],
  ["troubleshooting", "Troubleshooting"],
] as const;

export default function DocsPage() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-24 space-y-1 text-sm">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-muted">On this page</p>
          {toc.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-md py-1 text-muted hover:text-fg">
              {label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="prose-sp min-w-0 max-w-3xl">
        <p className="!mt-0 font-mono text-xs uppercase tracking-[0.14em] text-accent-text">Setup guide</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl">Connect your app to Salebell</h1>
        <p className="text-lg text-muted">
          Salebell receives Apple&apos;s App Store Server Notifications (version 2) for your app. There is no SDK and nothing changes in
          your app. Import from App Store Connect and let Salebell configure the URLs, or enter your app and paste the URLs manually.
        </p>
        <p>Self-host Salebell or use optional managed cloud. <Link href="/self-host">Install your own instance</Link> before connecting an app. Android / Google Play RTDN: <strong>Preview</strong>. For Android, upload a service-account JSON key, select an app, configure Pub/Sub and send a test from Play Console. App discovery requires the Google Play Developer Reporting API and app access in Play Console; manual entry is also available. Google revenue is currently unknown.</p>

        <p>
          <strong>What&apos;s covered:</strong> in-app purchases and subscriptions, meaning purchases, free trials, renewals, refunds,
          billing issues, cancellations and expirations. Apple doesn&apos;t send server notifications for paid-app downloads, so those
          don&apos;t appear in Salebell.
        </p>

        <h2 id="before">Before you start</h2>
        <ul>
          <li>For automatic setup: an App Store Connect <strong>team API key</strong> with App Manager access, its Key ID and Issuer ID. This key imports apps and configures notification URLs; it is different from an In-App Purchase test key.</li>
          <li>
            For manual setup: your app&apos;s <strong>bundle ID</strong>, for example <code>com.example.myapp</code>. Salebell only accepts notifications
            whose signed payload carries this bundle ID.
          </li>
          <li>
            An App Store Connect role that can edit server URLs: <strong>Account Holder, Admin, App Manager or Marketing</strong>.
          </li>
          <li>
            Optional: your app&apos;s <strong>Apple ID</strong>, the number under General → App Information in App Store Connect. When set,
            production notifications must match it too.
          </li>
        </ul>

        <h2 id="add-app">1. Add your app</h2>
        <ol>
          <li>
            <Link href="/login">Sign in</Link>. {IS_SELF_HOSTED ? "Use the email and password created by your instance administrator." : "Cloud sends a 6-digit email code. Self-hosted instances use an administrator-created account and password."}
          </li>
          <li>Click <strong>Add app</strong>. Apple App Store is selected by default; Android opens the Google Play setup flow.</li>
          <li>Save or select an App Store Connect team key, choose the app, and review the connection. Choose <strong>Enter app details manually</strong> if you prefer to enter the name, bundle ID and optional Apple ID without a key.</li>
          <li>
            Salebell shows two URLs, one per environment. Each contains a random key that identifies your app:
            <pre>
              <code>{`${webhookUrl("<your-key>", "production")}\n${webhookUrl("<your-key>", "sandbox")}`}</code>
            </pre>
          </li>
        </ol>

        <h2 id="forwarding">2. Keep your existing server (before you paste)</h2>
        <p>
          App Store Connect accepts one URL per environment. If one of those fields already points at your own server (or another
          service), automatic setup preserves supported existing Version 2 URLs. Review them under <strong>Connection details</strong>. With manual setup, copy them before replacing them, then save them under <strong>Your server</strong> in Salebell.
        </p>
        <ul>
          <li>
            Every notification that passes verification is forwarded with the <strong>same body</strong> Apple sent (the{" "}
            <code>signedPayload</code> JSON), so your server keeps verifying Apple&apos;s signature exactly as before.
          </li>
          <li>Production notifications go to the production forwarding URL and sandbox notifications to the sandbox one.</li>
          <li>
            Forwarding happens in the background after Salebell acknowledges Apple. It&apos;s one attempt with a 10-second timeout, and
            failures are logged. To backfill anything your server missed, use Apple&apos;s Get Notification History endpoint.
          </li>
          <li>
            Forwarded requests keep Apple&apos;s content type and add one header, <code>x-salebell-forwarded: 1</code>. Redirects aren&apos;t
            followed, so use your server&apos;s final URL.
          </li>
          <li>Forwarding URLs must use https and a public host name (no IP addresses or localhost). Forwarding is on every plan.</li>
        </ul>

        <h2 id="asc">3. Connect Apple notifications</h2>
        <p>With automatic setup, select <strong>Start receiving notifications</strong>. Salebell checks Apple&apos;s current settings, preserves supported existing servers through forwarding, and configures both URLs for Version 2. If a Version 1 or unsupported receiver needs attention, review the error and continue manually.</p>
        <h3>Manual setup</h3>
        <p>
          <strong>
            Already have a URL in either App Store Connect field? Copy it into Your server first, or your server stops receiving
            notifications.
          </strong>
        </p>
        <p>These are Apple&apos;s steps for setting a server URL. Do it once for production and once for sandbox.</p>
        <h3>Production</h3>
        <ol>
          <li>In <strong>Apps</strong>, select your app.</li>
          <li>In the sidebar, under <strong>General</strong>, click <strong>App Information</strong>.</li>
          <li>
            Scroll down to <strong>General Information</strong>, then go to <strong>App Store Server Notifications</strong>.
          </li>
          <li>
            Under <strong>Production Server URL</strong>, click <strong>Set Up URL</strong> (or <strong>Edit</strong> if a URL is already
            there).
          </li>
          <li>Paste your Salebell production URL.</li>
          <li>
            Choose <strong>Version 2</strong>. Salebell doesn&apos;t accept version 1, which Apple has deprecated.
          </li>
          <li>Click <strong>Save</strong>.</li>
        </ol>
        <h3>Sandbox</h3>
        <p>
          Repeat the same steps under <strong>Sandbox Server URL</strong> with your Salebell sandbox URL, Version 2.
        </p>
        <p>
          <strong>Set both.</strong> If the Sandbox Server URL is empty, Apple sends sandbox notifications to the production URL, and
          Salebell rejects them there because the signed environment doesn&apos;t match the URL. Apple notes that changes can take up
          to an hour to reach the sandbox environment.
        </p>

        <h2 id="test">4. Check your connection</h2>
        <p>
          Your app&apos;s setup page in Salebell shows <strong>Waiting for the first notification…</strong> and switches to{" "}
          <strong>Connected</strong> as soon as anything arrives. There are two ways to trigger one.
        </p>
        <h3>Option A: make a sandbox purchase</h3>
        <p>
          Buy something in a TestFlight build, or in a development build while signed in with a Sandbox Apple Account (create one in App
          Store Connect under <strong>Users and Access</strong> → <strong>Sandbox</strong>). Apple sends the notification to your sandbox
          URL and it appears in Salebell with a Sandbox label.
        </p>
        <p>
          Purchases made with StoreKit Testing in Xcode (a local <code>.storekit</code> configuration file) never reach Apple&apos;s
          servers, so they don&apos;t produce server notifications.
        </p>
        <h3>Option B: ask Apple for a TEST notification</h3>
        <p>
          No purchase needed. Under <strong>Check your connection</strong> on your app&apos;s Setup page, use{" "}
          <strong>Send an App Store test notification</strong>. Pick Sandbox or Production, select a saved In-App Purchase key or upload
          one, then click <strong>Send sandbox test notification</strong> or <strong>Send production test notification</strong>.
          An accepted request may still be pending or fail delivery. When Salebell receives and verifies it, the event feed shows{" "}
          <strong>Test notification</strong>. The test form stays visible after receipt.
        </p>
        <p>
          To get the key, open App Store Connect → <strong>Users and Access</strong> → <strong>Integrations</strong> →{" "}
          <strong>In-App Purchase</strong> → <strong>Generate In-App Purchase Key</strong> (Account Holder or Admin) and download the{" "}
          <code>.p8</code> file. Copy the <strong>Key ID</strong> (filled in for you when the file name has it) and the{" "}
          <strong>Issuer ID</strong> from the top of that page. Salebell reuses the Issuer ID for a known key or single saved Apple team;
          choose the matching team when several are saved. Owners and admins can save the key encrypted for reuse or choose one-time
          use without saving. An App Store Connect API key imports apps and configures their URLs; it cannot send this test.
        </p>

        <h2 id="alerts">5. Set up alerts (optional)</h2>
        <p>
          Salebell records verified notifications without an alert destination. Choose <strong>Set up alerts (optional) →</strong> when
          you want alerts, or go straight to the dashboard. From alert setup, <strong>← Connection &amp; test</strong> returns to the Apple
          test.
        </p>
        <ul>
          <li>
            <strong>iPhone:</strong> {IS_SELF_HOSTED ? "use an iPhone app built for your instance, configure its APNs credentials, then sign in and allow notifications." : "install the Salebell iPhone app, sign in with the same email and allow notifications."} Every
            enabled device of every workspace member gets a push. Sandbox alerts are off by default and can be turned on per device.{" "}
            <IphoneAppNote />
          </li>
          <li>
            <strong>Integrations:</strong> on your app&apos;s Integrations tab, add Slack or Discord (incoming webhook URL), Telegram
            (bot token and chat ID), Pushover (app token and user key), PostHog (project API key and host)
            or your own webhook (URL and signing secret). Each one has a <strong>Send test alert</strong> button.
          </li>
          <li>
            Phone-style channels (Telegram, Pushover) get money and churn events by default. Webhooks and PostHog get every event.
          </li>
        </ul>

        <h2 id="webhook-format">Webhook format</h2>
        <p>
          Webhook integrations receive a JSON <code>POST</code> for each event with two headers you can use to verify it came from
          Salebell:
        </p>
        <pre>
          <code>{`x-salebell-timestamp: 1791504000
x-salebell-signature: hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))

{
  "type": "store_event",
  "app": "My App",
  "event": {
    "id": "…", "store": "app_store", "environment": "Production",
    "type": "purchase", "rawType": "SUBSCRIBED", "rawSubtype": "INITIAL_BUY",
    "occurredAt": "2026-10-09T08:41:00.000Z",
    "productId": "pro.yearly", "revenue": 49.99, "currency": "USD", "storefront": "USA",
    "transactionId": "…", "originalTransactionId": "…", "appUserId": null,
    "isTrial": false, "isFamilyShared": false
  }
}`}</code>
        </pre>
        <p>
          Compute the HMAC over the timestamp, a dot and the raw request body, compare it in constant time and reject old timestamps.
          Refunds carry a negative <code>revenue</code>.
        </p>

        <h2 id="troubleshooting">Troubleshooting</h2>
        <ul>
          <li>
            <strong>Nothing arrives.</strong> Check that the URL in App Store Connect matches exactly, that Version 2 is selected and that
            the app is enabled in Salebell. Apple can take up to an hour to apply changes in sandbox.
          </li>
          <li>
            <strong>Production works, sandbox doesn&apos;t.</strong> Make sure the Sandbox Server URL is set to the URL ending in{" "}
            <code>/sandbox</code>.
          </li>
          <li>
            <strong>Notifications are rejected.</strong> The bundle ID in Salebell must match the app exactly. If you entered an Apple
            ID, it must match the app too.
          </li>
          <li>
            <strong>My own server stopped receiving notifications.</strong> Add its URL under Your server for the matching environment.
          </li>
        </ul>
        <p>
          Still stuck? Your app&apos;s dashboard shows every notification Salebell accepted. If the feed stays empty after a sandbox
          purchase, Apple didn&apos;t deliver it to Salebell, and the Get Test Notification Status endpoint will tell you why.
        </p>
      </article>
    </div>
  );
}
