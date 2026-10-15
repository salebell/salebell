import type { ComponentProps } from "react";
import { Spinner } from "@/components/ui";
import { ConnectionIcon } from "./connection-flow";

export function GoogleKeyUpload({ fileName, reading, disabled, ...props }: Omit<ComponentProps<"input">, "type" | "className" | "children"> & { fileName: string; reading: boolean }) {
  return (
    <label htmlFor={props.id} className={`relative flex min-w-0 flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong bg-surface-2 px-4 py-6 text-center transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-accent/60 hover:bg-accent-soft/30"}`}>
      {reading ? <Spinner className="size-6 text-accent-text" /> : <ConnectionIcon kind={fileName ? "check" : "upload"} className="size-6 text-accent-text" />}
      <span className="max-w-full break-all text-sm font-medium" role="status">{fileName || "Choose your JSON file"}</span>
      <span className="text-xs text-muted" role="status">{reading ? "Reading key…" : fileName ? "Click to choose a different file" : "Service-account JSON · up to 32 KB"}</span>
      <input {...props} type="file" accept=".json,application/json" disabled={disabled} className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label="Google service-account JSON file" />
    </label>
  );
}
