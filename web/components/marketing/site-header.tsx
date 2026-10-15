import Link from "next/link";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui";
import { IS_SELF_HOSTED, SOURCE_URL } from "@/lib/env";

// Docs drops out below sm so Sign in fits at 375px; the footer still links it.
const links = [
  ...(!IS_SELF_HOSTED ? [{ href: "/pricing", label: "Pricing", className: "" }] : []),
  { href: "/docs", label: "Docs", className: "hidden sm:inline-flex" },
  { href: "/self-host", label: "Self-host", className: "hidden sm:inline-flex" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="flex items-center sm:gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:text-fg sm:px-2.5 ${l.className}`}>
              {l.label}
            </Link>
          ))}
          <a href={SOURCE_URL} className="hidden rounded-md px-2 py-1.5 text-sm text-muted hover:text-fg lg:inline-flex">GitHub ↗</a>
          <Link href="/login" className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:text-fg sm:px-2.5">
            Sign in
          </Link>
          <ButtonLink href="/login" size="sm" className="ml-1">
            {IS_SELF_HOSTED ? "Open dashboard" : "Start free"}
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
