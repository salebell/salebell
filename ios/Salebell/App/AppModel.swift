import OSLog
import Observation
import SwiftUI
import UserNotifications

enum AppTab: Hashable {
    case overview, feed, settings
}

enum NotificationPermission: Equatable {
    case unknown, notDetermined, denied, allowed
}

@MainActor
@Observable
final class AppModel {
    let backend: any Backend
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
    private var isObservingAuth = false
    private var authGeneration = 0
    private var deviceIDs: Set<UUID> = []
    private static let logger = Logger(subsystem: "com.salebell", category: "Push")
    private let defaults: UserDefaults
    private static let deviceIDKey = "pushDeviceID"
    private static let explainerShownKey = "pushExplainerShown"

    init() {
        defaults = .standard
        #if DEBUG
        if let demo = DemoBackend.fromLaunchArguments() {
            backend = demo
            isDemo = true
            return
        }
        #endif
        backend = SupabaseBackend()
        isDemo = false
    }

    /// Seed the model for previews and tests without contacting Auth or iOS permissions.
    init(backend: any Backend, defaults: UserDefaults, authState: AuthState,
         notificationPermission: NotificationPermission) {
        self.backend = backend
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
        guard !isObservingAuth else { return }
        isObservingAuth = true
        defer {
            isObservingAuth = false
            authUpdateTask?.cancel()
        }
        for await state in backend.authStates() {
            guard !Task.isCancelled else { break }
            let changedAccount = authState.accountID != state.accountID
            authState = state
            if changedAccount {
                authGeneration += 1
                hasApps = false
                showPushExplainer = false
                restoreDevices()
                authUpdateTask?.cancel()
                if state.accountID != nil {
                    // Do not suspend the auth stream while registration uses the network.
                    authUpdateTask = Task { await updateNotificationPermission() }
                }
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
        // Cancellation cannot undo a server write. Drain it before removing devices.
        await registrationTask?.value
        guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
        do {
            // Resolve an ambiguous upload failure (the server may have committed it).
            if let deviceToken {
                let id = try await backend.registerPushDevice(
                    token: deviceToken, environment: AppConfig.apnsEnvironment, appVersion: AppConfig.appVersion)
                guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
                deviceIDs.insert(id)
                pushDeviceID = id
                persistDevices()
            }
            for id in deviceIDs {
                try await backend.unregisterPushDevice(id: id)
                guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
            }
        } catch {
            Self.logger.error("Device removal failed: \(String(describing: error), privacy: .private)")
            throw PushLifecycleError.removalFailed
        }
        forgetDevice()
        try await backend.signOut()
        guard authState.accountID == owner || authState.accountID == nil else { return }
        authGeneration += 1
        authState = .signedOut
        selectedTab = .overview
        hasApps = false
        showPushExplainer = false
    }

    func deleteAccount() async throws {
        guard !isEndingSession else { return }
        isEndingSession = true
        defer { isEndingSession = false }
        let owner = authState.accountID
        await registrationTask?.value
        guard authState.accountID == owner else { throw PushLifecycleError.accountChanged }
        try await backend.deleteAccount()
        // Server account deletion cascades to push_devices.
        defaults.removeObject(forKey: deviceStorageKey(owner))
        guard authState.accountID == owner || authState.accountID == nil else { return }
        deviceIDs = []
        pushDeviceID = nil
        authGeneration += 1
        authState = .signedOut
        selectedTab = .overview
        hasApps = false
        showPushExplainer = false
    }

    // MARK: Push

    func updateNotificationPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard !Task.isCancelled else { return }
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
        guard deviceToken != nil, authState.accountID != nil else { return }
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
                    // The next iteration transfers the token to the new account.
                    if isEndingSession { return }
                    continue
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
        "pushDevices.\(owner ?? "signedOut")"
    }

    private func restoreDevices() {
        let ids = defaults.stringArray(forKey: deviceStorageKey(authState.accountID)) ?? []
        deviceIDs = Set(ids.compactMap(UUID.init(uuidString:)))
        if authState.accountID != nil,
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
            "Couldn't stop alerts for this iPhone. You are still signed in. Check your connection and try again."
        case .accountChanged:
            "Your account changed. Please try again."
        }
    }
}
