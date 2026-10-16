import Foundation
import Testing
import UserNotifications
@testable import Salebell

@MainActor
struct NotificationDelegateTests {
    @Test func notificationTapCompletesOnMainThreadAndOpensFeed() async throws {
        let delegate = AppDelegate(acceptsNotification: { $0["relay_route_id"] as? String == "current-route" })
        let before = delegate.model.refreshTick

        let completedOnMainThread = try await Task.detached {
            let notification = try Self.makeNotification()
            let response = try #require(UNNotificationResponse(coder: NotificationFixtureCoder([
                "notification": notification,
                "actionIdentifier": UNNotificationDefaultActionIdentifier,
            ])))
            return await withCheckedContinuation { continuation in
                // Exercise the Objective-C completion entry point used by iOS,
                // including when Swift synthesizes it for an async delegate.
                let receiver: any UNUserNotificationCenterDelegate = delegate
                receiver.userNotificationCenter?(.current(), didReceive: response) {
                    continuation.resume(returning: Thread.isMainThread)
                }
            }
        }.value

        #expect(completedOnMainThread)
        #expect(delegate.model.selectedTab == .feed)
        #expect(delegate.model.refreshTick == before + 1)
    }

    @Test func foregroundNotificationCompletesOnMainThreadAndRefreshes() async throws {
        let delegate = AppDelegate(acceptsNotification: { $0["relay_route_id"] as? String == "current-route" })
        let before = delegate.model.refreshTick

        let (completedOnMainThread, options) = try await Task.detached {
            let notification = try Self.makeNotification()
            return await withCheckedContinuation { continuation in
                let receiver: any UNUserNotificationCenterDelegate = delegate
                receiver.userNotificationCenter?(.current(), willPresent: notification) { options in
                    continuation.resume(returning: (Thread.isMainThread, options))
                }
            }
        }.value

        #expect(completedOnMainThread)
        #expect(options == [.banner, .sound, .list])
        #expect(delegate.model.selectedTab == .overview)
        #expect(delegate.model.refreshTick == before + 1)
    }

    @Test func obsoleteRouteIsSuppressedWithoutRefreshingCurrentAccount() async throws {
        let delegate = AppDelegate(acceptsNotification: { $0["relay_route_id"] as? String == "current-route" })
        let before = delegate.model.refreshTick
        let notification = try Self.makeNotification(route: "old-route")
        let options: UNNotificationPresentationOptions = await withCheckedContinuation { continuation in
            delegate.userNotificationCenter(.current(), willPresent: notification) { continuation.resume(returning: $0) }
        }
        #expect(options.isEmpty)
        #expect(delegate.model.refreshTick == before)
    }

    nonisolated private static func makeNotification(route: String = "current-route") throws -> UNNotification {
        let content = UNMutableNotificationContent()
        content.title = "New sale"
        content.userInfo = ["relay_route_id": route]
        let request = UNNotificationRequest(identifier: "sale", content: content, trigger: nil)
        return try #require(UNNotification(coder: NotificationFixtureCoder([
            "date": Date(timeIntervalSince1970: 1_700_000_000),
            "request": request,
        ])))
    }
}

// UserNotifications exposes decoding initializers, but no ordinary initializers
// for delivered notifications or responses. Keep the archive fixture in tests.
private final class NotificationFixtureCoder: NSCoder {
    private let values: [String: Any]

    init(_ values: [String: Any]) { self.values = values }

    override var allowsKeyedCoding: Bool { true }
    override func containsValue(forKey key: String) -> Bool { values[key] != nil }
    override func decodeObject(forKey key: String) -> Any? { values[key] }
}
