import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ANALYTICS_ENABLED, SITE_URL } from "@/lib/env";
import "./globals.css";

const description =
  "Open-source in-app purchase monitoring. Self-host Salebell or use optional managed cloud for verified Apple events, alerts and a live revenue dashboard. No SDK. Google Play RTDN coming soon.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Salebell: real-time in-app purchase alerts", template: "%s · Salebell" },
  description,
  applicationName: "Salebell",
  openGraph: { type: "website", siteName: "Salebell", url: SITE_URL, title: "Salebell: real-time in-app purchase alerts", description },
  twitter: { card: "summary_large_image", title: "Salebell: real-time in-app purchase alerts", description },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0e0c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        {children}
        {ANALYTICS_ENABLED && <Analytics />}
      </body>
    </html>
  );
}
