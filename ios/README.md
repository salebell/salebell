# Salebell for iPhone

## Self-hosted companion

The companion's backend is configured at build time. The cloud-configured binary does not automatically connect to your own instance. Chat and webhook alerts work without the companion.

1. Finish [production self-hosting](../docs/SELF_HOSTING.md), including the owner account.
2. Copy `Config/Local.xcconfig.example` to the gitignored `Config/Local.xcconfig`. Set your own Apple `DEVELOPMENT_TEAM`, unique `APP_BUNDLE_ID`, public instance API URL, anon key and website URL. The base configuration includes these overrides for both the app and widget. Use the public API hostname, not a Docker service name. xcconfig URLs use `https:/$()/` so `//` is not parsed as a comment.
3. Build and sign the app with your Apple team using the instructions below. Sign in with the same instance account and password. Email-code login also works when the instance has SMTP configured.
4. To enable push, configure the backend's APNs key, Key ID and Team ID for that Apple team, and set `APNS_TOPIC` to your chosen bundle ID. Debug uses the sandbox APNs gateway; Release uses production. Private APNs keys belong only on the backend, never in the app or repository.
5. Allow notifications and send a test alert on a physical iPhone. Configuring a device build alone does not verify APNs delivery.

`Local.xcconfig` contains public backend/signing settings; retain it when updating the repository. Each installation's app, widget App Group and backend APNs topic must match. An App Store Connect import key or In-App Purchase testing key does not replace the APNs signing key.

Google Play RTDN for Android purchases is coming soon on the backend. No Android companion application is included. [RTDN roadmap](../docs/GOOGLE_PLAY_RTDN.md).

The free companion app: configure your backend in the ignored `Config/Local.xcconfig`, sign in with the same email as the website, see revenue across your apps,
get a cha-ching push for every in-app purchase and renewal, and follow a live event feed. Subscriptions are sold only on the website,
so the app has no prices, no upgrade buttons and no purchase links (App Store guideline 3.1.3(f)).

- SwiftUI, iOS 17+, Swift 6 with complete strict concurrency
- [supabase-swift](https://github.com/supabase/supabase-swift) via Swift Package Manager (pinned in `Package.resolved`)
- Targets: `Salebell` (app), `SalebellWidget` ("Today's sales" widget), `SalebellTests` (Swift Testing)

```
ios/
  project.yml            xcodegen spec (source of truth for the Xcode project)
  Salebell.xcodeproj     generated from project.yml, committed so it opens without tools
  Config/                Base/Debug/Release xcconfigs: team id, bundle id, Supabase URL + publishable key
  Salebell/              App, Models, Services, Views, Resources (icon, chaching.caf, privacy manifest)
  SalebellWidget/        WidgetKit extension
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

## Owner setup

Shortcut: from the repository root, run `npm run setup:owner -- --project-ref YOUR_PROJECT_REF --site-url https://salebell.vercel.app --steps push` to set the APNs secrets. Set your team ID in `Config/Base.xcconfig` for device builds. See [docs/SETUP.md](../docs/SETUP.md).

### 1. Apple team id

Open `Config/Base.xcconfig` and set:

```
DEVELOPMENT_TEAM = ABCDE12345
```

Your team id is on developer.apple.com → Account → Membership details. Signing is automatic. The first device build
registers the bundle ids `com.salebell.salebell` and `com.salebell.salebell.widget`, the App Group
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

The Supabase cloud project is named `salebell`. For your own installation, use its project reference or the self-hosted Compose setup.

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
- **Push**: once an app is added to the account, a short explainer asks for permission. The empty-account screen shows the setup steps and a refresh button. Then the app calls
  `register_push_device(p_token, p_apns_environment, p_app_version)` on every launch, token change and sign-in.
  Returning from iPhone Settings retries device registration after permission is enabled. Settings shows unfinished registration and offers a retry.
  Sign out deletes this phone's `push_devices` row, so the next person to use the phone doesn't get your alerts.
  Tapping a notification opens the Feed. The backend sends `sound: "chaching.caf"`, which is bundled.
- **Settings**: notification status, the *Sandbox alerts* toggle (`push_devices.sandbox_alerts`), email, sign out,
  **Delete account** (`delete-account` Edge Function, guideline 5.1.1(v)), and links to the docs, privacy and terms pages.
- **Send a test cha-ching** (Settings): calls `test-alert` with `{app_id: <first app>, target: "push"}` and shows the
  result. It's disabled until the account has an app, and a 429 shows how long to wait.
- **Widget**: "Today's sales" (small and medium on the home screen; rectangular and inline on the lock screen), with an
  "as of" time. It reads the shared session and calls `app_overview` itself. It refreshes
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

Everything else is "Not collected". The app has no analytics, ads or third-party SDKs apart from Supabase, which is your
own backend processor. The push token is used only to deliver notifications. The sales figures the app shows come from
App Store Server Notifications sent to the website, not from the phone. `PrivacyInfo.xcprivacy` declares the same
data types plus UserDefaults (reason `CA92.1`). `ITSAppUsesNonExemptEncryption` is `NO` because the app uses only HTTPS.

**Suggested category:** Business (secondary: Finance). **Age rating:** 4+.

**Review notes and demo account.** Reviewers can't receive an email code, so the sign-in screen has a discreet
*Use a password* option (Supabase email + password). Create the reviewer account and paste the notes from
[`APP_REVIEW.md`](APP_REVIEW.md).

**Screenshots.** Run a Debug build with `-demo sample` on the required device sizes (6.9" and 6.5" iPhone). The sample
apps "Focus Timer" and "Habit Garden" are fictional.

## Known limits

- Real APNs delivery needs a physical device, a team id and the .p8 secrets. The Simulator can only show local
  `simctl push` payloads. It does issue a device token, so the registration path runs; this was checked against the
  demo backend, not the live `register_push_device` yet.
- On this Mac, the iOS 27 Simulator runtime stopped answering `UNUserNotificationCenter.notificationSettings()` for every
  app, even on a freshly created device. That's a Simulator problem: the same build works on the iOS 18.1 Simulator,
  which is where the screenshots in `docs/screenshots/` come from. Restarting CoreSimulatorService (or the Mac) should fix it.
- Tapping a notification calls `AppModel.openFeedFromNotification()` (unit-tested). The Simulator ignores synthetic taps
  on lock-screen notifications, so the full tap path still needs a quick check on a device.
