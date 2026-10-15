import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    @State private var sandboxAlerts = false
    @State private var sandboxLoaded = false
    @State private var isSavingSandboxAlerts = false
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var isDeleting = false
    @State private var errorMessage: String?
    @State private var testAppID: UUID?
    @State private var appsLoaded = false
    @State private var isSendingTest = false
    @State private var testMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                notifications
                account
                about
                deleteSection
            }
            .navigationTitle("Settings")
            .task(id: model.pushDeviceID) { await loadSandboxAlerts() }
            .task(id: model.refreshTick) { await loadFirstApp() }
            .alert("Something went wrong", isPresented: .constant(errorMessage != nil)) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: Sections

    private var notifications: some View {
        Section {
            LabeledContent("Sale alerts") {
                Text(permissionText).foregroundStyle(.secondary)
            }
            switch model.notificationPermission {
            case .notDetermined:
                Button("Turn on notifications") {
                    Task { await model.requestNotificationPermission() }
                }
            case .denied:
                Button("Open iPhone Settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
            case .allowed where model.pushDeviceID == nil:
                Button("Retry notification setup") {
                    Task { await model.retryPushRegistration() }
                }
            default:
                EmptyView()
            }
            Toggle("Sandbox alerts", isOn: Binding(get: { sandboxAlerts }, set: setSandboxAlerts))
                .disabled(model.pushDeviceID == nil || !sandboxLoaded || isSavingSandboxAlerts || model.isEndingSession)
            Button(action: sendTest) {
                HStack {
                    Label("Send a test cha-ching", systemImage: "bell.badge")
                    if isSendingTest {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(testAppID == nil || model.notificationPermission != .allowed || model.pushDeviceID == nil || isSendingTest)
        } header: {
            Text("Notifications")
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                Text(model.pushDeviceID == nil
                     ? "Sandbox alerts can be changed once this iPhone is registered for notifications."
                     : "Also alert this iPhone for sandbox and TestFlight purchases. Handy while testing your paywall.")
                if let testMessage {
                    Text(testMessage).foregroundStyle(.primary)
                } else if appsLoaded && testAppID == nil {
                    Text("Add an app on the web to send a test alert.")
                } else if model.notificationPermission != .allowed {
                    Text("Turn on notifications to send a test alert to this iPhone.")
                } else if model.pushDeviceID == nil {
                    Text("Notification setup is still finishing. Check your connection and retry setup.")
                }
            }
        }
    }

    private var account: some View {
        Section("Account") {
            LabeledContent("Email", value: model.email ?? "")
            Button("Sign out") { confirmSignOut = true }
                .disabled(model.isEndingSession || isSavingSandboxAlerts)
                .confirmationDialog("Sign out of Salebell?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                    Button("Sign out", role: .destructive) {
                        Task {
                            do { try await model.signOut() }
                            catch { errorMessage = UserFacingError.message(for: error) }
                        }
                    }
                } message: {
                    Text("This iPhone stops receiving sale alerts until you sign in again.")
                }
        }
    }

    private var about: some View {
        Section {
            Link(destination: AppConfig.docsURL) { LinkRow(title: "Setup guide", systemImage: "book") }
            Link(destination: AppConfig.privacyURL) { LinkRow(title: "Privacy policy", systemImage: "hand.raised") }
            Link(destination: AppConfig.termsURL) { LinkRow(title: "Terms of use", systemImage: "doc.text") }
            LabeledContent("Version", value: AppConfig.appVersion)
        } header: {
            Text("About")
        } footer: {
            Text("Add apps and connect Slack, Discord and other integrations from the Salebell website.")
        }
    }

    private var deleteSection: some View {
        Section {
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                HStack {
                    Text("Delete account")
                    if isDeleting { Spacer(); ProgressView() }
                }
            }
            .disabled(isDeleting || model.isEndingSession || isSavingSandboxAlerts)
            .confirmationDialog("Delete your Salebell account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) { delete() }
            } message: {
                Text("This permanently deletes your login and every workspace you own alone, including its apps, events and integrations. It can't be undone.")
            }
        } footer: {
            Text("Permanently removes your account and data from Salebell.")
        }
    }

    // MARK: Actions

    private var permissionText: String {
        switch model.notificationPermission {
        case .allowed: model.pushDeviceID == nil ? "Finishing setup" : "On"
        case .denied: "Off"
        case .notDetermined: "Not set up"
        case .unknown: "…"
        }
    }

    private func loadSandboxAlerts() async {
        sandboxLoaded = false
        guard let id = model.pushDeviceID else { return }
        do {
            let value = try await model.backend.sandboxAlerts(deviceID: id)
            guard !Task.isCancelled, model.pushDeviceID == id else { return }
            sandboxAlerts = value
            sandboxLoaded = true
        } catch {
            guard !Task.isCancelled, model.pushDeviceID == id else { return }
            errorMessage = UserFacingError.message(for: error)
        }
    }

    private func setSandboxAlerts(_ enabled: Bool) {
        guard let id = model.pushDeviceID, !isSavingSandboxAlerts, !model.isEndingSession else { return }
        let previous = sandboxAlerts
        sandboxAlerts = enabled
        isSavingSandboxAlerts = true
        Task {
            defer { isSavingSandboxAlerts = false }
            do {
                try await model.backend.setSandboxAlerts(enabled, deviceID: id)
            } catch {
                guard model.pushDeviceID == id else { return }
                sandboxAlerts = previous
                errorMessage = UserFacingError.message(for: error)
            }
        }
    }

    private func loadFirstApp() async {
        if let apps = try? await model.backend.apps() {
            testAppID = apps.first?.id
            appsLoaded = true
        }
    }

    private func sendTest() {
        guard let testAppID else { return }
        isSendingTest = true
        testMessage = nil
        Task {
            do {
                testMessage = try await model.backend.sendTestPush(appID: testAppID).summary
            } catch {
                testMessage = UserFacingError.message(for: error)
            }
            isSendingTest = false
        }
    }

    private func delete() {
        isDeleting = true
        Task {
            do {
                try await model.deleteAccount()
            } catch {
                errorMessage = UserFacingError.message(for: error)
            }
            isDeleting = false
        }
    }
}

private struct LinkRow: View {
    let title: String
    let systemImage: String

    var body: some View {
        HStack {
            Label(title, systemImage: systemImage)
            Spacer()
            Image(systemName: "arrow.up.right")
                .font(.footnote)
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .foregroundStyle(.primary)
        .accessibilityHint("Opens in Safari")
    }
}
