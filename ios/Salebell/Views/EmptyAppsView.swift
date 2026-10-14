import SwiftUI

/// Shown when the signed-in user has no apps yet. Apps are added on the website.
struct EmptyAppsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ContentUnavailableView {
            Label("Connect your first app", systemImage: "app.badge")
        } description: {
            VStack(spacing: 12) {
                if let email = model.email {
                    Text("You're signed in as \(email).")
                }
                Text("1. On the Salebell website, use this same email to add your app.")
                Text("2. Paste its Production and Sandbox URLs into App Store Connect and choose Version 2.")
                Text("Return here when you're done. Your in-app purchases and subscriptions will appear as Apple sends them.")
            }
        } actions: {
            Link(destination: AppConfig.docsURL) {
                Label("Open the setup guide", systemImage: "safari")
            }
            .buttonStyle(.borderedProminent)
            Button("I've added my app · Refresh") { model.refresh() }
                .buttonStyle(.bordered)
        }
    }
}

struct LoadErrorView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Couldn't load", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: retry)
                .buttonStyle(.bordered)
        }
    }
}
