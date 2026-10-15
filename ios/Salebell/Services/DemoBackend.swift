#if DEBUG
import Foundation

/// In-memory backend for screenshots and SwiftUI previews. Launch with
/// `-demo empty` (signed in, no apps), `-demo sample` (signed in, sample data)
/// or `-demo signedOut`.
final class DemoBackend: Backend, @unchecked Sendable {
    enum Mode: String { case empty, sample, signedOut }
    let mode: Mode

    init(mode: Mode) { self.mode = mode }

    static func fromLaunchArguments() -> DemoBackend? {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-demo"), i + 1 < args.count,
              let mode = Mode(rawValue: args[i + 1]) else { return nil }
        return DemoBackend(mode: mode)
    }

    func authStates() -> AsyncStream<AuthState> {
        AsyncStream { c in
            c.yield(mode == .signedOut ? .signedOut : .signedIn(email: "indie@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!))
        }
    }

    func sendCode(to email: String) async throws {}
    func verify(email: String, code: String) async throws {}
    func signIn(email: String, password: String) async throws {}
    func signOut() async {}
    func deleteAccount() async throws {}

    func overview() async throws -> [AppOverview] {
        guard mode == .sample else { return [] }
        return Self.sampleApps
    }

    func apps() async throws -> [AppSummary] {
        try await overview().map { AppSummary(id: $0.id, name: $0.name) }
    }

    func recentEvents(limit: Int) async throws -> [StoreEventRow] {
        guard mode == .sample else { return [] }
        let a = Self.sampleApps[0].id, b = Self.sampleApps[1].id
        let now = Date()
        return [
            .init(appID: a, eventID: UUID(), kind: .purchase, occurredAt: now.addingTimeInterval(-90),
                  productID: "com.example.focus.pro.lifetime", revenue: 14.99, currency: "USD", storefront: "USA"),
            .init(appID: b, eventID: UUID(), kind: .trialStarted, occurredAt: now.addingTimeInterval(-1_100),
                  productID: "com.example.habits.pro.yearly", storefront: "DEU", isTrial: true),
            .init(appID: a, eventID: UUID(), kind: .renewal, occurredAt: now.addingTimeInterval(-3_800),
                  productID: "com.example.focus.pro.monthly", revenue: 3.99, currency: "GBP", storefront: "GBR"),
            .init(appID: b, eventID: UUID(), kind: .refund, occurredAt: now.addingTimeInterval(-9_000),
                  productID: "com.example.habits.pro.monthly", revenue: -4.99, currency: "EUR", storefront: "FRA"),
            .init(appID: a, eventID: UUID(), kind: .test, environment: "Sandbox", occurredAt: now.addingTimeInterval(-20_000)),
        ]
    }

    func liveEvents() -> AsyncStream<StoreEventRow> {
        AsyncStream { _ in }
    }

    func registerPushDevice(token: String, environment: String, appVersion: String) async throws -> UUID { UUID() }
    func unregisterPushDevice(id: UUID) async throws {}
    func sandboxAlerts(deviceID: UUID) async throws -> Bool { false }
    func setSandboxAlerts(_ enabled: Bool, deviceID: UUID) async throws {}
    func sendTestPush(appID: UUID) async throws -> TestPushResult { .init(push: .init(sent: 1, failed: 0)) }

    static let sampleApps: [AppOverview] = [
        AppOverview(
            id: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!, name: "Focus Timer", bundleID: "com.example.focus",
            today: .init(grossUSD: 42.95, purchases: 3, trials: 1, renewals: 2, refunds: 0),
            week: .init(grossUSD: 318.40, purchases: 19, trials: 9, renewals: 14, refunds: 1),
            month: .init(grossUSD: 1_284.12, purchases: 71, trials: 30, renewals: 66, refunds: 3),
            lastProductionEventAt: Date().addingTimeInterval(-90)),
        AppOverview(
            id: UUID(uuidString: "22222222-2222-4222-8222-222222222222")!, name: "Habit Garden", bundleID: "com.example.habits",
            today: .init(grossUSD: 9.99, purchases: 1, trials: 2, renewals: 0, refunds: 1),
            week: .init(grossUSD: 87.20, purchases: 6, trials: 11, renewals: 3, refunds: 1),
            month: .init(grossUSD: 402.75, purchases: 22, trials: 38, renewals: 17, refunds: 2),
            lastProductionEventAt: Date().addingTimeInterval(-1_100)),
    ]
}
#endif
