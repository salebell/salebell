import Foundation
import Supabase

extension SupabaseClient {
    /// The one client configuration used by the app and the widget. The session is kept in
    /// the App Group's keychain access group so the widget can read today's numbers.
    static func salebell() -> SupabaseClient {
        SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseKey,
            options: SupabaseClientOptions(
                auth: .init(
                    storage: KeychainLocalStorage(service: "com.salebell.salebell.auth", accessGroup: AppConfig.appGroup),
                    emitLocalSessionAsInitialSession: true
                )
            )
        )
    }

    func appOverview() async throws -> [AppOverview] {
        // "Today" starts at local midnight in the phone's time zone.
        try await rpc("app_overview", params: ["p_tz": TimeZone.current.identifier])
            .order("name").execute().value
    }
}
