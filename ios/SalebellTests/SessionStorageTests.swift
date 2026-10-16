import Auth
import Foundation
import Testing
@testable import Salebell

/// The widget reads the session from the App Group keychain, so the app must be able to write there.
struct SessionStorageTests {
    @Test func sharedKeychainRoundTrip() throws {
        let storage = KeychainLocalStorage(service: "com.salebell.salebell.tests", accessGroup: AppConfig.appGroup)
        let key = "probe-\(UUID().uuidString)"
        try storage.store(key: key, value: Data("ok".utf8))
        defer { try? storage.remove(key: key) }
        #expect(try storage.retrieve(key: key) == Data("ok".utf8))
    }

    @Test func configIsPublicOnly() {
        #expect(["http", "https"].contains(AppConfig.supabaseURL.scheme))
        #expect(AppConfig.supabaseURL.host() != nil)
        #expect(!AppConfig.supabaseKey.hasPrefix("sb_secret_"))
        #expect(AppConfig.appGroup.hasPrefix("group."))
        #expect(["sandbox", "production"].contains(AppConfig.apnsEnvironment))
    }
    @Test func identicalSessionKeyIsIsolatedBetweenCanonicalOrigins() throws {
        let first = try ServerConfiguration(siteURL: URL(string: "https://one.example.com")!, supabaseURL: URL(string: "https://api-one.example.com")!, supabaseKey: "sb_publishable_one")
        let second = try ServerConfiguration(siteURL: URL(string: "https://two.example.com")!, supabaseURL: URL(string: "https://api-two.example.com")!, supabaseKey: "sb_publishable_two")
        let one = KeychainLocalStorage(service: first.authStorageService, accessGroup: AppConfig.appGroup)
        let two = KeychainLocalStorage(service: second.authStorageService, accessGroup: AppConfig.appGroup)
        let key = "probe-\(UUID().uuidString)"
        defer { try? one.remove(key: key); try? two.remove(key: key) }
        try one.store(key: key, value: Data("user-session-on-first".utf8))
        // Auth's Keychain backend throws errSecItemNotFound for an absent item.
        #expect((try? two.retrieve(key: key)) == nil)
        try two.store(key: key, value: Data("same-user-on-second".utf8))
        #expect(try one.retrieve(key: key) == Data("user-session-on-first".utf8))
        #expect(try two.retrieve(key: key) == Data("same-user-on-second".utf8))
    }

}
