const usdFormatters = new Map<number, Intl.NumberFormat>();

/** USD with a fixed number of decimals; money always renders with tabular figures in the UI. */
export function usd(amount: number, decimals = 2) {
  let f = usdFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    usdFormatters.set(decimals, f);
  }
  return f.format(amount);
}

/** Compact USD for chart axes: $0, $950, $1.2K. */
export function usdCompact(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

/** Amount in the customer's currency, e.g. "€4.99" or "¥600". */
export function money(value: number | string, currency: string | null) {
  const amount = Number(value);
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function count(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), "day");
  return dateTime(iso);
}

export function dateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function shortDate(day: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** YYYY-MM-DD in UTC, matching the daily_revenue view's day column. */
export function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}
