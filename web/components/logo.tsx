import Link from "next/link";
import { BELL_PATHS } from "./brand";

export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      {BELL_PATHS.map((d) => (
        <path key={d} d={d} fill="none" stroke="var(--accent-fg)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function Logo({ href = "/", textClassName = "" }: { href?: string; textClassName?: string }) {
  return (
    <Link href={href} aria-label="Salebell" className="inline-flex items-center gap-2 rounded-md font-semibold tracking-tight text-fg">
      <LogoMark />
      <span className={`text-[1.0625rem] ${textClassName}`}>Salebell</span>
    </Link>
  );
}
