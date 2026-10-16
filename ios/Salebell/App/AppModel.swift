import OSLog
import Observation
import SwiftUI
import UserNotifications
import WidgetKit

enum AppTab: Hashable {
    case overview, feed, settings
}

enum NotificationPermission: Equatable {
    case unknown, notDetermined, denied, allowed
}

@MainActor
@Observable
final class AppModel {
    private(set) var backend: any Backend
    private(set) var configuration: ServerConfiguration
    private(set) var backendGeneration = UUID()
    private let configurationStore: ServerConfigurationStore
    private let backendFactory: @Sendable (ServerConfiguration) -> any Backend
    let isDemo: Bool

    private(set) var authState: AuthState = .loading
    var selectedTab: AppTab = .overview
    /// Bumped when something suggests new data (foreground push, app became active).
    private(set) var refreshTick = 0

    private(set) var notificationPermission: NotificationPermission = .unknown
    var showPushExplainer = false
    private(set) var pushDeviceID: UUID?

    private var deviceToken: String?
    private var hasApps = false
    private(set) var isEndingSession = false
    private var registrationTask: Task<Void, Never>?
    private var authUpdateTask: Task<Void, Never>?
    private var observingGeneration: UUID?
    private var authCleanupTask: Task<Bool, Never>?
    private(set) var authGeneration = 0
    private var deviceIDs: Set<UUID> = []
    private static let logger = Logger(subsystem: "com.salebell", category: "Push")
    private let defaults: UserDefaults
    private static let deviceIDKey = "pushDeviceID"
    private static let explainerShownKey = "pushExplainerShown"

    init() {
        defaults = .standard
        let store = ServerConfigurationStore()
        configurationStore = store
        let initialConfiguration = store.selection.configuration
        configuration = initialConfiguration
        backendFactory = { SupabaseBackend(configuration: $0) }
        #if DEBUG
        if let demo = DemoBackend.fromLaunchArguments() {
            backend = demo
            isDemo = true
            return
        }
        #endif
        backend = SupabaseBackend(configuration: initialConfiguration)
        isDemo = false
    }

    /// Seed the model for previews and tests without contacting Auth or iOS permissions.
    init(backend: any Backend, defaults: UserDefaults, authState: AuthState,
         notificationPermission: NotificationPermission, configuration: ServerConfiguration = .cloud,
         configurationStore: ServerConfigurationStore? = nil,
         backendFactory: @escaping @Sendable (ServerConfiguration) -> any Backend = { SupabaseBackend(configuration: $0) }) {
        self.backend = backend
        self.configuration = configuration
        self.configurationStore = configurationStore ?? ServerConfigurationStore(defaults: defaults)
        self.backendFactory = backendFactory
        self.defaults = defaults
        self.authState = authState
        self.notificationPermission = notificationPermission
        isDemo = false
        restoreDevices()
    }

    var email: String? {
        if case .signedIn(let email, _) = authState { email } else { nil }
    }

    func start() async {
        let generation = backendGeneration
        guard observingGeneration != generation else { return }
        observingGeneration = generation
        let observedBackend = backend
        defer {
            if observingGeneration == generation { observingGeneration = nil }
        }
        for await state in observedBackend.authStates() {
            guard !Task.isCancelled, generation == backendGeneration else { break }
            let previousOwner = authState.accountID
            let changedAccount = previousOwner != state.accountID
            let initialSignedOut = authState == .loading && state == .signedOut
            authState = state
            if changedAccount || initialSignedOut {
                authGeneration += 1
                hasApps = false
                showPushExplainer = false
                restoreDevices()
                authUpdateTask?.cancel()
                // A -> B is still signed in, but an old widget fetch must become invalid.
                configurationStore.save(configuration: configuration, signedIn: state.accountID != nil)
                WidgetCenter.shared.reloadAllTimelines()
                if previousOwner != nil || initialSignedOut {
                    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
                    UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
                    // Clear the extension's decryption key synchronously, then drain
                    // any route write before central revocation. Registration awaits it.
                    if observedBackend is SupabaseBackend { PushRelayClient.suspendDelivery() }
                    let pendingRegistration = registrationTask
                    let priorCleanup = authCleanupTask
                    authCleanupTask = Task {
                        _ = await priorCleanup?.value
                        await pendingRegistration?.value
                        do { try await observedBackend.stopPushDelivery(); return true }
                        catch { return false }
                    }
                }
                if state.accountID != nil {
                    authUpdateTask = Task { await updateNotificationPermission() }
                }
            } else if case .signedIn = state {
                configurationStore.setSignedIn(true)
            }
        }
    }

