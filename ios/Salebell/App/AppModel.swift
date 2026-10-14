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
        pushDeviceID = defaults.string(forKey: Self.deviceIDKey).flatMap(UUID.init(uuidString:))
    }

    /// Seed the model for previews and tests without contacting Auth or iOS permissions.
    init(backend: any Backend, defaults: UserDefaults, authState: AuthState,
         notificationPermission: NotificationPermission) {
        self.backend = backend
        self.defaults = defaults
        self.authState = authState
        self.notificationPermission = notificationPermission
        isDemo = false
        pushDeviceID = defaults.string(forKey: Self.deviceIDKey).flatMap(UUID.init(uuidString:))
    }

    var email: String? {
        if case .signedIn(let email) = authState { email } else { nil }
    }

    func start() async {
        for await state in backend.authStates() {
            let wasSignedIn = email != nil
            authState = state
            if case .signedOut = state {
                hasApps = false
                showPushExplainer = false
            }
            if case .signedIn = state, !wasSignedIn {
                await didSignIn()
            }
        }
    }

    func refresh() {
        refreshTick += 1
    }

    // MARK: Account

    func signOut() async {
        await removeThisDevice()
        await backend.signOut()
        authState = .signedOut
        selectedTab = .overview
        hasApps = false
        showPushExplainer = false
    }

    func deleteAccount() async throws {
        try await backend.deleteAccount()
        forgetDevice()
        authState = .signedOut
        selectedTab = .overview
        hasApps = false
        showPushExplainer = false
    }

    // MARK: Push

    private func didSignIn() async {
        await updateNotificationPermission()
    }

    func updateNotificationPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
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
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await updateNotificationPermission()
    }

    func retryPushRegistration() async {
        guard notificationPermission == .allowed, email != nil, !isDemo else { return }
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
        guard let deviceToken, email != nil else { return }
        do {
            let id = try await backend.registerPushDevice(
                token: deviceToken, environment: AppConfig.apnsEnvironment, appVersion: AppConfig.appVersion)
            pushDeviceID = id
            defaults.set(id.uuidString, forKey: Self.deviceIDKey)
        } catch {
            // Retried on the next launch or sign-in.
        }
    }

    /// Stops pushes for the signed-in user to this phone before signing out.
    private func removeThisDevice() async {
        if let pushDeviceID {
            try? await backend.unregisterPushDevice(id: pushDeviceID)
        }
        forgetDevice()
    }

    private func forgetDevice() {
        pushDeviceID = nil
        defaults.removeObject(forKey: Self.deviceIDKey)
    }

    func openFeedFromNotification() {
        selectedTab = .feed
        refresh()
    }
}
