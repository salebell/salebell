import Foundation
import Testing
@testable import Salebell

struct DecodingTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test func overviewRowDecodesNumbersAndStrings() throws {
        let rows = try decode([AppOverview].self, """
        [{
          "app_id": "11111111-1111-4111-8111-111111111111",
          "account_id": "22222222-2222-4222-8222-222222222222",
          "name": "Focus Timer", "bundle_id": "com.example.focus",
          "gross_usd_today": 12.5, "gross_usd_7d": "99.990", "gross_usd_30d": null,
          "purchases_today": 2, "purchases_7d": 9, "purchases_30d": 31,
          "trials_today": 1, "renewals_7d": 4, "refunds_30d": 2,
          "last_event_production_at": "2026-10-08T12:34:56.123456+00:00",
          "last_event_sandbox_at": null, "paused": true, "enabled": true, "apple_app_id": null
        }]
        """)
        let app = try #require(rows.first)
        #expect(app.name == "Focus Timer")
        #expect(app.bundleID == "com.example.focus")
        #expect(app.today.grossUSD == 12.5)
        #expect(app.week.grossUSD == 99.99)
        #expect(app.month.grossUSD == 0)
        #expect(app.today.purchases == 2)
        #expect(app.today.trials == 1)
        #expect(app.week.renewals == 4)
        #expect(app.month.refunds == 2)
        #expect(app.week.trials == 0) // missing column → 0
        #expect(app.lastProductionEventAt != nil)
        #expect(app.lastSandboxEventAt == nil)
        #expect(app.alertsPaused)
    }

    @Test func overviewTotalsSumAcrossApps() {
        let a = AppOverview(id: UUID(), name: "A", bundleID: "a", today: .init(grossUSD: 10, purchases: 1, refunds: 1))
        let b = AppOverview(id: UUID(), name: "B", bundleID: "b", today: .init(grossUSD: 2.5, purchases: 3, trials: 2))
        let total = [a, b].total(.today)
        #expect(total == PeriodStats(grossUSD: 12.5, purchases: 4, trials: 2, renewals: 0, refunds: 1))
        #expect([AppOverview]().total(.month) == PeriodStats())
    }

    @Test func storeEventDecodesPostgrestRow() throws {
        let row = try decode(StoreEventRow.self, """
        {"app_id":"11111111-1111-4111-8111-111111111111","id":"33333333-3333-4333-8333-333333333333",
         "environment":"Production","type":"renewal","occurred_at":"2026-10-08T09:00:00.5+00:00",
         "product_id":"com.example.focus.pro.monthly","revenue":3.99,"currency":"GBP","storefront":"GBR","is_trial":false}
        """)
        #expect(row.kind == .renewal)
        #expect(!row.isSandbox)
        #expect(row.revenue == 3.99)
        #expect(row.detail == "Renewal · pro.monthly · GBR")
        #expect(row.occurredAt == Date(timeIntervalSince1970: 1_791_450_000.5))
    }

    @Test func storeEventDecodesRealtimeRecord() throws {
        // Realtime records may carry numeric as a string and a space-separated timestamp.
        let row = try decode(StoreEventRow.self, """
        {"app_id":"11111111-1111-4111-8111-111111111111","id":"44444444-4444-4444-8444-444444444444",
         "environment":"Sandbox","type":"refund","occurred_at":"2026-10-08 09:00:00+00",
         "product_id":null,"revenue":"-4.990","currency":"EUR","storefront":null,"is_trial":false,
         "payload":{"ignored":true}}
        """)
        #expect(row.kind == .refund)
        #expect(row.isSandbox)
        #expect(row.revenue == -4.99)
        #expect(row.detail == "Refund")
        #expect(row.occurredAt == Date(timeIntervalSince1970: 1_791_450_000))
    }

    @Test func unknownEventTypeFallsBackToOther() throws {
        let row = try decode(StoreEventRow.self, """
        {"app_id":"11111111-1111-4111-8111-111111111111","id":"55555555-5555-4555-8555-555555555555",
         "type":"something_new","occurred_at":"2026-10-08T09:00:00Z"}
        """)
        #expect(row.kind == .other)
        #expect(row.detail == "Store event")
        #expect(row.formattedAmount == nil)
    }

    @Test func trialSuffixMatchesPushFormat() {
        let renewalInTrial = StoreEventRow(appID: UUID(), eventID: UUID(), kind: .purchase, occurredAt: .now,
                                           productID: "a.b.c.yearly", storefront: "USA", isTrial: true)
        #expect(renewalInTrial.detail == "Purchase (trial) · c.yearly · USA")
        let trialStart = StoreEventRow(appID: UUID(), eventID: UUID(), kind: .trialStarted, occurredAt: .now, isTrial: true)
        #expect(trialStart.detail == "Trial started")
    }

    @Test(arguments: [
        ("2026-10-08T09:00:00Z", 1_791_450_000.0),
        ("2026-10-08T09:00:00+00:00", 1_791_450_000.0),
        ("2026-10-08T10:00:00+01:00", 1_791_450_000.0),
        ("2026-10-08T04:00:00-05:00", 1_791_450_000.0),
        ("2026-10-08T09:00:00.123456+00:00", 1_791_450_000.123),
        ("2026-10-08 09:00:00.1+00", 1_791_450_000.1),
    ])
    func postgresTimestamps(input: String, expected: Double) throws {
        let date = try #require(PostgresValue.date(from: input))
        #expect(abs(date.timeIntervalSince1970 - expected) < 0.0005)
    }
}
