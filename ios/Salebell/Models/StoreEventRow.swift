import Foundation

/// A `store_events` row as shown in the feed.
struct StoreEventRow: Identifiable, Equatable, Sendable, Decodable {
    let appID: UUID
    let eventID: UUID
    let kind: EventKind
    let environment: String
    let occurredAt: Date
    let productID: String?
    let revenue: Double?
    let currency: String?
    let storefront: String?
    let isTrial: Bool

    /// Event ids are unique per app, so the pair is the identity.
    var id: String { "\(appID.uuidString)/\(eventID.uuidString)" }
    var isSandbox: Bool { environment == "Sandbox" }

    static let selectColumns = "app_id,id,environment,type,occurred_at,product_id,revenue,currency,storefront,is_trial"

    init(appID: UUID, eventID: UUID, kind: EventKind, environment: String = "Production", occurredAt: Date,
         productID: String? = nil, revenue: Double? = nil, currency: String? = nil,
         storefront: String? = nil, isTrial: Bool = false) {
        self.appID = appID
        self.eventID = eventID
        self.kind = kind
        self.environment = environment
        self.occurredAt = occurredAt
        self.productID = productID
        self.revenue = revenue
        self.currency = currency
        self.storefront = storefront
        self.isTrial = isTrial
    }

    enum CodingKeys: String, CodingKey {
        case appID = "app_id", eventID = "id", type, environment, occurredAt = "occurred_at"
        case productID = "product_id", revenue, currency, storefront, isTrial = "is_trial"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        appID = try c.decode(UUID.self, forKey: .appID)
        eventID = try c.decode(UUID.self, forKey: .eventID)
        kind = EventKind(raw: try c.decode(String.self, forKey: .type))
        environment = (try? c.decodeIfPresent(String.self, forKey: .environment)) ?? "Production"
        occurredAt = try c.requiredDate(.occurredAt)
        productID = try? c.decodeIfPresent(String.self, forKey: .productID)
        revenue = c.optionalDouble(.revenue)
        currency = try? c.decodeIfPresent(String.self, forKey: .currency)
        storefront = try? c.decodeIfPresent(String.self, forKey: .storefront)
        isTrial = (try? c.decodeIfPresent(Bool.self, forKey: .isTrial)) ?? false
    }

    /// "Purchase (trial) · pro.monthly · USA", matching the push body format in alerts.ts.
    var detail: String {
        let label = kind.label + (isTrial && kind != .trialStarted ? " (trial)" : "")
        let product = productID.map { $0.split(separator: ".").suffix(2).joined(separator: ".") }
        return [label, product, storefront].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var formattedAmount: String? {
        guard let revenue, let currency else { return nil }
        return Money.format(revenue, currency: currency)
    }
}
