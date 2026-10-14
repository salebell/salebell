import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { COMPANY_ADDRESS, COMPANY_NAME, COMPANY_NUMBER, SUPPORT_EMAIL, SOURCE_URL, IS_SELF_HOSTED } from "@/lib/env";

export const APPLE_DISCLAIMER =
  "Salebell is not affiliated with Apple Inc. App Store and App Store Connect are trademarks of Apple Inc.";

/** Operator name, company number and registered office when configured. */
export function companyLine() {
  return [
    COMPANY_NAME,
    COMPANY_NUMBER && `company number ${COMPANY_NUMBER}`,
    COMPANY_ADDRESS && `registered office ${COMPANY_ADDRESS}`,
  ]
    .filter(Boolean)
    .join(", ");
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-5" />
            <span>
              © {new Date().getFullYear()} {COMPANY_NAME}
            </span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/pricing" className="hover:text-fg">Pricing</Link>
            <Link href="/docs" className="hover:text-fg">Setup guide</Link>
            <Link href="/self-host" className="hover:text-fg">Self-host</Link>
            <a href={SOURCE_URL} className="hover:text-fg">Source code ↗</a>
            <Link href="/privacy" className="hover:text-fg">Privacy</Link>
            <Link href="/terms" className="hover:text-fg">Terms</Link>
            {SUPPORT_EMAIL && (
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-fg">
                Support
              </a>
            )}
          </nav>
        </div>
        <div className="mt-6 space-y-1 border-t border-border pt-6 text-xs leading-relaxed">
          <p>Open-source software under the MIT license.{IS_SELF_HOSTED ? " This instance is independently operated." : " Managed cloud is optional."}</p>
          <p>{APPLE_DISCLAIMER}</p>
          {(COMPANY_NUMBER || COMPANY_ADDRESS) && <p>{companyLine()}.</p>}
        </div>
      </div>
    </footer>
  );
}
