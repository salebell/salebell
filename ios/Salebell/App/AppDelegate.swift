import OSLog
import UIKit
import UserNotifications
import WidgetKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let model = AppModel()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task {
            await model.updateNotificationPermission()
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await model.didReceiveDeviceToken(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        let failure = error as NSError
        Logger(subsystem: "com.salebell", category: "Push").error(
            "APNs registration failed: domain=\(failure.domain, privacy: .public) code=\(failure.code) description=\(failure.localizedDescription, privacy: .private)")
    }

    // Show sale alerts while the app is open, and refresh the numbers.
    // These protocol callbacks are nonisolated; hop to MainActor for UI-owned state.
    // Complete after the short state update, without waiting for network refreshes.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            model.refresh()
            WidgetCenter.shared.reloadAllTimelines()
            completionHandler([.banner, .sound, .list])
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        Task { @MainActor in
            model.openFeedFromNotification()
            WidgetCenter.shared.reloadAllTimelines()
            completionHandler()
        }
    }
}
