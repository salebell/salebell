import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportContact } from "@/components/marketing/legal";
import { APPLE_DISCLAIMER, companyLine } from "@/components/marketing/site-footer";
import { PRICES } from "@/lib/plans";
import { COMPANY_NAME, IS_SELF_HOSTED, SOURCE_URL } from "@/lib/env";

export const metadata: Metadata = { title: "Terms of service", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  if (IS_SELF_HOSTED) return <LegalPage title="Self-hosted instance" updated="14 October 2026">
    <p>This Salebell instance is operated by {companyLine()}. The instance operator controls access, hosting, support and availability. These are separate from the optional Salebell Cloud service.</p>
    <h2>Software license</h2>
    <p>Salebell is open-source software under the MIT license. You may use, modify and self-host it subject to the license in the <a href={SOURCE_URL}>source repository</a>. The software is provided with the warranty and liability terms stated in that license.</p>
    <h2>Using this instance</h2>
    <p>Only register apps and configure destinations you are authorized to manage. The service receives verified Apple notifications, records events, sends configured alerts and forwards notifications to your servers. Android / Google Play RTDN support is coming soon.</p>
    <p>No Salebell Cloud subscription is required to use the self-hosted features. Your operator is responsible for infrastructure and delivery costs, credentials, maintenance, updates and backups.</p>
    <h2>Your data</h2>
    <p>Read this instance&apos;s <Link href="/privacy">privacy information</Link> and contact the operator for any additional terms or policies. Revenue figures are estimates from Apple events and exchange rates; use App Store Connect for payouts and accounting.</p>
    <p>{APPLE_DISCLAIMER}</p>
    <SupportContact prefix="Contact this instance's operator at" />
  </LegalPage>;

  return (
    <LegalPage title="Terms of service" updated="9 October 2026">
      <p>
        These terms are an agreement between you and {COMPANY_NAME} (&quot;we&quot;), the seller and operator of Salebell Cloud. By creating an
        account or using Salebell, you agree to them. If you use Salebell for a company, you confirm you can accept these terms on
        its behalf.
      </p>
      <p>Salebell is provided by {companyLine()}.</p>

      <h2>The service</h2>
      <p>
        Salebell receives App Store Server Notifications for apps you register, shows them in a dashboard, sends the alerts you
        configure and forwards notifications to URLs you provide. Revenue figures are estimates based on customer prices reported by
        Apple and daily exchange rates. They aren&apos;t a statement of your proceeds; App Store Connect is the source of truth for
        payouts.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep access to your email account secure; it&apos;s how you sign in.</li>
        <li>Only register apps you are allowed to manage, and only send us data you are allowed to share.</li>
        <li>
          Don&apos;t misuse the service: no attempts to break or overload it, access other customers&apos; data, or use forwarding or
          webhooks to attack third parties.
        </li>
      </ul>

      <h2>Plans and billing</h2>
      <ul>
        <li>The Free plan costs nothing and has the limits shown on the <Link href="/pricing">pricing page</Link>.</li>
        <li>
          Pro costs ${PRICES.month} per month or ${PRICES.year} per year (USD, plus any applicable taxes), billed in advance through
          Stripe. It renews automatically until you cancel.
        </li>
        <li>
          You can cancel any time from the billing page. Pro stays active until the end of the period you&apos;ve paid for. We don&apos;t
          give partial refunds for unused time unless the law requires it.
        </li>
        <li>
          If you move to Free, your data stays. Apps and integrations beyond the Free limits pause, and older history is hidden until you
          upgrade again.
        </li>
        <li>We may change prices with at least 30 days&apos; notice before your next renewal.</li>
      </ul>

      <h2>Availability</h2>
      <p>
        We work hard to keep Salebell running, but we provide it &quot;as is&quot; without a guaranteed uptime. Apple retries production
        notifications it couldn&apos;t deliver, and you can recover missed notifications from Apple&apos;s APIs. Alerts and forwards
        depend on third-party services we don&apos;t control.
      </p>

      <h2>Your data</h2>
      <p>
        You own the data you send to Salebell. You give us permission to process it only to provide the service, as described in our{" "}
        <Link href="/privacy">privacy policy</Link>. You can delete your account and its data at any time.
      </p>

      <h2>Apple</h2>
      <p>
        {APPLE_DISCLAIMER} Salebell uses App Store Server Notifications that you choose to send to it; your use of App Store Connect
        stays subject to Apple&apos;s own terms.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we aren&apos;t liable for indirect or consequential losses, lost profits or lost data, and our total
        liability for any claim is limited to the amount you paid us in the 12 months before it. Nothing in these terms limits liability
        that can&apos;t be limited by law.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can stop using Salebell and delete your account whenever you like. We may suspend or close accounts that break these terms,
        and we&apos;ll give notice where we reasonably can.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms and any dispute about them are governed by the laws of England and Wales, and the courts of England and Wales have
        jurisdiction. If you are a consumer, you also keep any protection the law of your country of residence gives you.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. For material changes we&apos;ll give signed-in users notice before they take effect. Continuing to use
        Salebell after that means you accept the new terms.
      </p>
      <SupportContact />
    </LegalPage>
  );
}
