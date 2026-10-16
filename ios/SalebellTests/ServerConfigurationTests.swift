import Foundation
import Testing
@testable import Salebell

struct ServerConfigurationTests {
    private func configuration(_ api: String = "https://api.example.com", key: String = "sb_publishable_test") throws -> ServerConfiguration {
        try ServerConfiguration(siteURL: URL(string: "https://sales.example.com")!, supabaseURL: URL(string: api)!, supabaseKey: key)
    }

    @Test func canonicalOriginScopesSessions() throws {
        let first = try configuration("https://API.example.com:443/")
        let same = try configuration("https://api.example.com")
        let other = try configuration("https://other.example.com")
        #expect(first.identity == same.identity)
        #expect(first.authStorageService != other.authStorageService)
        #expect(first.supabaseURL.absoluteString == "https://api.example.com")
    }

    @Test(arguments: ["https://user:pass@api.example.com", "https://api.example.com/path", "https://api.example.com?key=secret", "https://api.example.com#fragment", "http://api.example.com"])
    func rejectsUnsafeOrigins(origin: String) {
        #expect(throws: (any Error).self) { try configuration(origin) }
    }

    @Test func rejectsPrivilegedKeys() {
        #expect(throws: (any Error).self) { try configuration(key: "sb_secret_private") }
        #expect(throws: (any Error).self) { try configuration(key: "unrecognized_opaque_key") }
        let payload = Data(#"{"role":"service_role"}"#.utf8).base64EncodedString()
        #expect(throws: (any Error).self) { try configuration(key: "header.\(payload).signature") }
        #expect(throws: (any Error).self) { try configuration(key: "public\nAuthorization: secret") }
    }

    @Test func selectionGenerationInvalidatesWidgetEvenForSameUserAndOrigin() throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ServerConfigurationStore(defaults: defaults)
        store.save(configuration: try configuration(), signedIn: true)
        let selected = store.selection
        #expect(selected.signedIn)
        store.setSignedIn(false)
        #expect(!store.selection.signedIn)
        #expect(store.selection.generation != selected.generation)
        store.save(configuration: try configuration("https://other.example.com"), signedIn: false)
        #expect(store.selection.configuration.identity != selected.configuration.identity)
    }

    @Test func decodingCannotBypassValidation() {
        let data = Data(#"{"siteURL":"https://sales.example.com","supabaseURL":"https://api.example.com","supabaseKey":"sb_secret_private"}"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(ServerConfiguration.self, from: data) }
    }
    @Test func compatibilityRequestUsesOnlyProposedServerPublicCredentials() throws {
        let proposed = try configuration("https://selected.example.com", key: "sb_publishable_selected")
        let request = proposed.compatibilityRequest
        #expect(request.url?.absoluteString == "https://selected.example.com/rest/v1/rpc/instance_settings")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_selected")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(request.httpMethod == "POST")
    }

    @Test func legacyAnonJWTUsesPublicBearerForCompatibilityCheck() throws {
        let payload = Data(#"{"role":"anon"}"#.utf8).base64EncodedString()
        let key = "header.\(payload).signature"
        let request = try configuration(key: key).compatibilityRequest
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(key)")
        #expect(request.value(forHTTPHeaderField: "apikey") == key)
    }

    @Test func compatibilityFailureDoesNotExposeRemoteBodyOrCredentials() async throws {
        let options = URLSessionConfiguration.ephemeral
        options.protocolClasses = [RejectedServerProtocol.self]
        let session = URLSession(configuration: options)
        defer { session.invalidateAndCancel() }
        do {
            try await configuration().checkCompatibility(using: session)
            Issue.record("Should reject an incompatible server")
        } catch {
            #expect(error.localizedDescription == ServerConfigurationError.incompatible.localizedDescription)
            #expect(!error.localizedDescription.contains("private_remote_details"))
        }
    }

}

private final class RejectedServerProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("private_remote_details".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
