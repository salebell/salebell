import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Group {
            switch model.authState {
            case .loading:
                ProgressView()
                    .controlSize(.large)
                    .accessibilityLabel("Loading")
            case .signedOut:
                SignInView()
            case .signedIn:
                MainTabView()
                    .sheet(isPresented: $model.showPushExplainer) {
                        PushExplainerView()
                            .interactiveDismissDisabled()
                    }
            }
        }
        .animation(.default, value: model.authState)
    }
}

struct MainTabView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.selectedTab) {
            OverviewView()
                .tabItem { Label("Overview", systemImage: "chart.bar.xaxis") }
                .tag(AppTab.overview)
            FeedView()
                .tabItem { Label("Feed", systemImage: "bolt.horizontal") }
                .tag(AppTab.feed)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
                .tag(AppTab.settings)
        }
    }
}
