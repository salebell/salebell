import CryptoKit
import Foundation

struct ServerConfiguration: Codable, Equatable, Sendable {
    let siteURL: URL
    let supabaseURL: URL
    let supabaseKey: String

    static var cloud: ServerConfiguration {
        // These remain the published app's original build defaults.
        try! ServerConfiguration(siteURL: AppConfig.siteURL, supabaseURL: AppConfig.supabaseURL,
                                 supabaseKey: AppConfig.supabaseKey)
    }

    init(siteURL: URL, supabaseURL: URL, supabaseKey: String) throws {
        self.siteURL = try Self.origin(siteURL)
        self.supabaseURL = try Self.origin(supabaseURL)
        guard !supabaseKey.isEmpty, supabaseKey.count <= 8192,
              !supabaseKey.unicodeScalars.contains(where: { CharacterSet.whitespacesAndNewlines.union(.controlCharacters).contains($0) }),
              !supabaseKey.lowercased().hasPrefix("sb_secret_") else { throw ServerConfigurationError.publicKey }
        let parts = supabaseKey.split(separator: ".", omittingEmptySubsequences: false)
        var isPublicKey = supabaseKey.hasPrefix("sb_publishable_") && supabaseKey.count > "sb_publishable_".count
        #if DEBUG
        if supabaseKey == "YOUR_INSTANCE_ANON_KEY" { isPublicKey = true }
        #endif
        if parts.count == 3 {
            var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
            guard let data = Data(base64Encoded: payload),
                  let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  claims["role"] as? String == "anon" else { throw ServerConfigurationError.publicKey }
            isPublicKey = true
        }
        guard isPublicKey else { throw ServerConfigurationError.publicKey }
        self.supabaseKey = supabaseKey
    }

    private enum CodingKeys: String, CodingKey { case siteURL, supabaseURL, supabaseKey }
    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(siteURL: values.decode(URL.self, forKey: .siteURL),
                      supabaseURL: values.decode(URL.self, forKey: .supabaseURL),
                      supabaseKey: values.decode(String.self, forKey: .supabaseKey))
    }

    var identity: String {
        SHA256.hash(data: Data(supabaseURL.absoluteString.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    var authStorageService: String { "com.salebell.salebell.auth.\(identity)" }
    var authStorageKey: String { "salebell.auth.session" }
    var docsURL: URL { siteURL.appending(path: "docs") }
    var privacyURL: URL { siteURL.appending(path: "privacy") }
    var termsURL: URL { siteURL.appending(path: "terms") }

    private static func origin(_ url: URL) throws -> URL {
        let raw = url.absoluteString
        guard !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(), !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/",
              components.port.map({ (1...65535).contains($0) }) ?? true else { throw ServerConfigurationError.origin }
        var allowed = scheme == "https"
        #if DEBUG
        if scheme == "http", ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host) { allowed = true }
        #endif
        guard allowed else { throw ServerConfigurationError.origin }
        components.scheme = scheme
        components.host = host
        components.path = ""
        if components.port == (scheme == "https" ? 443 : 80) { components.port = nil }
        guard let result = components.url else { throw ServerConfigurationError.origin }
        return result
    }

    /// Uses a fresh, unauthenticated session. Neither an existing access token nor cookies
    /// from the current server are sent while checking a proposed server.
    var compatibilityRequest: URLRequest {
        var request = URLRequest(url: supabaseURL.appending(path: "rest/v1/rpc/instance_settings"))
        request.httpMethod = "POST"
        request.httpBody = Data("{}".utf8)
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseKey, forHTTPHeaderField: "apikey")
        // Publishable keys are API keys, not JWTs. Only the legacy anon JWT
        // belongs in Authorization. No current user token is used here.
        if !supabaseKey.hasPrefix("sb_publishable_") {
            request.setValue("Bearer \(supabaseKey)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    func checkCompatibility(using providedSession: URLSession? = nil) async throws {
        let session = providedSession ?? URLSession(configuration: .ephemeral, delegate: NoServerRedirects(), delegateQueue: nil)
        defer { if providedSession == nil { session.invalidateAndCancel() } }
        do {
            let (data, response) = try await session.data(for: compatibilityRequest)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 65536,
                  let settings = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  ["cloud", "self_hosted"].contains(settings["deployment_mode"] as? String ?? ""),
                  settings["billing_enabled"] is Bool else { throw ServerConfigurationError.incompatible }
        } catch { throw ServerConfigurationError.incompatible }
    }
}

private final class NoServerRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum ServerConfigurationError: LocalizedError {
    case origin, publicKey, incompatible
    var errorDescription: String? {
        switch self {
        case .origin: "Enter an HTTPS server address without a path, password, query or fragment."
        case .publicKey: "Enter your Supabase public publishable or anon key. Secret keys cannot be used in the app."
        case .incompatible: "Couldn't connect to a compatible Salebell server. Check the addresses and public key, then try again."
        }
    }
}

/// A single encoded snapshot keeps widget configuration, login visibility and generation together.
final class ServerConfigurationStore: @unchecked Sendable {
    struct Selection: Codable, Equatable, Sendable {
        let configuration: ServerConfiguration
        let generation: UUID
        let signedIn: Bool
    }
    private let defaults: UserDefaults
    private let key = "salebell.server.selection.v1"
    init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? UserDefaults(suiteName: AppConfig.appGroup) ?? .standard
    }
    var selection: Selection {
        if let data = defaults.data(forKey: key), let selection = try? JSONDecoder().decode(Selection.self, from: data) { return selection }
        return Selection(configuration: .cloud, generation: UUID(uuidString: "00000000-0000-0000-0000-000000000000")!, signedIn: false)
    }
    func save(configuration: ServerConfiguration, signedIn: Bool) {
        let snapshot = Selection(configuration: configuration, generation: UUID(), signedIn: signedIn)
        if let data = try? JSONEncoder().encode(snapshot) { defaults.set(data, forKey: key) }
    }
    func setSignedIn(_ value: Bool) {
        let current = selection
        guard current.signedIn != value else { return }
        save(configuration: current.configuration, signedIn: value)
    }
}
