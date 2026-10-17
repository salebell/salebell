# App Store submission assets

Prepared for Salebell (`com.salebell.salebell`, App Store ID `6822787827`),
version **1.0**, build **4**, on 17 October 2026.

The English (US) description, subtitle, keywords, promotional text, support and
privacy URLs, copyright, review notes, Business/Finance categories and age-rating
answers have been saved in App Store Connect. The companion app is priced free.
Build 4 was archived, uploaded, processed as VALID, and selected for the draft.
The version has not been submitted for review.

## Screenshots

`screenshots/en-US/` contains actual simulator captures of the current app using
`-demo sample` (Debug only). Focus Timer and Habit Garden are fictional fixtures.
No customer revenue, personal accounts, or purchase credentials appear.

| Files | Device | Size | App Store screenshot set |
| --- | --- | --- | --- |
| 01–04 | iPhone 17 | 1206 × 2622 | APP_IPHONE_61 |
| 05–06 | iPad Air 13-inch | 2048 × 2732 | APP_IPAD_PRO_3GEN_129 |

Captures include overview, original-currency event feed, dark mode, and a 30-day
overview. JPEG files have no alpha channel and are upload-ready.

## Verification

- Release archive and App Store upload succeeded.
- All 48 iOS tests passed with simulator code signing enabled. An earlier unsigned
  run could not access the shared Keychain; the signed run passed those tests too.
- Public support, privacy and marketing URLs returned HTTP 200.
- Listing text fits Apple's field limits.
- Uploaded screenshot processing is checked through App Store Connect.

## Owner steps before submission

The dedicated confirmed review account is `appreview@salebell.example`. Its
isolated workspace contains **Focus Timer (App Review Demo)** and 76 synthetic
purchase, renewal, trial, refund and cancellation events across 28 days. Password
sign-in and tenant isolation were verified. The email is a reserved example
address: review uses the password path, with no email code or inbox required.
Credentials are saved in App Store Connect review information; the local copy is
`../build/app-review-credentials.json` (ignored by Git, permissions 0600).

Apple still requires the owner to:

1. Publish App Privacy answers for the service's actual collection and use. The
   existing source documentation's original email/user-ID-only table is not a
   complete audit of push relay identifiers or retained notification/sales content.
2. Complete the content-rights declaration for the connected store/account data.

Verify sign-in and a production test push on a physical device using build 4.
See `../APP_REVIEW.md` and `../../docs/PUSH_RELAY.md` for the current data flow.
An empty, unsubmitted review draft exists from Apple's preflight; no version was
submitted and no notification was sent to reviewers.

The App Store version page is:
https://appstoreconnect.apple.com/apps/6822787827/distribution/ios/version/inflight

## Maintaining assets

Metadata files use Fastlane's directory convention. `Deliverfile` defaults to
metadata/screenshots only and never submits for review. Supply your own Fastlane
Apple authentication; API keys and reviewer credentials must remain outside Git.
Changing the binary requires incrementing `Config/Base.xcconfig`'s build number.
