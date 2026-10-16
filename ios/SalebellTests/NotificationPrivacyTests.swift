import CryptoKit
import Foundation
import Testing
@testable import Salebell

struct NotificationPrivacyTests {
    @Test func onlyActiveRouteCanDecryptSaleDetails() throws {
        let route = ActiveNotificationRoute(id: UUID().uuidString.lowercased(), contentKey: String(repeating: "ab", count: 32))
        let key = SymmetricKey(data: try #require(Data(hexString: route.contentKey)))
        let plaintext = try JSONEncoder().encode(RelayNotificationText(title: "Focus Timer", body: "A new purchase"))
        let sealed = try AES.GCM.seal(plaintext, using: key)
        let info: [AnyHashable: Any] = ["relay_route_id": route.id, "relay_encrypted": [
            "nonce": sealed.nonce.withUnsafeBytes { Data($0).base64EncodedString() },
            "ciphertext": (sealed.ciphertext + sealed.tag).base64EncodedString(),
        ]]
        #expect(NotificationPrivacy.decrypt(info, route: route)?.title == "Focus Timer")
        #expect(NotificationPrivacy.decrypt(info, route: nil) == nil)
        #expect(NotificationPrivacy.decrypt(info, route: ActiveNotificationRoute(id: UUID().uuidString, contentKey: route.contentKey)) == nil)
        #expect(NotificationPrivacy.decrypt(info, route: ActiveNotificationRoute(id: route.id, contentKey: String(repeating: "cd", count: 32))) == nil)
    }

    @Test func malformedCiphertextAndUnscopedLegacyPushFailClosed() {
        let route = ActiveNotificationRoute(id: UUID().uuidString, contentKey: String(repeating: "ab", count: 32))
        #expect(!NotificationPrivacy.accepts(["title": "Other account"], route: route))
        #expect(NotificationPrivacy.decrypt(["relay_route_id": route.id, "relay_encrypted": ["nonce": "bad", "ciphertext": "bad"]], route: route) == nil)
        #expect(Data(hexString: "invalid") == nil)
    }
}
