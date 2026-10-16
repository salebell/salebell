import Foundation
import Testing
@testable import Salebell

@MainActor
struct PushRelayClientTests {
    @Test func enrollmentConfirmsOnlyTheChallengeDeliveredToThisInstallation() async throws {
        let storage = MemoryRelayControlStorage()
        let routes = MemoryNotificationRouteStorage()
        let challengeID = UUID().uuidString.lowercased()
        let challenge = String(repeating: "ce", count: 32)
        var confirmed = false
        let coordinator = PushRelayCoordinator(stateStorage: storage, routeStorage: routes,
            endpoint: URL(string: "https://relay.example.com")!) { request in
                let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
                switch body["action"] as? String {
                case "enroll": return (try JSONSerialization.data(withJSONObject: ["challenge_id": challengeID]), 202)
                case "confirm":
                    #expect(body["challenge"] as? String == challenge)
                    #expect(body["installation_id"] as? String == storage.state?.installationID)
                    confirmed = true
                    return (Data(#"{"enrolled":true}"#.utf8), 200)
                default: return (try JSONSerialization.data(withJSONObject: ["route_id": body["route_id"]!]), 200)
                }
            }
        let registration = Task { try await coordinator.register(configuration: configuration("one.example.com"),
            token: String(repeating: "a", count: 64), environment: "production", userID: UUID()) }
        while storage.state == nil { await Task.yield() }
        let installationID = try #require(storage.state?.installationID)
        #expect(coordinator.receiveEnrollment(["relay_enrollment": ["installation_id": UUID().uuidString,
            "challenge_id": challengeID, "challenge": challenge]]))
        #expect(!confirmed)
        #expect(coordinator.receiveEnrollment(["relay_enrollment": ["installation_id": installationID,
            "challenge_id": challengeID, "challenge": challenge]]))
        _ = try await registration.value
        #expect(confirmed)
        #expect(routes.route != nil)
    }

    @Test func authLossDuringInitialActivationCannotPublishItsRouteKey() async throws {
        let storage = MemoryRelayControlStorage()
        let routes = MemoryNotificationRouteStorage()
        var activationStarted = false
        var release: CheckedContinuation<Void, Never>?
        var actions: [String] = []
        let coordinator = PushRelayCoordinator(stateStorage: storage, routeStorage: routes,
            endpoint: URL(string: "https://relay.example.com")!) { request in
                let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
                let action = body["action"] as! String
                actions.append(action)
                if action == "enroll" { return (Data(#"{"enrolled":true}"#.utf8), 200) }
                if action == "revoke" { return (Data(#"{"revoked":true}"#.utf8), 200) }
                await withCheckedContinuation { release = $0; activationStarted = true }
                return (try JSONSerialization.data(withJSONObject: ["route_id": body["route_id"]!]), 200)
            }
        let registration = Task { try await coordinator.register(configuration: configuration("one.example.com"),
            token: String(repeating: "a", count: 64), environment: "production", userID: UUID()) }
        while !activationStarted { await Task.yield() }
        coordinator.suspend()
        release?.resume()
        await #expect(throws: PushRelayError.self) { try await registration.value }
        #expect(actions == ["enroll", "activate", "revoke"])
        #expect(routes.route == nil)
        #expect(storage.state?.route == nil)
    }

    @Test func switchingBackendRevokesOldCapabilityBeforeActivation() async throws {
        let storage = MemoryRelayControlStorage()
        let routes = MemoryNotificationRouteStorage()
        var actions: [String] = []
        let coordinator = PushRelayCoordinator(stateStorage: storage, routeStorage: routes,
            endpoint: URL(string: "https://relay.example.com")!) { request in
                let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
                actions.append(body["action"] as! String)
                if body["action"] as? String == "enroll" { return (Data(#"{"enrolled":true}"#.utf8), 200) }
                if body["action"] as? String == "revoke" { return (Data(#"{"revoked":true}"#.utf8), 200) }
                return (try JSONSerialization.data(withJSONObject: ["route_id": body["route_id"]!]), 200)
            }
        let first = try configuration("one.example.com")
        let second = try configuration("two.example.com")
        let user = UUID() // Deliberately identical ID across unrelated backends.
        let a = try await coordinator.register(configuration: first, token: String(repeating: "a", count: 64), environment: "production", userID: user)
        let b = try await coordinator.register(configuration: second, token: String(repeating: "a", count: 64), environment: "production", userID: user)
        #expect(a != b)
        #expect(actions == ["enroll", "activate", "revoke", "activate"])
        #expect(storage.state?.revision == 3)
        #expect(storage.state?.route?.backend == second.supabaseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }

    @Test func failedRevocationClearsLocalRouteAndBlocksNewActivation() async throws {
        let storage = MemoryRelayControlStorage()
        let routes = MemoryNotificationRouteStorage()
        var failRevoke = false
        var actions: [String] = []
        let coordinator = PushRelayCoordinator(stateStorage: storage, routeStorage: routes,
            endpoint: URL(string: "https://relay.example.com")!) { request in
                let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
                let action = body["action"] as! String
                actions.append(action)
                if action == "enroll" { return (Data(#"{"enrolled":true}"#.utf8), 200) }
                if action == "revoke" {
                    if failRevoke { throw URLError(.notConnectedToInternet) }
                    return (Data(#"{"revoked":true}"#.utf8), 200)
                }
                return (try JSONSerialization.data(withJSONObject: ["route_id": body["route_id"]!]), 200)
            }
        _ = try await coordinator.register(configuration: configuration("one.example.com"), token: String(repeating: "a", count: 64), environment: "production", userID: UUID())
        failRevoke = true
        await #expect(throws: (any Error).self) {
            try await coordinator.register(configuration: configuration("two.example.com"), token: String(repeating: "a", count: 64), environment: "production", userID: UUID())
        }
        #expect(routes.route == nil)
        #expect(actions == ["enroll", "activate", "revoke"])
        #expect(storage.state?.pending?.action == "revoke")
    }

    @Test func pendingRevocationSurvivesCoordinatorRelaunch() async throws {
        let storage = MemoryRelayControlStorage()
        var state = RelayControlState(installationID: UUID().uuidString.lowercased(), controlSecret: String(repeating: "b", count: 64))
        state.revision = 4
        state.enrolledToken = String(repeating: "a", count: 64)
        state.enrolledEnvironment = "production"
        state.pending = RelayPendingOperation(action: "revoke", revision: 4)
        storage.state = state
        var revisions: [Int] = []
        let coordinator = PushRelayCoordinator(stateStorage: storage, routeStorage: MemoryNotificationRouteStorage(),
            endpoint: URL(string: "https://relay.example.com")!) { request in
                let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
                revisions.append(body["revision"] as! Int)
                if body["action"] as? String == "revoke" { return (Data(#"{"revoked":true}"#.utf8), 200) }
                return (try JSONSerialization.data(withJSONObject: ["route_id": body["route_id"]!]), 200)
            }
        _ = try await coordinator.register(configuration: configuration("two.example.com"), token: String(repeating: "a", count: 64), environment: "production", userID: UUID())
        #expect(revisions == [4, 5])
    }

    private func configuration(_ host: String) throws -> ServerConfiguration {
        try ServerConfiguration(siteURL: URL(string: "https://\(host)")!, supabaseURL: URL(string: "https://api.\(host)")!, supabaseKey: "sb_publishable_test_key")
    }
}

@MainActor
final class MemoryRelayControlStorage: RelayControlStorage {
    var state: RelayControlState?
    func load() throws -> RelayControlState? { state }
    func save(_ state: RelayControlState) throws { self.state = state }
}

final class MemoryNotificationRouteStorage: NotificationRouteStorage {
    var route: ActiveNotificationRoute?
    func read() throws -> ActiveNotificationRoute? { route }
    func write(_ route: ActiveNotificationRoute) throws { self.route = route }
    func clear() throws { route = nil }
}
