import Foundation

/// Numbers for one window (today, 7 days or 30 days).
struct PeriodStats: Equatable, Sendable {
    var grossUSD: Double = 0
    var purchases = 0
    var trials = 0
    var renewals = 0
    var refunds = 0

    static func + (a: PeriodStats, b: PeriodStats) -> PeriodStats {
        PeriodStats(grossUSD: a.grossUSD + b.grossUSD, purchases: a.purchases + b.purchases,
                    trials: a.trials + b.trials, renewals: a.renewals + b.renewals, refunds: a.refunds + b.refunds)
    }
}

enum Period: String, CaseIterable, Identifiable, Sendable {
    case today, week, month
    var id: Self { self }
    var title: String {
        switch self {
        case .today: "Today"
        case .week: "7 days"
        case .month: "30 days"
        }
    }
    var suffix: String {
        switch self {
        case .today: "today"
        case .week: "7d"
        case .month: "30d"
        }
    }
}

/// One row of the backend's `app_overview` (see docs/PRODUCT.md §5).
struct AppOverview: Identifiable, Equatable, Sendable, Decodable {
    let id: UUID
    let accountID: UUID?
    let name: String
    let bundleID: String
    var today: PeriodStats
    var week: PeriodStats
    var month: PeriodStats
    var lastProductionEventAt: Date?
    var lastSandboxEventAt: Date?
    /// Over the account's plan limit: events are recorded but alerts are paused.
    var alertsPaused = false

    func stats(_ period: Period) -> PeriodStats {
        switch period {
        case .today: today
        case .week: week
        case .month: month
        }
    }

    init(id: UUID, accountID: UUID? = nil, name: String, bundleID: String,
         today: PeriodStats = .init(), week: PeriodStats = .init(), month: PeriodStats = .init(),
         lastProductionEventAt: Date? = nil, lastSandboxEventAt: Date? = nil) {
        self.id = id
        self.accountID = accountID
        self.name = name
        self.bundleID = bundleID
        self.today = today
        self.week = week
        self.month = month
        self.lastProductionEventAt = lastProductionEventAt
        self.lastSandboxEventAt = lastSandboxEventAt
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        id = try c.decode(UUID.self, forKey: Key("app_id"))
        accountID = try? c.decodeIfPresent(UUID.self, forKey: Key("account_id"))
        name = (try? c.decodeIfPresent(String.self, forKey: Key("name"))) ?? "Untitled app"
        bundleID = (try? c.decodeIfPresent(String.self, forKey: Key("bundle_id"))) ?? ""
        func period(_ p: Period) -> PeriodStats {
            PeriodStats(grossUSD: c.lossyDouble(Key("gross_usd_\(p.suffix)")),
                        purchases: c.lossyInt(Key("purchases_\(p.suffix)")),
                        trials: c.lossyInt(Key("trials_\(p.suffix)")),
                        renewals: c.lossyInt(Key("renewals_\(p.suffix)")),
                        refunds: c.lossyInt(Key("refunds_\(p.suffix)")))
        }
        today = period(.today)
        week = period(.week)
        month = period(.month)
        lastProductionEventAt = c.optionalDate(Key("last_event_production_at"))
        lastSandboxEventAt = c.optionalDate(Key("last_event_sandbox_at"))
        alertsPaused = (try? c.decodeIfPresent(Bool.self, forKey: Key("paused"))) ?? false
    }
}

extension Array where Element == AppOverview {
    func total(_ period: Period) -> PeriodStats {
        reduce(PeriodStats()) { $0 + $1.stats(period) }
    }
}
