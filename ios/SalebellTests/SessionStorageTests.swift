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
}
