import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-55";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-[0_1px_0_rgb(0_0_0/0.08)]",
  secondary: "border border-border-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[0.9375rem]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading,
  disabled,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={loading || disabled} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`rounded-xl border border-border bg-surface ${className}`} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "warn" | "danger"; children: ReactNode }) {
  const tones = {
    neutral: "bg-surface-2 text-muted border-border",
    accent: "bg-accent-soft text-accent-text border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} aria-hidden="true" />;
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs leading-relaxed text-muted" id={`${htmlFor}-hint`}>{hint}</p>}
      {error && (
        <p className="text-xs font-medium text-danger" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "block h-10 w-full min-w-0 rounded-lg border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "warn" | "accent" | "neutral"; children: ReactNode }) {
  const tones = {
    danger: "border-danger/30 bg-danger-soft text-danger",
    warn: "border-warn/30 bg-warn-soft text-warn",
    accent: "border-accent/30 bg-accent-soft text-accent-text",
    neutral: "border-border bg-surface-2 text-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.14em] text-accent-text">{eyebrow}</p>}
      <h2 className="text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-lg leading-relaxed text-muted text-pretty">{children}</p>}
    </div>
  );
}
