import Foundation

enum AuthState: Equatable, Sendable {
    case loading
    case signedOut
    case signedIn(email: String, userID: UUID)

    var accountID: String? {
        if case .signedIn(_, let userID) = self {
            return userID.uuidString
        }
        return nil
    }
}

struct AppSummary: Identifiable, Equatable, Sendable, Decodable {
    let id: UUID
    let name: String
}

/// Everything the app needs from the server. `SupabaseBackend` is the real one;
/// `DemoBackend` (Debug builds only) drives screenshots and previews.
protocol Backend: Sendable {
    func authStates() -> AsyncStream<AuthState>
    func sendCode(to email: String) async throws
    func verify(email: String, code: String) async throws
    /// Email + password sign-in, used by the App Review demo account.
    func signIn(email: String, password: String) async throws
    func signOut() async throws
    func deleteAccount() async throws

    func overview() async throws -> [AppOverview]
    func apps() async throws -> [AppSummary]
    func recentEvents(limit: Int) async throws -> [StoreEventRow]
    /// New `store_events` rows as they are inserted. Ends when the consuming task is cancelled.
    func liveEvents() -> AsyncStream<StoreEventRow>

    func registerPushDevice(token: String, environment: String, appVersion: String) async throws -> UUID
    func unregisterPushDevice(id: UUID) async throws
    func sandboxAlerts(deviceID: UUID) async throws -> Bool
    func setSandboxAlerts(_ enabled: Bool, deviceID: UUID) async throws

    /// Sends a synthetic "test" alert to the caller's own iPhones (test-alert, target "push").
    func sendTestPush(appID: UUID) async throws -> TestPushResult
}

struct TestPushResult: Equatable, Sendable, Decodable {
    struct Push: Equatable, Sendable, Decodable {
        var sent: Int
        var failed: Int
        var error: String?
    }
    var push: Push

    /// What Settings shows after a test.
    var summary: String {
        if push.error == "push_not_configured" { return "Push isn't set up on the server yet." }
        if push.sent > 0 {
            return push.sent == 1 ? "Sent to 1 iPhone. It should ring in a few seconds."
                                  : "Sent to \(push.sent) iPhones. They should ring in a few seconds."
        }
        if push.failed > 0 { return "Apple didn't accept the test. Turn notifications off and on, then try again." }
        return "No iPhone is registered yet. Turn on notifications first."
    }
}

enum TestPushError: LocalizedError, Equatable {
    case rateLimited(retryAfter: Int)
    case failed

    var errorDescription: String? {
        switch self {
        case .rateLimited(let seconds): "Too many tests. Try again in \(seconds) seconds."
        case .failed: "The test couldn't be sent. Try again in a moment."
        }
    }

    /// Maps the test-alert function's error response (`429 {error:"rate_limited", retry_after}`).
    static func from(status: Int, body: Data) -> TestPushError {
        struct Body: Decodable { let error: String?; let retry_after: Int? }
        let decoded = try? JSONDecoder().decode(Body.self, from: body)
        if status == 429 || decoded?.error == "rate_limited" {
            return .rateLimited(retryAfter: max(1, decoded?.retry_after ?? 60))
        }
        return .failed
    }
}
