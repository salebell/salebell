import Foundation
import Testing
@testable import Salebell

@MainActor
struct AppModelTests {
    /// What the notification delegate calls when a sale alert is tapped.
    @Test func tappingANotificationOpensTheFeed() {
        let model = AppModel()
        model.selectedTab = .overview
        let before = model.refreshTick
        model.openFeedFromNotification()
        #expect(model.selectedTab == .feed)
        #expect(model.refreshTick == before + 1)
    }

    @Test func notificationSetupWaitsForAnAppAndResumesAfterRefresh() {
        let defaults = isolatedDefaults()
        let model = makeModel(defaults: defaults)
        model.didLoadApps(hasApps: false)
        #expect(!model.showPushExplainer)

        // The user adds their first app on the website and returns to this phone.
        model.didLoadApps(hasApps: true)
        #expect(model.showPushExplainer)
    }

    @Test func skippingNotificationsPersistsAcrossRefreshAndRelaunch() {
        let defaults = isolatedDefaults()
        let model = makeModel(defaults: defaults)
        model.didLoadApps(hasApps: true)
        model.dismissPushExplainer()
        model.didLoadApps(hasApps: true)
        #expect(!model.showPushExplainer)

        let relaunched = makeModel(defaults: defaults)
        relaunched.didLoadApps(hasApps: true)
        #expect(!relaunched.showPushExplainer)
    }

    @Test(arguments: [NotificationPermission.allowed, .denied, .unknown])
    func onlyUndecidedPermissionsShowTheExplainer(permission: NotificationPermission) {
        let model = makeModel(defaults: isolatedDefaults(), permission: permission)
        model.didLoadApps(hasApps: true)
        #expect(!model.showPushExplainer)
    }

    private func makeModel(defaults: UserDefaults,
                           permission: NotificationPermission = .notDetermined) -> AppModel {
        AppModel(backend: DemoBackend(mode: .empty), defaults: defaults,
                 authState: .signedIn(email: "indie@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: permission)
    }

    private func isolatedDefaults() -> UserDefaults {
        // A fresh suite avoids changing the real app's permission onboarding state.
        UserDefaults(suiteName: "AppModelTests.\(UUID().uuidString)")!
    }
}

@MainActor
struct PushLifecycleTests {
    @Test func failedUnregisterKeepsAccountAndDeviceForRetry() async {
        let backend = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let model = AppModel(backend: backend, defaults: defaults,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        let registeredID = model.pushDeviceID
        await backend.failRemoval()
        do { try await model.signOut() } catch {}
        #expect(model.email == "a@example.com")
        #expect(model.pushDeviceID == registeredID)
    }

    @Test func legacyDeviceIsRemovedWhenSigningOutBeforeTokenArrives() async throws {
        let backend = PushBackend()
        let owner = AuthState.signedIn(email: "a@example.com", userID: UUID())
        let original = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                                authState: owner, notificationPermission: .allowed)
        await original.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        let id = try #require(original.pushDeviceID)
        let legacyDefaults = UserDefaults(suiteName: UUID().uuidString)!
        legacyDefaults.set(id.uuidString, forKey: "pushDeviceID")
        let relaunched = AppModel(backend: backend, defaults: legacyDefaults,
                                  authState: owner, notificationPermission: .allowed)
        #expect(relaunched.pushDeviceID == nil)
        try await relaunched.signOut()
        #expect(await backend.activeDevices.isEmpty)
    }

    @Test func failedRemovalCanBeRetried() async throws {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        await backend.failRemoval()
        do { try await model.signOut() } catch {}
        await backend.allowRemoval()
        try await model.signOut()
        #expect(model.email == nil)
        #expect(model.pushDeviceID == nil)
        #expect(await backend.activeDevices.isEmpty)
    }

    @Test func rotatedTokenRemovesObsoleteDevice() async {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        let first = model.pushDeviceID
        await model.didReceiveDeviceToken(Data(repeating: 2, count: 32))
        #expect(model.pushDeviceID != first)
        #expect(await backend.activeDevices.count == 1)
    }

    @Test func lateRegistrationCannotRestoreDeviceAfterAuthSignsOut() async {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await backend.pauseRegistration()
        let registration = Task { await model.didReceiveDeviceToken(Data(repeating: 1, count: 32)) }
        await backend.waitForRegistration()
        let observer = Task { await model.start() }
        backend.states.continuation.yield(.signedOut)
        while model.email != nil { await Task.yield() }
        await backend.finishRegistration()
        await registration.value
        #expect(model.pushDeviceID == nil)
        observer.cancel()
        await observer.value
    }

    @Test func signOutWaitsForRegistrationThenRemovesIt() async {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await backend.pauseRegistration()
        let registration = Task { await model.didReceiveDeviceToken(Data(repeating: 1, count: 32)) }
        await backend.waitForRegistration()
        let signOut = Task { try await model.signOut() }
        // Allow sign-out to reach its first suspension before releasing the request.
        while !model.isEndingSession { await Task.yield() }
        await backend.finishRegistration()
        await registration.value
        do { try await signOut.value } catch { Issue.record("Sign-out failed: \(error)") }
        #expect(model.email == nil)
        #expect(model.pushDeviceID == nil)
        #expect(await backend.activeDevices.isEmpty)
    }
}

private actor PushBackend: Backend {
    enum Failure: Error { case offline }
    nonisolated let states = AsyncStream<AuthState>.makeStream()
    private var ids: [String: UUID] = [:]
    var activeDevices: Set<UUID> = []
    private var removalFails = false
    private var paused = false
    private var gate: CheckedContinuation<Void, Never>?
    private var started = false
    private var startedWaiter: CheckedContinuation<Void, Never>?
    func pauseRegistration() { paused = true }
    func failRemoval() { removalFails = true }
    func allowRemoval() { removalFails = false }
    func waitForRegistration() async {
        if started { return }
        await withCheckedContinuation { startedWaiter = $0 }
    }
    func finishRegistration() { gate?.resume(); gate = nil }
    func registerPushDevice(token: String, environment: String, appVersion: String) async throws -> UUID {
        if paused {
            await withCheckedContinuation {
                gate = $0
                started = true
                startedWaiter?.resume()
                startedWaiter = nil
            }
            paused = false
        }
        let id = ids[token] ?? UUID()
        ids[token] = id
        activeDevices.insert(id)
        return id
    }
    func unregisterPushDevice(id: UUID) async throws {
        if removalFails { throw Failure.offline }
        activeDevices.remove(id)
    }
    nonisolated func authStates() -> AsyncStream<AuthState> { states.stream }
    func sendCode(to email: String) async throws {}
    func verify(email: String, code: String) async throws {}
    func signIn(email: String, password: String) async throws {}
    func signOut() async {}
    func deleteAccount() async throws {}
    func overview() async throws -> [AppOverview] { [] }
    func apps() async throws -> [AppSummary] { [] }
    func recentEvents(limit: Int) async throws -> [StoreEventRow] { [] }
    nonisolated func liveEvents() -> AsyncStream<StoreEventRow> { AsyncStream { $0.finish() } }
    func sandboxAlerts(deviceID: UUID) async throws -> Bool { false }
    func setSandboxAlerts(_ enabled: Bool, deviceID: UUID) async throws {}
    func sendTestPush(appID: UUID) async throws -> TestPushResult { .init(push: .init(sent: 0, failed: 0)) }
}