    func refresh() {
        refreshTick += 1
    }

    // MARK: Account

    func signOut() async throws {
        guard !isEndingSession, let owner = authState.accountID else { return }
        isEndingSession = true
        defer { isEndingSession = false }
        await registrationTask?.value
        _ = await authCleanupTask?.value
        guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
        do { try await backend.stopPushDelivery() }
        catch { throw PushLifecycleError.removalFailed }
        await removeOldDevices()
        try await backend.signOut()
        _ = await authCleanupTask?.value
        defaults.removeObject(forKey: deviceStorageKey(owner))
        forgetDevice()
        resetSession()
    }

    func deleteAccount() async throws {
        guard !isEndingSession else { return }
        isEndingSession = true
        defer { isEndingSession = false }
        let owner = authState.accountID
        await registrationTask?.value
        _ = await authCleanupTask?.value
        guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
        do { try await backend.stopPushDelivery() }
        catch { throw PushLifecycleError.removalFailed }
        try await backend.deleteAccount()
        _ = await authCleanupTask?.value
        defaults.removeObject(forKey: deviceStorageKey(owner))
        forgetDevice()
        resetSession()
    }

    /// Compatibility is checked before ending the current session. Tests can supply
    /// a checked configuration directly through the internal switch method.
    func selectServer(_ configuration: ServerConfiguration) async throws {
        try await configuration.checkCompatibility()
        try await switchServer(to: configuration)
    }

