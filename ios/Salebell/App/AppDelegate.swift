import UIKit
import UserNotifications
import WidgetKit

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let model = AppModel()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task {
            await model.updateNotificationPermission()
            // Fresh token on every launch: APNs may rotate it at any time.
            if model.notificationPermission == .allowed {
                application.registerForRemoteNotifications()
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await model.didReceiveDeviceToken(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected in the Simulator without a push-capable team; nothing to do.
    }

    // Show sale alerts while the app is open, and refresh the numbers.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run { model.refresh() }
        WidgetCenter.shared.reloadAllTimelines()
        return [.banner, .sound, .list]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        await MainActor.run { model.openFeedFromNotification() }
        WidgetCenter.shared.reloadAllTimelines()
    }
}
