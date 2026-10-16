import Foundation
import Security

struct RelayRoute: Codable, Equatable, Sendable {
    let backend: String
    let userID: UUID
    let id: String
    let capability: String
    let contentKey: String
}

struct RelayPendingOperation: Codable, Equatable, Sendable {
    let action: String
    let revision: Int
}

struct RelayControlState: Codable, Sendable {
    let installationID: String
    let controlSecret: String
    var revision = 0
    var enrolledToken: String?
    var enrolledEnvironment: String?
    var route: RelayRoute?
    var pending: RelayPendingOperation?
    var suspended = true
}

@MainActor
protocol RelayControlStorage {
    func load() throws -> RelayControlState?
    func save(_ state: RelayControlState) throws
}

@MainActor
struct KeychainRelayControlStorage: RelayControlStorage {
    private let keychain = RelayKeychain(service: "com.salebell.relay.control")
    func load() throws -> RelayControlState? {
        guard let data = try keychain.read() else { return nil }
        return try JSONDecoder().decode(RelayControlState.self, from: data)
    }
    func save(_ state: RelayControlState) throws { try keychain.write(JSONEncoder().encode(state)) }
}

enum PushRelayError: LocalizedError {
    case unavailable, invalidResponse, enrollmentTimedOut
    var errorDescription: String? {
        switch self {
        case .unavailable: "Salebell notification delivery is unavailable. Check your connection and retry notification setup."
        case .invalidResponse: "Notification setup couldn't be verified. Please retry."
        case .enrollmentTimedOut: "Your iPhone's notification check didn't arrive. Keep Salebell open and retry notification setup."
        }
    }
}

@MainActor
final class PushRelayClient {
    private static let coordinator = PushRelayCoordinator(stateStorage: KeychainRelayControlStorage(),
        routeStorage: KeychainNotificationRouteStorage(), endpoint: AppConfig.pushRelayURL)
    private let configuration: ServerConfiguration

    init(configuration: ServerConfiguration) { self.configuration = configuration }

    func register(token: String, environment: String, userID: UUID) async throws -> String {
        try await Self.coordinator.register(configuration: configuration, token: token, environment: environment, userID: userID)
    }

    func revoke() async throws { try await Self.coordinator.revoke() }
    func handleEnrollment(_ userInfo: [AnyHashable: Any]) async -> Bool { Self.coordinator.receiveEnrollment(userInfo) }
    func accepts(_ userInfo: [AnyHashable: Any]) -> Bool { Self.acceptsNotification(userInfo) }

    static func handleEnrollmentNotification(_ info: [AnyHashable: Any]) -> Bool { coordinator.receiveEnrollment(info) }
    static func acceptsNotification(_ info: [AnyHashable: Any]) -> Bool {
        NotificationPrivacy.accepts(info, route: try? KeychainNotificationRouteStorage().read())
    }

    /// Clear sensitive extension content immediately, including on automatic Auth loss.
    /// Pending revocation is durable and must complete before a new route is registered.
    static func suspendDelivery() { coordinator.suspend() }
}

@MainActor
final class PushRelayCoordinator {
    typealias Sender = @MainActor (URLRequest) async throws -> (Data, Int)
    private let stateStorage: any RelayControlStorage
    private let routeStorage: any NotificationRouteStorage
    private let endpoint: URL
    private let send: Sender
    private var operation: Task<String?, Error>?
    private var enrolling = false
    private var suspensionGeneration = 0
    private var challenges: [String: String] = [:]
    private let enrollmentTimeout: Duration

