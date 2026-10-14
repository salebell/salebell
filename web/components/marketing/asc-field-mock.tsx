import { webhookUrl } from "@/lib/env";

// A stylised App Store Connect "App Store Server Notifications" section. Illustrative, not a screenshot.
export function AscFieldMock({ webhookKey = "9f3c…a71e" }: { webhookKey?: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-surface shadow-[0_12px_40px_-20px_rgb(0_0_0/0.25)]">
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="size-2.5 rounded-full bg-border-strong" />
        <span className="ml-2 truncate font-mono text-[0.6875rem] text-muted">App Store Connect · App Information</span>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm font-semibold">App Store Server Notifications</p>
        {(["Production", "Sandbox"] as const).map((env) => (
          <div key={env}>
            <p className="mb-1.5 text-xs font-medium text-muted">{env} Server URL</p>
            <div className="flex items-center gap-2 rounded-md border border-accent/60 bg-accent-soft/40 px-2.5 py-2 ring-2 ring-accent/15">
              <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] sm:text-xs">
                {webhookUrl(webhookKey, env === "Production" ? "production" : "sandbox")}
              </span>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-[0.6875rem] text-muted">
              <span className="inline-block size-3 rounded-full border-[3.5px] border-accent bg-surface" aria-hidden="true" /> Version 2
            </p>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        The App Store Server Notifications section in App Store Connect, with Salebell URLs pasted into the Production and Sandbox
        Server URL fields and Version 2 selected.
      </figcaption>
    </figure>
  );
}
