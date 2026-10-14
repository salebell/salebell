import type { StoreEvent } from "@/lib/database.types";

export const CSV_COLUMNS = [
  "occurred_at", "received_at", "environment", "type", "raw_type", "raw_subtype", "product_id", "revenue", "currency",
  "storefront", "transaction_id", "original_transaction_id", "app_user_id", "is_trial", "is_family_shared", "id",
] as const;

export type CsvEvent = Pick<StoreEvent, (typeof CSV_COLUMNS)[number]>;

function cell(v: unknown) {
  if (v == null) return "";
  const s = String(v);
  // Quote when needed, and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: CsvEvent[]) {
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n");
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
