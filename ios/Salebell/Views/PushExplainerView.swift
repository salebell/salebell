import SwiftUI

struct PushExplainerView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 64))
                .symbolRenderingMode(.multicolor)
                .accessibilityHidden(true)
            VStack(spacing: 12) {
                Text("Hear every in-app purchase")
                    .font(.largeTitle.bold())
                Text("Salebell can alert you with a cha-ching the moment someone buys, renews or asks for a refund in your apps.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                Button {
                    Task { await model.requestNotificationPermission() }
                } label: {
                    Text("Turn on notifications")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.borderedProminent)
                Button("Not now") { model.dismissPushExplainer() }
                    .font(.subheadline)
            }
        }
        .padding(28)
    }
}
