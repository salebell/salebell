# Salebell for iPhone

## Self-hosted companion

The repository now implements a shared app for managed Salebell and independent backends. This is not a claim that a compatible App Store/TestFlight build is published or that the managed relay is enabled. Your website's optional `NEXT_PUBLIC_IOS_APP_URL` supplies the distribution link only after operator qualification.

1. Finish installing your backend and create the instance account.
2. Install a compatible shared Salebell build when available. Open **Settings → Server**, including from the signed-out screen.
3. Choose Salebell or enter your instance's HTTPS website URL, Supabase API URL and public/publishable key. Never enter a service-role key or management token.
4. Sign in to that backend. Password sign-in works without SMTP; email codes need SMTP. No separate managed account is required.
5. Allow notifications, keep the app open while enrollment finishes, and send a test cha-ching. Sandbox alerts are optional per device.

Customer operators do not obtain APNs keys, publish another app or install the private relay schema. Push uses the operator's trusted relay; dashboard access and other alert channels remain independent. See [relay setup, privacy and outage recovery](../docs/PUSH_RELAY.md).

The phone keeps one active backend/user route. Switching and sign-out wait for central revocation; an unreachable old backend is cleaned up best effort. A relay outage shows a retryable error and prevents activating another route until revocation succeeds. Automatic Auth loss immediately clears the local active route and queues the same central revocation. Retry after relay connectivity returns; do not delete the installation's Keychain control state.

### Advanced: a privately maintained direct-APNs build

Independent operators may maintain a separate app integration that calls `register_push_device` and uses their own Apple bundle ID, signing team, App Group and backend `APNS_*` credentials. Leave `SALEBELL_PUSH_RELAY_ENABLED` unset on that backend. Changing the shared app's bundle ID alone does not select direct APNs; the updated shared source uses `PushRelayClient`. Public build defaults can be overridden through the ignored `Config/Local.xcconfig`, but contain no private keys.

The managed backend deliberately blocks every legacy direct send when `SALEBELL_PUSH_RELAY_ENABLED=true`, even for tokens not yet enrolled. Old managed companion versions must update and re-enroll. Never bypass this rule to work around an enrollment outage.

The backend includes preview Google Play RTDN monitoring for Android purchases. No Android companion application is included. [RTDN roadmap](../docs/GOOGLE_PLAY_RTDN.md).

The free companion app: choose the backend in **Settings → Server**, sign in with that instance's account, see revenue across your apps,
get a cha-ching push for every in-app purchase and renewal, and follow a live event feed. Subscriptions are sold only on the website,
so the app has no prices, no upgrade buttons and no purchase links (App Store guideline 3.1.3(f)).

