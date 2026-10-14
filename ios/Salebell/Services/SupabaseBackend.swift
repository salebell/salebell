import Foundation
import Supabase

struct DeleteAccountError: LocalizedError {
    var errorDescription: String? {
        "Your account couldn't be deleted right now, and nothing was removed. Please try again in a few minutes."
    }
}

final class SupabaseBackend: Backend {
    let client: SupabaseClient

    init() {
        client = .salebell()
    }

    // MARK: Auth

    func authStates() -> AsyncStream<AuthState> {
        let auth = client.auth
        return AsyncStream { continuation in
            let task = Task {
                for await (event, session) in auth.authStateChanges {
                    switch event {
                    case .initialSession, .signedIn, .signedOut, .tokenRefreshed, .userUpdated, .userDeleted:
                        if let session {
                            continuation.yield(.signedIn(email: session.user.email ?? ""))
                        } else {
                            continuation.yield(.signedOut)
                        }
                    default:
                        break
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func sendCode(to email: String) async throws {
        try await client.auth.signInWithOTP(email: email, shouldCreateUser: true)
    }

    func verify(email: String, code: String) async throws {
        try await client.auth.verifyOTP(email: email, token: code, type: .email)
    }

    func signIn(email: String, password: String) async throws {
        try await client.auth.signIn(email: email, password: password)
    }

    func signOut() async {
        // Local scope: other devices of the same user stay signed in.
        try? await client.auth.signOut(scope: .local)
    }

    func deleteAccount() async throws {
        do {
            try await client.functions.invoke("delete-account", options: .init(method: .post, body: [String: String]()))
        } catch FunctionsError.httpError {
            // The function deletes nothing unless every step (including cancelling billing) succeeds.
            throw DeleteAccountError()
        }
        try? await client.auth.signOut(scope: .local)
    }

    // MARK: Data

    func overview() async throws -> [AppOverview] {
        try await client.appOverview()
    }

    func apps() async throws -> [AppSummary] {
        try await client.from("apps").select("id,name").order("name").execute().value
    }

    func recentEvents(limit: Int) async throws -> [StoreEventRow] {
        try await client.from("store_events")
            .select(StoreEventRow.selectColumns)
            .order("occurred_at", ascending: false)
            .limit(limit)
            .execute().value
    }

    func liveEvents() -> AsyncStream<StoreEventRow> {
        let client = client
        return AsyncStream { continuation in
            let task = Task {
                let channel = client.channel("store-events-\(UUID().uuidString)")
                let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "store_events")
                do {
                    try await channel.subscribeWithError()
                    for await insert in inserts {
                        if let row = try? insert.decodeRecord(as: StoreEventRow.self, decoder: JSONDecoder()) {
                            continuation.yield(row)
                        }
                    }
                } catch {
                    // Subscription failed (offline or not deployed). The feed still works via refresh.
                }
                await client.removeChannel(channel)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Push devices

    private struct RegisterParams: Encodable, Sendable {
        let p_token: String
        let p_apns_environment: String
        let p_app_version: String
    }

    func registerPushDevice(token: String, environment: String, appVersion: String) async throws -> UUID {
        try await client.rpc(
            "register_push_device",
            params: RegisterParams(p_token: token, p_apns_environment: environment, p_app_version: appVersion)
        ).execute().value
    }

    func unregisterPushDevice(id: UUID) async throws {
        try await client.from("push_devices").delete().eq("id", value: id).execute()
    }

    private struct DeviceRow: Decodable { let sandbox_alerts: Bool }

    func sandboxAlerts(deviceID: UUID) async throws -> Bool {
        let row: DeviceRow = try await client.from("push_devices").select("sandbox_alerts")
            .eq("id", value: deviceID).single().execute().value
        return row.sandbox_alerts
    }

    func setSandboxAlerts(_ enabled: Bool, deviceID: UUID) async throws {
        try await client.from("push_devices").update(["sandbox_alerts": enabled])
            .eq("id", value: deviceID).execute()
    }

    func sendTestPush(appID: UUID) async throws -> TestPushResult {
        do {
            return try await client.functions.invoke(
                "test-alert",
                options: .init(method: .post, body: ["app_id": appID.uuidString.lowercased(), "target": "push"])
            )
        } catch FunctionsError.httpError(let code, let data) {
            throw TestPushError.from(status: code, body: data)
        }
    }
}
