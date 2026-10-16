import OSLog
import UIKit
import UserNotifications
import WidgetKit

@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let model: AppModel
    private let acceptsNotification: @MainActor ([AnyHashable: Any]) -> Bool

    override convenience init() {
        self.init(model: nil, acceptsNotification: { PushRelayClient.acceptsNotification($0) })
    }

    init(model: AppModel? = nil, acceptsNotification: @escaping @MainActor ([AnyHashable: Any]) -> Bool) {
        self.model = model ?? AppModel()
        self.acceptsNotification = acceptsNotification
        super.init()
    }

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
        let routeID = notification.request.content.userInfo["relay_route_id"] as? String
        let enrollment = notification.request.content.userInfo["relay_enrollment"] as? [String: String]
        Task { @MainActor in
            var info: [AnyHashable: Any] = [:]
            if let routeID { info["relay_route_id"] = routeID }
            if let enrollment { info["relay_enrollment"] = enrollment }
            if PushRelayClient.handleEnrollmentNotification(info) || !acceptsNotification(info) {
                completionHandler([])
                return
            }
            model.refresh()
            WidgetCenter.shared.reloadAllTimelines()
            completionHandler([.banner, .sound, .list])
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        let routeID = response.notification.request.content.userInfo["relay_route_id"] as? String
        let enrollment = response.notification.request.content.userInfo["relay_enrollment"] as? [String: String]
        Task { @MainActor in
            var info: [AnyHashable: Any] = [:]
            if let routeID { info["relay_route_id"] = routeID }
            if let enrollment { info["relay_enrollment"] = enrollment }
            if PushRelayClient.handleEnrollmentNotification(info) || !acceptsNotification(info) {
                completionHandler()
                return
            }
            model.openFeedFromNotification()
            WidgetCenter.shared.reloadAllTimelines()
            completionHandler()
        }
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if PushRelayClient.handleEnrollmentNotification(userInfo) { completionHandler(.noData); return }
        guard acceptsNotification(userInfo) else { completionHandler(.noData); return }
        model.refresh()
        WidgetCenter.shared.reloadAllTimelines()
        completionHandler(.newData)
    }
}