- SwiftUI, iOS 17+, Swift 6 with complete strict concurrency
- [supabase-swift](https://github.com/supabase/supabase-swift) via Swift Package Manager (pinned in `Package.resolved`)
- Targets: `Salebell` (app), `SalebellWidget` ("Today's sales" widget), `SalebellNotificationService` (route-aware notification enrichment), `SalebellTests` (Swift Testing)

```
ios/
  project.yml            xcodegen spec (source of truth for the Xcode project)
  Salebell.xcodeproj     generated from project.yml, committed so it opens without tools
  Config/                Base/Debug/Release xcconfigs: team id, bundle id, Supabase URL + publishable key
  Salebell/              App, Models, Services, Views, Resources (icon, chaching.caf, privacy manifest)
  SalebellWidget/        WidgetKit extension
  SalebellNotificationService/  Decrypts sale text only for the active notification route
  SalebellTests/         decoding, label mapping (checked against alerts.ts), keychain sharing
  Scripts/               make_icon.swift, make_chaching.py (both regenerate the bundled assets)
  docs/screenshots/      Simulator screenshots
```

## Build and run

```bash
brew install xcodegen
```

```bash
cd ios && xcodegen generate && open Salebell.xcodeproj
```

Run `xcodegen generate` again after adding or removing files or editing `project.yml`. Command-line build and tests:

```bash
cd ios && xcodebuild test -project Salebell.xcodeproj -scheme Salebell -destination 'platform=iOS Simulator,name=iPhone 17'
```

### Demo mode (Debug builds only)

The app can't reach the dashboard without a real sign-in, so Debug builds accept a launch argument that swaps in
an in-memory backend. It's useful for screenshots and UI work. In Xcode: Product → Scheme → Edit Scheme → Run → Arguments.

| Argument | Shows |
|---|---|
| `-demo signedOut` | sign-in screen |
| `-demo empty` | signed in, no apps ("Connect your first app") |
| `-demo sample` | signed in, two sample apps and five events |

`DemoBackend.swift` is wrapped in `#if DEBUG`, so Release builds don't include it.

## Shared app operator setup

Customer users skip this section. The shared app operator must first follow [the complete relay deployment runbook](../docs/PUSH_RELAY.md#managed-operator-setup); APNs secrets alone do not enable the shared flow. `PUSH_RELAY_URL` is a trusted operator build setting, never a customer server preference.

APNs key shortcut: from the repository root, run `npm run setup:owner -- --project-ref YOUR_PROJECT_REF --site-url https://salebell.vercel.app --steps push` to set the APNs secrets. Set your team ID in `Config/Base.xcconfig` for device builds. See [docs/SETUP.md](../docs/SETUP.md).

### 1. Apple team id

Open `Config/Base.xcconfig` and set:

```
DEVELOPMENT_TEAM = ABCDE12345
```

Your team id is on developer.apple.com → Account → Membership details. Signing is automatic. The first device build
registers the app, widget and notification-extension bundle IDs under `com.salebell.salebell`, the App Group
`group.com.salebell.salebell`, and the Push Notifications capability. To use a different bundle id, change `APP_BUNDLE_ID`
in the same file. The App Group follows it, and the backend's `APNS_TOPIC` must match.

### 2. APNs key (.p8) and Supabase secrets

1. developer.apple.com → Certificates, Identifiers & Profiles → **Keys** → **+**.
2. Name it "Salebell APNs", tick **Apple Push Notifications service (APNs)**, choose *Sandbox & Production*, then Continue → Register.
3. **Download** the `AuthKey_XXXXXXXXXX.p8` file. Apple lets you download it only once, so store it in your password manager.
   Never commit it (the repo's `.gitignore` already ignores `*.p8`).
4. Note the **Key ID** (the 10 characters in the file name) and your **Team ID**.
5. Set the Edge Function secrets:

| Supabase secret | Value |
|---|---|
| `APNS_KEY_P8` | full contents of the .p8 file, including the `BEGIN/END PRIVATE KEY` lines |
| `APNS_KEY_ID` | the Key ID, e.g. `ABC123DEFG` |
| `APNS_TEAM_ID` | your Team ID |
| `APNS_TOPIC` | the app's bundle id: `com.salebell.salebell` |

```bash
supabase secrets set --project-ref YOUR_PROJECT_REF APNS_KEY_P8="$(cat AuthKey_ABC123DEFG.p8)" APNS_KEY_ID=ABC123DEFG APNS_TEAM_ID=ABCDE12345 APNS_TOPIC=com.salebell.salebell
```

Use the managed relay project reference for the shared app. A separate private direct-APNs integration uses its own independent backend and Apple identity. Never copy the shared app's key to a customer project.

One key covers both APNs gateways. Each phone tells the backend which gateway to use when it registers:

| Build | `aps-environment` entitlement | Registers as |
|---|---|---|
| Debug (Xcode run on a device) | `development` | `sandbox` |
| Release (TestFlight, App Store) | `production` | `production` |

This comes from `APS_ENVIRONMENT` / `SP_APNS_ENVIRONMENT` in `Config/Debug.xcconfig` and `Config/Release.xcconfig`.

### 3. What's in the app (and what isn't)

`Config/Base.xcconfig` holds only public values: the Supabase URL, the **publishable** key (`sb_publishable_…`) and the
site URL. Row Level Security protects all data. No service-role key, Stripe key or APNs key ever ships in the app.

## How it works

- **Sign in**: Supabase email OTP (`signInWithOTP` → `verifyOTP(type: .email)`), with a 60 s cooldown on resending.
  *Use a password* signs in with email + password; it exists for the App Review demo account. The session lives in the keychain under the
  App Group access group, so the widget can use it too.
- **Overview**: `rpc('app_overview', { p_tz: <phone time zone> })`, so "Today" starts at local midnight. Totals are summed
  on the phone. Pull to refresh; it also refreshes when the app becomes active and when a push arrives in the foreground.
- **Feed**: the last 100 `store_events` rows plus Realtime `INSERT`s on `public.store_events` (RLS-filtered).
  Labels and emoji match `supabase/functions/_shared/core/alerts.ts`, and a unit test parses that file to keep them in sync.
- **Push**: permission is followed by an APNs enrollment challenge through the compiled trusted relay. The phone stores installation control state in Keychain, persists increasing revisions before network changes, activates one route for the selected backend/user and registers its capability with `register_relay_device`. Registration refreshes expiring routes. Late callbacks are checked against the selected backend generation. Sign-out/switch drain registration, clear the shared active route and require central revocation; old backend device cleanup is best effort.
  Apple/Google/test dispatch select devices through current workspace membership and sandbox preferences. The relay sees title/body and encrypts sale content for the active route; APNs receives a generic fallback plus ciphertext. The Notification Service Extension enriches only the matching active route. Accepted Apple pushes cannot be recalled; late generic alerts remain possible. There is no fallback from a revoked relay route to direct APNs.
- **Settings**: Server selection before or after sign-in, notification status, the *Sandbox alerts* toggle (`push_devices.sandbox_alerts`), email, sign out,
  **Delete account** (`delete-account` Edge Function, guideline 5.1.1(v)), and links to the docs, privacy and terms pages.
- **Send a test cha-ching** (Settings): calls `test-alert` with `{app_id: <first app>, target: "push"}` and shows the
  result. It's disabled until the account has an app, and a 429 shows how long to wait.
- **Widget**: "Today's sales" (small and medium on the home screen; rectangular and inline on the lock screen), with an
  "as of" time. It reads the selected backend and its scoped shared session, calls `app_overview` itself, and discards results when the selection generation changes. It refreshes
  every 30 minutes, and whenever the app loads new numbers, comes to the foreground or receives a push.

### Assets

- `chaching.caf` is an original sound synthesized by `Scripts/make_chaching.py`: two filtered noise bursts and two bell
  strikes, 1.35 s, 16-bit PCM. It's royalty-free because it's generated from scratch. To regenerate:
  `python3 Scripts/make_chaching.py /tmp/c.wav && afconvert -f caff -d LEI16@44100 -c 1 /tmp/c.wav Salebell/Resources/chaching.caf`
- The app icon (a ringing white bell with a gold coin clapper) is drawn by `Scripts/make_icon.swift`:
  `swift Scripts/make_icon.swift Salebell/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
  The sign-in screen shows the same artwork:
  `sips -Z 512 Salebell/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png --out Salebell/Resources/Assets.xcassets/BrandMark.imageset/BrandMark.png`

## App Store submission notes

**Business model.** Free app with no in-app purchases. It qualifies under guideline 3.1.3(f), "Free Stand-alone Apps":
a free companion to a paid web service, as long as the app has no purchasing and no calls to action to buy outside the app.
Keep it that way:
- No prices, plan names, "Pro", "upgrade" or "subscribe" anywhere in the app or its screenshots.
- The app links only to `/docs`, `/privacy` and `/terms`. Ask the web team to keep upgrade buttons and pricing
  call-outs off those three pages, or reviewers may treat them as a purchase link.
- App Store description: describe what the app does for an existing Salebell account.
  Don't mention pricing or say where to buy.

**Account deletion (5.1.1(v)).** Settings → Delete account. The backend also cancels any Stripe subscription.

**Privacy nutrition label** (App Store Connect → App Privacy):

| Data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Contact Info → Email Address | Yes | Yes | No | App Functionality |
| Identifiers → User ID | Yes | Yes | No | App Functionality |

Before submission, review the privacy label and `PrivacyInfo.xcprivacy` against the relay data described in [PUSH_RELAY.md](../docs/PUSH_RELAY.md#data-and-delivery-boundaries): device token, backend/user/route IDs, notification title/body, hashed control/capability credentials and the stored route content key. The relay can see notification text; do not describe the flow as end-to-end encryption. The app has no ads or analytics. Review export-compliance declarations for HTTPS and the notification encryption before publishing; the table above is not a completed submission audit.

**Suggested category:** Business (secondary: Finance). **Age rating:** 4+.

**Review notes and demo account.** Reviewers can't receive an email code, so the sign-in screen has a discreet
*Use a password* option (Supabase email + password). Create the reviewer account and paste the notes from
[`APP_REVIEW.md`](APP_REVIEW.md).

**Screenshots.** Run a Debug build with `-demo sample` on the required device sizes (6.9" and 6.5" iPhone). The sample
apps "Focus Timer" and "Habit Garden" are fictional.

## Known limits

- Real APNs delivery needs a physical device, a team id and the .p8 secrets. The Simulator can only show local
  `simctl push` payloads. It does issue a device token, so the registration path runs; this was checked against the
  demo backend; production relay enrollment and delivery still need a physical-device check.
- On this Mac, the iOS 27 Simulator runtime stopped answering `UNUserNotificationCenter.notificationSettings()` for every
  app, even on a freshly created device. That's a Simulator problem: the same build works on the iOS 18.1 Simulator,
  which is where the screenshots in `docs/screenshots/` come from. Restarting CoreSimulatorService (or the Mac) should fix it.
- Tapping a notification calls `AppModel.openFeedFromNotification()` (unit-tested). The Simulator ignores synthetic taps
  on lock-screen notifications, so the full tap path still needs a quick check on a device.
