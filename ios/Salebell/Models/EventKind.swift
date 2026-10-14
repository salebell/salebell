import Foundation

/// Mirrors `StoreEventType` and the labels in `supabase/functions/_shared/core/alerts.ts`.
/// Unknown types from a newer backend decode as `.other` so the feed never breaks.
enum EventKind: String, CaseIterable, Sendable {
    case purchase
    case trialStarted = "trial_started"
    case introOfferStarted = "intro_offer_started"
    case renewal
    case resubscribe
    case billingRecovered = "billing_recovered"
    case billingIssue = "billing_issue"
    case cancellation
    case uncancellation
    case expired
    case refund
    case refundDeclined = "refund_declined"
    case refundReversed = "refund_reversed"
    case revoked
    case productChange = "product_change"
    case priceIncrease = "price_increase"
    case offerRedeemed = "offer_redeemed"
    case renewalExtended = "renewal_extended"
    case consumptionRequest = "consumption_request"
    case test
    case other

    init(raw: String) {
        self = EventKind(rawValue: raw) ?? .other
    }

    var emoji: String {
        switch self {
        case .purchase: "💰"
        case .trialStarted: "🧪"
        case .introOfferStarted: "🏷️"
        case .renewal: "🔁"
        case .resubscribe: "↩️"
        case .billingRecovered: "✅"
        case .billingIssue: "⚠️"
        case .cancellation: "🚪"
        case .uncancellation: "🔓"
        case .expired: "⌛"
        case .refund: "💸"
        case .refundDeclined: "🛡️"
        case .refundReversed: "↪️"
        case .revoked: "⛔"
        case .productChange: "🔀"
        case .priceIncrease: "📈"
        case .offerRedeemed: "🎟️"
        case .renewalExtended: "⏩"
        case .consumptionRequest: "📨"
        case .test: "🔔"
        case .other: "ℹ️"
        }
    }

    var label: String {
        switch self {
        case .purchase: "Purchase"
        case .trialStarted: "Trial started"
        case .introOfferStarted: "Intro offer started"
        case .renewal: "Renewal"
        case .resubscribe: "Resubscribed"
        case .billingRecovered: "Billing recovered"
        case .billingIssue: "Billing issue"
        case .cancellation: "Auto-renew turned off"
        case .uncancellation: "Auto-renew turned on"
        case .expired: "Expired"
        case .refund: "Refund"
        case .refundDeclined: "Refund declined"
        case .refundReversed: "Refund reversed"
        case .revoked: "Access revoked"
        case .productChange: "Plan change"
        case .priceIncrease: "Price increase response"
        case .offerRedeemed: "Offer redeemed"
        case .renewalExtended: "Renewal extended"
        case .consumptionRequest: "Consumption request (respond within 12h)"
        case .test: "App Store test notification"
        case .other: "Store event"
        }
    }

    /// Needs attention: shown with a warning tint in the feed.
    var isNegative: Bool {
        switch self {
        case .refund, .billingIssue, .revoked, .consumptionRequest: true
        default: false
        }
    }
}
