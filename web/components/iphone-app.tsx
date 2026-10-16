import Link from "next/link";
import { IOS_APP_URL } from "@/lib/env";

export const IPHONE_SOON = "An iPhone app download is not configured here yet. Slack, Discord, Telegram, Pushover and webhooks work independently.";

/** Distribution is offered only when the operator configures a compatible build. */
export function IphoneAppNote({ className = "" }: { className?: string }) {
  if (IOS_APP_URL) {
    return (
      <a href={IOS_APP_URL} className={`inline-flex items-center gap-1.5 font-medium text-accent-text underline underline-offset-2 ${className}`}>
        <span aria-hidden="true">📱</span> Get the Salebell iPhone app
      </a>
    );
  }
  return <span className={className}>{IPHONE_SOON} <Link href="/self-host#iphone" className="text-accent-text underline underline-offset-2">iPhone connection guide</Link>.</span>;
}
