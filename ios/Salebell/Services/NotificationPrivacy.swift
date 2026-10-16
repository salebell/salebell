import CryptoKit
import Foundation
import Security

struct ActiveNotificationRoute: Codable, Equatable, Sendable {
    let id: String
    let contentKey: String
}

struct RelayNotificationText: Codable, Equatable, Sendable {
    let title: String
    let body: String
}

protocol NotificationRouteStorage {
    func read() throws -> ActiveNotificationRoute?
    func write(_ route: ActiveNotificationRoute) throws
    func clear() throws
}

/// Read directly from the shared Keychain for each notification, never from a cached session.
struct KeychainNotificationRouteStorage: NotificationRouteStorage {
    private var keychain: RelayKeychain { RelayKeychain(service: "com.salebell.relay.notification", accessGroup: AppConfig.appGroup) }
    func read() throws -> ActiveNotificationRoute? {
        guard let data = try keychain.read() else { return nil }
        return try JSONDecoder().decode(ActiveNotificationRoute.self, from: data)
    }
    func write(_ route: ActiveNotificationRoute) throws { try keychain.write(JSONEncoder().encode(route)) }
    func clear() throws { try keychain.clear() }
}

enum NotificationPrivacy {
    static func accepts(_ info: [AnyHashable: Any], route: ActiveNotificationRoute?) -> Bool {
        guard let route, let id = info["relay_route_id"] as? String else { return false }
        return id == route.id
    }

    static func decrypt(_ info: [AnyHashable: Any], route: ActiveNotificationRoute?) -> RelayNotificationText? {
        guard accepts(info, route: route), let route,
              let fields = info["relay_encrypted"] as? [String: String],
              let nonce = fields["nonce"].flatMap({ Data(base64Encoded: $0) }), nonce.count == 12,
              let ciphertext = fields["ciphertext"].flatMap({ Data(base64Encoded: $0) }),
              ciphertext.count >= 16, ciphertext.count <= 4096,
              let key = Data(hexString: route.contentKey), key.count == 32 else { return nil }
        do {
            let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: nonce),
                                          ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
            let clear = try AES.GCM.open(box, using: SymmetricKey(data: key))
            let text = try JSONDecoder().decode(RelayNotificationText.self, from: clear)
            guard text.title.count <= 200, text.body.count <= 1500 else { return nil }
            return text
        } catch { return nil }
    }
}

extension Data {
    init?(hexString: String) {
        guard hexString.count.isMultiple(of: 2), hexString.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { return nil }
        var result = Data()
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let end = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<end], radix: 16) else { return nil }
            result.append(byte)
            index = end
        }
        self = result
    }
}

/// App-private installation credentials use no access group; notification keys use the App Group.
struct RelayKeychain {
    let service: String
    var accessGroup: String?

    private var query: [String: Any] {
        var result: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service, kSecAttrAccount as String: "state"]
        if let accessGroup { result[kSecAttrAccessGroup as String] = accessGroup }
        return result
    }

    func read() throws -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw RelayKeychainError.unavailable }
        return data
    }

    func write(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var q = query
            attributes.forEach { q[$0.key] = $0.value }
            guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw RelayKeychainError.unavailable }
        } else if status != errSecSuccess { throw RelayKeychainError.unavailable }
    }

    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw RelayKeychainError.unavailable }
    }
}

enum RelayKeychainError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Secure notification storage is unavailable. Unlock your iPhone and try again." }
}
