# App Review: Salebell for iPhone

Everything the owner needs for App Store Connect → the app → the version → **App Review Information**.

## Before you submit

1. **Create the reviewer account** (Supabase dashboard → Authentication → Users → Add user → *Create new user*):
   an address you control, e.g. `appreview@<your-domain>`, a strong password, and *Auto Confirm User* ticked.
   Signing in creates its workspace automatically.
2. **Give it something to look at.** Sign in to the website as that user, add one app, then press **Send test alert**,
   or use a disposable app with synthetic review data. An empty account still works,
   but reviewers then see only the "Add your first app on the web" screen.
3. **Check the password path on a device:** sign-in screen → *Use a password* → email + password → Overview loads.
4. Fill in **Sign-in required: Yes**, with the username and password from step 1, then paste the notes below.

## Checklist (already done in the app)

| Requirement | Where |
|---|---|
| No in-app purchases; no prices, plans or purchase links (3.1.1, 3.1.3(f)) | Whole app. The website links go only to the setup guide, privacy and terms. |
| Account deletion (5.1.1(v)) | Settings → Delete account (calls the `delete-account` function, which also cancels billing) |
| Privacy policy link | Settings → About → Privacy policy (https://salebell.vercel.app/privacy). Also enter this URL in App Store Connect. |
| Privacy manifest | `Salebell/Resources/PrivacyInfo.xcprivacy`: email + user id for app functionality, no tracking, UserDefaults reason CA92.1 |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) |
| Sign-in for reviewers | Discreet *Use a password* link under the email field (Supabase email + password) |
| Push permission asked in context | After sign-in, with a short explainer and a *Not now* option |

## Review notes (paste into "Notes")

> Salebell is a free companion app for the Salebell web service (https://salebell.vercel.app). Developers connect
> their apps on the website by pasting a URL into App Store Connect's "App Store Server Notifications" field. This
> iPhone app then shows their in-app purchase revenue and sends a notification (with a short "cha-ching" sound) for
> in-app purchases, renewals and refunds.
>
> The app has no in-app purchases. It doesn't sell, price or link to any subscription. Plans are managed only on the
> website, as allowed for free companion apps under guideline 3.1.3(f).
>
> HOW TO SIGN IN: our normal sign-in sends a 6-digit code by email. For review, tap "Use a password" under the email
> field and use the demo account in the Sign-In Information section.
>
> WHAT TO TRY:
> - Overview: revenue today, last 7 and last 30 days across the account's apps (pull to refresh).
> - Feed: recent purchases, renewals and refunds, updated live.
> - Settings → Turn on notifications, then "Send a test cha-ching" to receive a test notification.
> - Settings → Delete account permanently deletes the account and its data (guideline 5.1.1(v)).
>
> The sales data shown comes from App Store Server Notifications that the developer's own App Store Connect account
> sends to our server. The app itself collects only the sign-in email.

## If the reviewer asks…

- **"Where do I buy?"** Nowhere in the app. Answer: "Salebell plans are purchased on our website by existing customers.
  The iOS app is a free companion that never offers or links to purchases (3.1.3(f))."
- **"The notification didn't arrive."** Test pushes need notifications allowed on the reviewer's device. A production build
  uses the production APNs gateway, so the `APNS_*` secrets must be set on the server before review.
