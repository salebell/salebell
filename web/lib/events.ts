// Friendly labels for the StoreEventType values in supabase/functions/_shared/core/events.ts.
type Tone = "money" | "good" | "warn" | "bad" | "neutral";

export const EVENT_LABELS: Record<string, { emoji: string; label: string; tone: Tone }> = {
  purchase: { emoji: "💰", label: "New purchase", tone: "money" },
  trial_started: { emoji: "🎁", label: "Free trial started", tone: "good" },
  intro_offer_started: { emoji: "🏷️", label: "Intro offer started", tone: "good" },
  renewal: { emoji: "🔁", label: "Renewal", tone: "money" },
  resubscribe: { emoji: "👋", label: "Resubscribed", tone: "money" },
  billing_recovered: { emoji: "🩹", label: "Billing recovered", tone: "money" },
  billing_issue: { emoji: "💳", label: "Billing issue", tone: "warn" },
  cancellation: { emoji: "🚪", label: "Auto-renew turned off", tone: "warn" },
  uncancellation: { emoji: "↩️", label: "Auto-renew turned back on", tone: "good" },
  expired: { emoji: "⌛", label: "Subscription expired", tone: "neutral" },
  refund: { emoji: "💸", label: "Refund", tone: "bad" },
  refund_declined: { emoji: "🛡️", label: "Refund declined", tone: "good" },
  refund_reversed: { emoji: "🔄", label: "Refund reversed", tone: "money" },
  revoked: { emoji: "⛔", label: "Access revoked", tone: "bad" },
  product_change: { emoji: "🔀", label: "Plan change scheduled", tone: "neutral" },
  price_increase: { emoji: "📈", label: "Price increase consent", tone: "neutral" },
  offer_redeemed: { emoji: "🎟️", label: "Offer redeemed", tone: "good" },
  renewal_extended: { emoji: "📅", label: "Renewal date extended", tone: "neutral" },
  consumption_request: { emoji: "📨", label: "Refund consumption request", tone: "warn" },
  test: { emoji: "🧪", label: "Test notification", tone: "neutral" },
  other: { emoji: "📬", label: "Other notification", tone: "neutral" },
};

export function eventLabel(type: string) {
  return EVENT_LABELS[type] ?? EVENT_LABELS.other;
}
