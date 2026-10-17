# App Review: Salebell for iPhone

The submission copy is maintained in `fastlane/metadata/en-US/` and
`fastlane/metadata/review_information/notes.txt`. Screenshots are in `fastlane/screenshots/en-US/`.

Use the existing review contact and sign-in information in App Store Connect;
never commit review passwords or API private keys. Reviewers need a working,
confirmed email/password account with connected apps and representative event
history. Verify sign-in on the exact release build, then verify a test push on a
physical device. The Debug-only sample backend is for screenshots, not review access.

## Submission checks

- Select the current processed release build; screenshots and copy describe that build.
- Keep the app free of checkout and calls to purchase. Account/server setup is separate from billing.
- Confirm support and privacy URLs work without authentication.
- Preserve the existing review contact and password account, and test both.
- Complete age rating, content rights, app availability, and App Privacy in App Store Connect.
- App Privacy must cover email, user ID, device identifiers used for push, and any sales/notification data retained by the service. No tracking or advertising is implemented. Use the current data flows in `../docs/PUSH_RELAY.md` to classify data; the original email/user-ID-only checklist was incomplete.
- Review export compliance for the current binary. It uses standard AES-GCM for notification content in addition to HTTPS. Do not describe it as HTTPS-only or end-to-end encryption.
- Verify the relay deployment and account/route deletion and retention procedure before shipping the shared-server app. `../docs/PUSH_RELAY.md` documents operator rollout and physical-device checks.
- The app provides Settings → Delete account. Test deletion with a disposable account rather than removing the sole reviewer account.

## Review notes

Paste `fastlane/metadata/review_information/notes.txt` into the version’s review notes.
The API upload preserves existing contact and sign-in credentials.
