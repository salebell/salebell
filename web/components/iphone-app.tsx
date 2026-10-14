import Link from "next/link";
import { IOS_APP_URL, IS_SELF_HOSTED } from "@/lib/env";

export const IPHONE_SOON = "iPhone app coming soon (TestFlight). Slack, Discord, Telegram, Pushover and webhooks work today.";

/** One honest line about the iPhone app: a link when NEXT_PUBLIC_IOS_APP_URL is set, "coming soon" otherwise. */
export function IphoneAppNote({ className = "" }: { className?: string }) {
  if (IOS_APP_URL) {
    return (
      <a href={IOS_APP_URL} className={`inline-flex items-center gap-1.5 font-medium text-accent-text underline underline-offset-2 ${className}`}>
        <span aria-hidden="true">📱</span> Get the Salebell iPhone app
      </a>
    );
  }
  if (IS_SELF_HOSTED) return <span className={className}>iPhone push needs an app built for this instance and your APNs credentials. <Link href="/self-host#iphone" className="text-accent-text underline underline-offset-2">Build your iPhone app</Link>.</span>;
  return <span className={className}>{IPHONE_SOON}</span>;
}
