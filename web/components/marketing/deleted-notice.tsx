"use client";

import { useSearchParams } from "next/navigation";

/** Shown on /?deleted=1 after Account → Delete account. */
export function DeletedNotice() {
  const params = useSearchParams();
  if (params.get("deleted") !== "1") return null;
  return (
    <div role="status" className="border-b border-border bg-accent-soft/60">
      <p className="mx-auto max-w-6xl px-4 py-3 text-sm sm:px-6">
        <span className="font-medium">Your account was deleted.</span>{" "}
        <span className="text-muted">Any Pro subscription was canceled. Remember to remove the Salebell URLs from App Store Connect.</span>
      </p>
    </div>
  );
}
