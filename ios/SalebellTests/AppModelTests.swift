import Foundation
import Testing
@testable import Salebell

@MainActor
struct AppModelTests {
    /// What the notification delegate calls when a sale alert is tapped.
    @Test func tappingANotificationOpensTheFeed() {
        let model = AppModel()
        model.selectedTab = .overview
        let before = model.refreshTick
        model.openFeedFromNotification()
        #expect(model.selectedTab == .feed)
        #expect(model.refreshTick == before + 1)
    }

    @Test func notificationSetupWaitsForAnAppAndResumesAfterRefresh() {
        let defaults = isolatedDefaults()
        let model = makeModel(defaults: defaults)
        model.didLoadApps(hasApps: false)
        #expect(!model.showPushExplainer)

        // The user adds their first app on the website and returns to this phone.
        model.didLoadApps(hasApps: true)
        #expect(model.showPushExplainer)
    }

    @Test func skippingNotificationsPersistsAcrossRefreshAndRelaunch() {
        let defaults = isolatedDefaults()
        let model = makeModel(defaults: defaults)
        model.didLoadApps(hasApps: true)
        model.dismissPushExplainer()
        model.didLoadApps(hasApps: true)
        #expect(!model.showPushExplainer)

        let relaunched = makeModel(defaults: defaults)
        relaunched.didLoadApps(hasApps: true)
        #expect(!relaunched.showPushExplainer)
    }

    @Test(arguments: [NotificationPermission.allowed, .denied, .unknown])
    func onlyUndecidedPermissionsShowTheExplainer(permission: NotificationPermission) {
        let model = makeModel(defaults: isolatedDefaults(), permission: permission)
        model.didLoadApps(hasApps: true)
        #expect(!model.showPushExplainer)
    }

    private func makeModel(defaults: UserDefaults,
                           permission: NotificationPermission = .notDetermined) -> AppModel {
        AppModel(backend: DemoBackend(mode: .empty), defaults: defaults,
                 authState: .signedIn(email: "indie@example.com"), notificationPermission: permission)
    }

    private func isolatedDefaults() -> UserDefaults {
        // A fresh suite avoids changing the real app's permission onboarding state.
        UserDefaults(suiteName: "AppModelTests.\(UUID().uuidString)")!
    }
}
