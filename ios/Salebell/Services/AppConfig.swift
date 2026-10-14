import Foundation

/// Public configuration injected from Config/*.xcconfig through Info.plist.
enum AppConfig {
    private static func value(_ key: String) -> String {
        guard let v = Bundle.main.object(forInfoDictionaryKey: key) as? String, !v.isEmpty else {
            fatalError("Missing \(key) in Info.plist. Check ios/Config/Base.xcconfig.")
        }
        return v
    }

    static let supabaseURL = URL(string: value("SPSupabaseURL"))!
    static let supabaseKey = value("SPSupabaseKey")
    static let siteURL = URL(string: value("SPSiteURL"))!
    /// Shared with the widget: the auth session lives in this keychain access group.
    static let appGroup = value("SPAppGroup")

    /// "sandbox" for Debug builds (development aps-environment), "production" for Release.
    static let apnsEnvironment = value("SPApnsEnvironment")

    static var docsURL: URL { siteURL.appending(path: "docs") }
    static var privacyURL: URL { siteURL.appending(path: "privacy") }
    static var termsURL: URL { siteURL.appending(path: "terms") }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }
}
