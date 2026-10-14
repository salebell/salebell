import type { ReactNode } from "react";
import { SUPPORT_EMAIL } from "@/lib/env";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="prose-sp mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <h1 className="text-4xl font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="text-sm !text-muted">Last updated {updated}</p>
      {children}
    </article>
  );
}

/** "Contact us at support@…" only when NEXT_PUBLIC_SUPPORT_EMAIL is set. */
export function SupportContact({ prefix = "Questions? Email us at" }: { prefix?: string }) {
  if (!SUPPORT_EMAIL) return null;
  return (
    <p>
      {prefix} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
    </p>
  );
}
