import UserNotifications

/// APNs carries only a generic fallback and encrypted sale text. The current route key
/// is removed on sign-out/switch, so obsolete account details cannot be displayed.
final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        let storage = KeychainNotificationRouteStorage()
        let active = try? storage.read()
        if let text = NotificationPrivacy.decrypt(content.userInfo, route: active),
           active == (try? storage.read()) {
            content.title = text.title
            content.body = text.body
        } else {
            content.title = "Salebell"
            content.body = "Open Salebell to see your latest activity."
            content.subtitle = ""
            content.sound = nil
            content.badge = nil
            content.attachments = []
        }
        contentHandler(content)
    }
}
