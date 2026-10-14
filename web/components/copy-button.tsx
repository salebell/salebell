"use client";

import { useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  ariaLabel,
  className = "",
}: {
  value: string;
  label?: string;
  /** Names what is copied for screen readers, e.g. "Copy Production URL". */
  ariaLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard can be blocked (insecure context); fall back to a hidden textarea.
      const t = document.createElement("textarea");
      t.value = value;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-xs font-medium text-fg transition-colors hover:bg-surface-2 ${className}`}
      aria-label={copied ? "Copied" : (ariaLabel ?? label)}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="size-3.5 text-accent-text" aria-hidden="true">
          <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}

export function CopyField({ label, value, id }: { label: string; value: string; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 p-1.5 pl-3">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-[0.8125rem] text-fg focus:outline-none"
        />
        <CopyButton value={value} label="Copy" ariaLabel={`Copy ${label}`} />
      </div>
    </div>
  );
}
