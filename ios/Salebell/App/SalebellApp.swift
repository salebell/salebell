import SwiftUI
import WidgetKit

@main
struct SalebellApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appDelegate.model)
                .task { await appDelegate.model.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                appDelegate.model.refresh()
                if !appDelegate.model.isDemo { WidgetCenter.shared.reloadAllTimelines() }
                Task { await appDelegate.model.updateNotificationPermission() }
            }
        }
    }
}
