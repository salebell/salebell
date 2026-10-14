// Mirrors docs/PRODUCT.md section 2.
export const PRICES = { month: 9, year: 79 } as const;
/** Stripe promotion code for the first 100 founding members: 33% off forever. */
export const FOUNDER = { code: "FOUNDER", percent: 33, seats: 100, month: 6, year: 53 } as const;
export const YEARLY_PER_MONTH = (PRICES.year / 12).toFixed(2);
export const FOUNDER_SENTENCE = `Founding members: code ${FOUNDER.code} takes ${FOUNDER.percent}% off Pro for as long as you stay subscribed ($${FOUNDER.month}/mo or $${FOUNDER.year}/yr), first ${FOUNDER.seats} customers.`;
export const YEARLY_SAVING = Math.round((1 - PRICES.year / (PRICES.month * 12)) * 100);
export const FREE_LIMITS = { apps: 1, channels: 1, historyDays: 30 } as const;

export const PLAN_ROWS: { label: string; free: string | boolean; pro: string | boolean }[] = [
  { label: "Apps", free: "1", pro: "Unlimited (fair use: 50)" },
  { label: "iPhone push alerts (requires configured iOS app)", free: true, pro: true },
  { label: "Integrations: Slack, Discord, Telegram, webhook, PostHog, Pushover", free: "1", pro: "Unlimited" },
  { label: "Dashboard history", free: "Last 30 days", pro: "Everything" },
  { label: "Forwarding to your existing server URL", free: true, pro: true },
  { label: "CSV export", free: false, pro: true },
];
