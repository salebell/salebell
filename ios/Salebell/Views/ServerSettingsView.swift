import SwiftUI

struct ServerSettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var siteAddress = ""
    @State private var apiAddress = ""
    @State private var publicKey = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var confirmCloud = false

    var body: some View {
        Form {
            Section {
                TextField("https://sales.example.com", text: $siteAddress)
                    .keyboardType(.URL)
                    .accessibilityLabel("Website address")
                TextField("https://project.supabase.co", text: $apiAddress)
                    .keyboardType(.URL)
                    .accessibilityLabel("Supabase API address")
                SecureField("Supabase public key", text: $publicKey)
                    .accessibilityLabel("Supabase public publishable or anon key")
            } header: {
                Text("Your Salebell server")
            } footer: {
                Text("Use the website address, Supabase API address and public key from your installation. Changing servers signs you out and stops alerts from the previous server.")
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            Section {
                Button(action: save) {
                    HStack {
                        Text("Connect to server")
                        Spacer()
                        if isSaving { ProgressView() }
                    }
                }
                Button("Use Salebell Cloud") { confirmCloud = true }
                    .disabled(model.configuration == .cloud)
                    .confirmationDialog("Use Salebell Cloud?", isPresented: $confirmCloud, titleVisibility: .visible) {
                        Button("Use Salebell Cloud") { connect(.cloud) }
                    } message: {
                        Text("Your current session will end and alerts from this server will stop.")
                    }
            }
        }
        .disabled(isSaving || model.isEndingSession)
        .navigationTitle("Server")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Seed editable fields once for this settings presentation.
            siteAddress = model.configuration.siteURL.absoluteString
            apiAddress = model.configuration.supabaseURL.absoluteString
            publicKey = model.configuration.supabaseKey
        }
    }

    private func save() {
        guard let site = URL(string: siteAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
              let api = URL(string: apiAddress.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            errorMessage = ServerConfigurationError.origin.localizedDescription
            return
        }
        do { connect(try ServerConfiguration(siteURL: site, supabaseURL: api, supabaseKey: publicKey)) }
        catch { errorMessage = error.localizedDescription }
    }

    private func connect(_ configuration: ServerConfiguration) {
        isSaving = true
        errorMessage = nil
        Task {
            do {
                try await model.selectServer(configuration)
                dismiss()
            } catch { errorMessage = error.localizedDescription }
            isSaving = false
        }
    }
}
