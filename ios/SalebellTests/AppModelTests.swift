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
    @Test func switchingUsersOnSameServerInvalidatesWidgetSnapshot() async {
        let backend = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ServerConfigurationStore(defaults: defaults)
        store.save(configuration: .cloud, signedIn: true)
        let before = store.selection.generation
        let first = UUID()
        let second = UUID()
        let model = AppModel(backend: backend, defaults: defaults,
                             authState: .signedIn(email: "first@example.com", userID: first), notificationPermission: .unknown,
                             configurationStore: store)
        let observer = Task { await model.start() }
        backend.states.continuation.yield(.signedIn(email: "second@example.com", userID: second))
        while model.authState.accountID != second.uuidString { await Task.yield() }
        #expect(store.selection.signedIn)
        #expect(store.selection.generation != before)
        observer.cancel()
        await observer.value
    }

    @Test func failedCustomerBackendRemovalDoesNotBlockSignOutAfterCentralRevocation() async {
        let backend = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let model = AppModel(backend: backend, defaults: defaults,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        await backend.failRemoval()
        do { try await model.signOut() } catch {}
        #expect(model.email == nil)
        #expect(model.pushDeviceID == nil)
        #expect(await backend.deliveryStopped)
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

    @Test func failedCentralRevocationCanBeRetried() async throws {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!), notificationPermission: .allowed)
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        await backend.failRevocation()
        do { try await model.signOut() } catch {}
        #expect(model.email == "a@example.com")
        #expect(model.pushDeviceID != nil)
        await backend.allowRevocation()
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
    @Test func switchingServersClearsSessionEvenWhenOldDeviceRemovalIsOffline() async throws {
        let backend = PushBackend()
        let next = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ServerConfigurationStore(defaults: defaults)
        let owner = AuthState.signedIn(email: "a@example.com", userID: UUID())
        let original = try ServerConfiguration(siteURL: URL(string: "https://first.example.com")!, supabaseURL: URL(string: "https://api-first.example.com")!, supabaseKey: "sb_publishable_first")
        let selected = try ServerConfiguration(siteURL: URL(string: "https://second.example.com")!, supabaseURL: URL(string: "https://api-second.example.com")!, supabaseKey: "sb_publishable_second")
        store.save(configuration: original, signedIn: true)
        let model = AppModel(backend: backend, defaults: defaults, authState: owner, notificationPermission: .allowed,
                             configuration: original, configurationStore: store, backendFactory: { _ in next })
        await model.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        let oldObserver = Task { await model.start() }
        let generation = model.backendGeneration
        await backend.failRemoval()
        try await model.switchServer(to: selected)
        #expect(await backend.deliveryStopped)
        #expect(model.configuration == selected)
        #expect(model.backendGeneration != generation)
        #expect(model.authState == .loading)
        #expect(!store.selection.signedIn)
        #expect(model.pushDeviceID == nil)

        // The old stream cannot sign the new backend into the same UUID.
        let observer = Task { await model.start() }
        backend.states.continuation.yield(owner)
        next.states.continuation.yield(.signedOut)
        while model.authState == .loading { await Task.yield() }
        #expect(model.email == nil)
        observer.cancel()
        oldObserver.cancel()
        await observer.value
        await oldObserver.value
    }

    @Test func failedCentralRevocationKeepsSelectedServerAndSession() async throws {
        let backend = PushBackend()
        let model = AppModel(backend: backend, defaults: UserDefaults(suiteName: UUID().uuidString)!,
                             authState: .signedIn(email: "a@example.com", userID: UUID()), notificationPermission: .allowed)
        let original = model.configuration
        let generation = model.backendGeneration
        let selected = try ServerConfiguration(siteURL: URL(string: "https://other.example.com")!, supabaseURL: URL(string: "https://api-other.example.com")!, supabaseKey: "sb_publishable_other")
        await backend.failRevocation()
        do { try await model.switchServer(to: selected); Issue.record("Switch should fail") } catch {}
        #expect(model.configuration == original)
        #expect(model.backendGeneration == generation)
        #expect(model.email == "a@example.com")
    }

    @Test func expiredSessionAtLaunchRevokesDeliveryAndHidesWidgetData() async {
        let backend = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ServerConfigurationStore(defaults: defaults)
        store.save(configuration: .cloud, signedIn: true)
        let previous = store.selection
        let model = AppModel(backend: backend, defaults: defaults, authState: .loading, notificationPermission: .allowed,
                             configurationStore: store)
        let observer = Task { await model.start() }
        backend.states.continuation.yield(.signedOut)
        while !(await backend.deliveryStopped) { await Task.yield() }
        #expect(model.authState == .signedOut)
        #expect(!store.selection.signedIn)
        #expect(store.selection.generation != previous.generation)
        observer.cancel()
        await observer.value
    }

    @Test func sameUserOnDifferentOriginsDoesNotRestoreOtherServerDevices() async throws {
        let backend = PushBackend()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let owner = AuthState.signedIn(email: "a@example.com", userID: UUID())
        let first = try ServerConfiguration(siteURL: URL(string: "https://first.example.com")!, supabaseURL: URL(string: "https://api-first.example.com")!, supabaseKey: "sb_publishable_first")
        let second = try ServerConfiguration(siteURL: URL(string: "https://second.example.com")!, supabaseURL: URL(string: "https://api-second.example.com")!, supabaseKey: "sb_publishable_second")
        let original = AppModel(backend: backend, defaults: defaults, authState: owner, notificationPermission: .allowed, configuration: first)
        await original.didReceiveDeviceToken(Data(repeating: 1, count: 32))
        let originalID = try #require(original.pushDeviceID)
        let other = AppModel(backend: backend, defaults: defaults, authState: owner, notificationPermission: .allowed, configuration: second)
        try await other.signOut()
        #expect(await backend.activeDevices.contains(originalID))
    }

}

private actor PushBackend: Backend {
    enum Failure: Error { case offline }
    nonisolated let states = AsyncStream<AuthState>.makeStream()
    private var ids: [String: UUID] = [:]
    var activeDevices: Set<UUID> = []
    private var removalFails = false
    private var revocationFails = false
    var deliveryStopped = false
    func failRevocation() { revocationFails = true }
    func allowRevocation() { revocationFails = false }
    func stopPushDelivery() async throws {
        if revocationFails { throw Failure.offline }
        deliveryStopped = true
    }
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