    func switchServer(to selected: ServerConfiguration) async throws {
        guard !isEndingSession else { throw PushLifecycleError.accountChanged }
        guard selected != configuration else { return }
        isEndingSession = true
        defer { isEndingSession = false }
        await registrationTask?.value
        _ = await authCleanupTask?.value
        do { try await backend.stopPushDelivery() }
        catch { throw PushLifecycleError.removalFailed }
        await removeOldDevices()
        let owner = authState.accountID
        try await backend.signOut()
        _ = await authCleanupTask?.value
        defaults.removeObject(forKey: deviceStorageKey(owner))
        forgetDevice()
        authUpdateTask?.cancel()
        authCleanupTask = nil
        resetSession()
        configuration = selected
        configurationStore.save(configuration: selected, signedIn: false)
        backend = backendFactory(selected)
        backendGeneration = UUID()
        authState = .loading
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func removeOldDevices() async {
        // The relay is already revoked, so an offline customer server cannot
        // prevent switching or signing out safely.
        for id in deviceIDs { try? await backend.unregisterPushDevice(id: id) }
    }

    private func resetSession() {
        authGeneration += 1
        authState = .signedOut
        selectedTab = .overview
        hasApps = false
        showPushExplainer = false
        configurationStore.setSignedIn(false)
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Push

    func updateNotificationPermission() async {
        let generation = backendGeneration
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard !Task.isCancelled, generation == backendGeneration else { return }
        notificationPermission = switch settings.authorizationStatus {
        case .notDetermined: .notDetermined
        case .denied: .denied
        case .authorized, .provisional, .ephemeral: .allowed
        @unknown default: .unknown
        }
        offerNotificationsIfReady()
        // Also handles enabling notifications in iPhone Settings and retries a
        // registration that failed while this phone was offline.
        await retryPushRegistration()
    }

    /// Finish the first setup step before asking for notifications. Called again
    /// after returning from the website, so setup can resume on this iPhone.
    func didLoadApps(hasApps: Bool) {
        self.hasApps = hasApps
        offerNotificationsIfReady()
    }

    private func offerNotificationsIfReady() {
        guard hasApps, email != nil, notificationPermission == .notDetermined,
              !defaults.bool(forKey: Self.explainerShownKey), !isDemo else { return }
        showPushExplainer = true
    }

    func requestNotificationPermission() async {
        defaults.set(true, forKey: Self.explainerShownKey)
        showPushExplainer = false
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            defaults.set(false, forKey: Self.explainerShownKey)
            Self.logger.error("Permission request failed: \(String(describing: error), privacy: .private)")
        }
        await updateNotificationPermission()
    }

    func retryPushRegistration() async {
        guard notificationPermission == .allowed, email != nil, !isDemo, !isEndingSession else { return }
        UIApplication.shared.registerForRemoteNotifications()
        await registerCurrentToken()
    }

    func dismissPushExplainer() {
        defaults.set(true, forKey: Self.explainerShownKey)
        showPushExplainer = false
    }

    /// Called by the app delegate on every launch and whenever APNs issues a new token.
    func didReceiveDeviceToken(_ token: Data) async {
        deviceToken = token.map { String(format: "%02x", $0) }.joined()
        await registerCurrentToken()
    }

    private func registerCurrentToken() async {
        guard !isEndingSession, !isDemo, notificationPermission == .allowed else { return }
        if let registrationTask {
            await registrationTask.value
            return
        }
        let generation = authGeneration
        if let authCleanupTask {
            if !(await authCleanupTask.value) {
                do { try await backend.stopPushDelivery() }
                catch { return }
            }
            guard generation == authGeneration, !isEndingSession else { return }
            self.authCleanupTask = nil
        }
        guard !isEndingSession, deviceToken != nil, authState.accountID != nil else { return }
        // Other callers can have started registration while cleanup suspended.
        if let registrationTask {
            await registrationTask.value
            return
        }
        let task = Task {
            await uploadCurrentToken()
            registrationTask = nil
        }
        registrationTask = task
        await task.value
    }

    private func uploadCurrentToken() async {
        while let token = deviceToken, let owner = authState.accountID {
            let generation = authGeneration
            do {
                let id = try await backend.registerPushDevice(
                    token: token, environment: AppConfig.apnsEnvironment, appVersion: AppConfig.appVersion)
                guard generation == authGeneration, owner == authState.accountID else {
                    // Auth cleanup drains this write and revokes before any new route.
                    return
                }
                deviceIDs.insert(id)
                pushDeviceID = id
                persistDevices()
                // Retain obsolete IDs durably until their removal succeeds.
                for obsolete in deviceIDs where obsolete != id {
                    try await backend.unregisterPushDevice(id: obsolete)
                    guard generation == authGeneration else { return }
                    deviceIDs.remove(obsolete)
                    persistDevices()
                }
            } catch {
                Self.logger.error("Push registration failed: \(String(describing: error), privacy: .private)")
                return // Retried on activation, sign-in, or a token callback.
            }
            if token == deviceToken || isEndingSession { return }
        }
    }

    private func deviceStorageKey(_ owner: String?) -> String {
        "pushDevices.\(configuration.identity).\(owner ?? "signedOut")"
    }

    private func restoreDevices() {
        let ids = defaults.stringArray(forKey: deviceStorageKey(authState.accountID)) ?? []
        deviceIDs = Set(ids.compactMap(UUID.init(uuidString:)))
        if configuration.identity == ServerConfiguration.cloud.identity, authState.accountID != nil,
           let legacyID = defaults.string(forKey: Self.deviceIDKey).flatMap(UUID.init(uuidString:)) {
            // Retain the old unscoped ID for cleanup only. Server RLS permits
            // deletion only if it belongs to the authenticated account.
            deviceIDs.insert(legacyID)
            persistDevices()
        }
        // A saved row is cleanup state, not proof of a current registration.
        pushDeviceID = nil
    }

    private func persistDevices() {
        defaults.set(deviceIDs.map(\.uuidString), forKey: deviceStorageKey(authState.accountID))
    }

    private func forgetDevice() {
        defaults.removeObject(forKey: deviceStorageKey(authState.accountID))
        defaults.removeObject(forKey: Self.deviceIDKey) // Remove the legacy unscoped ID.
        deviceIDs = []
        pushDeviceID = nil
    }

    func openFeedFromNotification() {
        selectedTab = .feed
        refresh()
    }
}

private enum PushLifecycleError: LocalizedError {
    case removalFailed, accountChanged

    var errorDescription: String? {
        switch self {
        case .removalFailed:
            "Couldn't stop alerts for this iPhone. Check your connection and try again."
        case .accountChanged:
            "Your account changed. Please try again."
        }
    }
}