    init(stateStorage: any RelayControlStorage, routeStorage: any NotificationRouteStorage, endpoint: URL,
         enrollmentTimeout: Duration = .seconds(25), send: Sender? = nil) {
        self.stateStorage = stateStorage
        self.routeStorage = routeStorage
        self.endpoint = endpoint
        self.enrollmentTimeout = enrollmentTimeout
        self.send = send ?? { request in
            let (data, response) = try await RelayHTTPSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw PushRelayError.invalidResponse }
            return (data, response.statusCode)
        }
    }

    func register(configuration: ServerConfiguration, token: String, environment: String, userID: UUID) async throws -> String {
        while let running = operation { _ = try? await running.value; await Task.yield() }
        let task = Task<String?, Error> { try await self.performRegister(configuration: configuration, token: token, environment: environment, userID: userID) }
        operation = task
        defer { operation = nil }
        guard let capability = try await task.value else { throw PushRelayError.invalidResponse }
        return capability
    }

    func revoke() async throws {
        // Stop extension decryption before waiting for any network write to finish.
        try routeStorage.clear()
        while let running = operation { _ = try? await running.value; await Task.yield() }
        let task = Task<String?, Error> { try await self.performRevoke(); return nil }
        operation = task
        defer { operation = nil }
        _ = try await task.value
    }

    func suspend() {
        suspensionGeneration += 1
        try? routeStorage.clear()
        guard var state = try? stateStorage.load() else { return }
        state.suspended = true
        try? stateStorage.save(state)
    }

    func receiveEnrollment(_ info: [AnyHashable: Any]) -> Bool {
        guard let fields = info["relay_enrollment"] as? [String: String] else { return false }
        // Consume even unrelated enrollment notifications so they never present a sale banner.
        guard enrolling, let state = try? stateStorage.load(),
              fields["installation_id"] == state.installationID,
              let id = fields["challenge_id"], UUID(uuidString: id) != nil,
              let challenge = fields["challenge"], Data(hexString: challenge)?.count == 32 else { return true }
        if challenges.count < 8 { challenges[id] = challenge }
        return true
    }

    private func state() throws -> RelayControlState {
        if let existing = try stateStorage.load() { return existing }
        let fresh = RelayControlState(installationID: UUID().uuidString.lowercased(), controlSecret: try randomSecret())
        try stateStorage.save(fresh)
        return fresh
    }

    private func performRegister(configuration: ServerConfiguration, token: String, environment: String, userID: UUID) async throws -> String {
        let startedBeforeSuspension = suspensionGeneration
        guard (64...200).contains(token.count), Data(hexString: token) != nil,
              ["sandbox", "production"].contains(environment) else { throw PushRelayError.invalidResponse }
        var current = try state()
        let backend = configuration.supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if current.pending != nil || current.suspended && current.route != nil ||
            current.route.map({ $0.backend != backend || $0.userID != userID }) == true ||
            current.enrolledToken != nil && (current.enrolledToken != token || current.enrolledEnvironment != environment) {
            try await performRevoke()
            current = try state()
        }
        if current.enrolledToken != token || current.enrolledEnvironment != environment {
            try await enroll(token: token, environment: environment)
            current = try state()
        }
        guard startedBeforeSuspension == suspensionGeneration else {
            try await performRevoke()
            throw PushRelayError.unavailable
        }
        let route = try current.route ?? RelayRoute(backend: backend, userID: userID, id: UUID().uuidString.lowercased(),
                                                   capability: randomSecret(), contentKey: randomSecret())
        guard current.revision < 9_007_199_254_740_990 else { throw PushRelayError.invalidResponse }
        current.revision += 1
        current.route = route
        current.pending = RelayPendingOperation(action: "activate", revision: current.revision)
        try stateStorage.save(current) // Persist ordering BEFORE the server can commit.
        let reply = try await request(credentials(current, action: "activate").merging([
            "revision": current.revision, "backend": backend, "user_id": userID.uuidString.lowercased(),
            "route_id": route.id, "capability": route.capability, "content_key": route.contentKey,
        ], uniquingKeysWith: { _, new in new }))
        guard reply["route_id"] as? String == route.id else { throw PushRelayError.invalidResponse }
        // A signed-out event can suspend while activation is in flight. Do not publish its key.
        if startedBeforeSuspension != suspensionGeneration {
            try await performRevoke()
            throw PushRelayError.unavailable
        }
        current.pending = nil
        current.suspended = false
        try stateStorage.save(current)
        try routeStorage.write(ActiveNotificationRoute(id: route.id, contentKey: route.contentKey))
        return route.capability
    }

    private func performRevoke() async throws {
        try routeStorage.clear()
        var current = try state()
        current.suspended = true
        guard current.enrolledToken != nil || current.route != nil || current.pending != nil else {
            try stateStorage.save(current)
            return
        }
        if current.pending?.action != "revoke" {
            guard current.revision < 9_007_199_254_740_990 else { throw PushRelayError.invalidResponse }
            current.revision += 1
            current.pending = RelayPendingOperation(action: "revoke", revision: current.revision)
        }
        try stateStorage.save(current)
        let reply = try await request(credentials(current, action: "revoke").merging(["revision": current.revision], uniquingKeysWith: { _, new in new }))
        guard reply["revoked"] as? Bool == true else { throw PushRelayError.invalidResponse }
        current.route = nil
        current.pending = nil
        try stateStorage.save(current)
    }

    private func enroll(token: String, environment: String) async throws {
        enrolling = true
        challenges.removeAll()
        defer { enrolling = false; challenges.removeAll() }
        var current = try state()
        let reply = try await request(credentials(current, action: "enroll").merging(["token": token, "environment": environment], uniquingKeysWith: { _, new in new }))
        if reply["enrolled"] as? Bool != true {
            guard let id = reply["challenge_id"] as? String, UUID(uuidString: id) != nil else { throw PushRelayError.invalidResponse }
            let deadline = ContinuousClock.now.advanced(by: enrollmentTimeout)
            while challenges[id] == nil && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(100)) }
            guard let challenge = challenges[id] else { throw PushRelayError.enrollmentTimedOut }
            let confirmed = try await request(credentials(current, action: "confirm").merging(["challenge_id": id, "challenge": challenge], uniquingKeysWith: { _, new in new }))
            guard confirmed["enrolled"] as? Bool == true else { throw PushRelayError.invalidResponse }
        }
        current.enrolledToken = token
        current.enrolledEnvironment = environment
        try stateStorage.save(current)
    }

    private func credentials(_ state: RelayControlState, action: String) -> [String: Any] {
        ["action": action, "installation_id": state.installationID, "control_secret": state.controlSecret]
    }

    private func request(_ body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 20
        let (data, status) = try await send(request)
        guard (200..<300).contains(status), data.count <= 8192 else { throw PushRelayError.unavailable }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw PushRelayError.invalidResponse }
        return result
    }

    private func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw RelayKeychainError.unavailable }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}

private final class RelayRedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil) // Never redirect installation credentials to another endpoint.
    }
}

private enum RelayHTTPSession {
    static let shared = URLSession(configuration: .ephemeral, delegate: RelayRedirectGuard(), delegateQueue: nil)
}
