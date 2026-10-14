# Import iOS apps with an App Store Connect API key

Salebell discovers existing iOS apps and configures App Store Server Notifications V2 with an **App Store Connect API key**. Upload the key once, then select it for more apps. Manual setup remains available without a key. **In-App Purchase keys** serve the separate, optional Apple test.

## Customer setup

1. In App Store Connect, open **Users and Access → Integrations → App Store Connect API → Team Keys**. Generate a dedicated key with **Access: App Manager** (recommended; **Admin** also works) and download its `.p8` file. Copy the **Key ID** and **Issuer ID** shown there.
2. In Salebell, open **Add app → Import your iOS app**. Use the key selector to choose a saved App Store Connect API key, or upload the `.p8` and press **Load my iOS apps →**. Apple's filename supplies the Key ID; enter it if the file was renamed. Enter the Issuer ID once; known keys and a single saved team reuse it, while multiple teams require a matching choice. Credential JSON can include all three values. Apps load after saving or selecting a key.
3. Tap an app to advance immediately to **Receive App Store notifications**. Search is available for longer lists. Salebell reads the name, bundle ID and numeric Apple ID; selecting an app does not create a saved app or consume a plan slot.
4. Check the selected app and any existing server hostname. **Connection details** expands the URL cards. Supported existing V2 destinations stay connected through forwarding; **Your server** shows App Store → Salebell → your server.
5. Press **Start receiving notifications**. Salebell finds or imports the app, reads a fresh server preview, and sets both Apple notification URLs with **Version 2** selected. Adding a new app respects the workspace's plan limit; retries reuse the saved app. If Apple's settings changed since the review, setup stops and shows the updated details for another review and attempt.
6. **Check your connection** shows receipt status and keeps **Send an App Store test notification** visible after receipt. Its single key selector offers saved encrypted In-App Purchase keys, an upload, or one-time use; compatible saved team metadata reuses the Issuer ID. An accepted test request can still be pending or fail delivery. Go to the dashboard or choose **Set up alerts (optional) →** anytime. Recording requires no alert destination. **Configured** means Apple accepted the settings; **Connected** means Salebell received and verified an Apple notification.

The flow shows one task at a time: **Import iOS apps → Select your app → Track purchases**, followed by connection verification and optional alerts. Completed forms stay hidden; key and URL details are expandable. iOS / App Store is selected, and Android / Google Play RTDN is **Coming soon**.

Saved connections can be updated with a replacement key or deleted when no longer needed. Deleting a connection removes Salebell's saved credential; it does not revoke the key at Apple, undo Apple notification URLs, or remove an imported app. To fully revoke Apple's permission, revoke the key in App Store Connect as well.

Deleting an app immediately frees its plan slot. You can re-add the same app and reconnect with your saved key. Apple may retain the deleted app's old Salebell URLs; automatic setup replaces them after confirming their receiver key no longer belongs to a live app. Other active app receivers are never silently replaced.

The Account Holder must first request App Store Connect API access if it has not been enabled. Creating a team key requires the Account Holder or an Admin. Team keys apply to **all apps in the Apple account**, even when given an App Manager role. A dedicated key makes revocation easier; this is not an app-scoped permission grant. [Apple's API access and key guide](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/)

**App Manager is the key's Access setting**, while **Account Holder or Admin is the Apple user creating it**. Salebell recommends App Manager for discovering apps and updating their notification settings; an Admin key grants broader permissions. A `.p8` upload still needs the Issuer ID, because Apple supplies that account identifier separately. The Key ID can be filled from Apple's `AuthKey_<KEY_ID>.p8` filename when present; credential JSON can include all three values in one upload. [Apple's authentication fields](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests)

For **manual setup in Apple's website**, Apple allows Account Holder, Admin, App Manager, or Marketing to edit notification URLs. This website permission list is separate from Salebell's recommended API-key role. [Apple's notification URL permissions](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications/)

Only team App Store Connect keys are supported by this import flow. Apple also offers individual keys that inherit a user's app access, but they use a different authentication claim and are not accepted here. [Apple's key types](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api)

### JSON import

The supported file contains these fields:

```json
{
  "key_id": "ABC123DEFG",
  "issuer_id": "00000000-0000-0000-0000-000000000000",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
}
```

The `key` field is also accepted in place of `private_key` for compatible Fastlane credential files. JSON strings use escaped newlines (`\n`); an uploaded `.p8` contains the PEM text directly. A file name may suggest the Key ID, but cannot supply the Issuer ID or prove the key's Apple service or permissions. Do not include passwords, session cookies, APNs keys, or unrelated provider secrets.

The browser holds the uploaded private key only while saving it over HTTPS to the authenticated `apple-credentials` Edge Function, then clears its copy from the form. Salebell stores the private key encrypted in **Supabase Vault**, with connection metadata in a private table. Connection lists and save responses contain metadata, never the private key. Later discovery and configuration requests send a saved `credential_id`, and the server retrieves the key after checking workspace permissions. Keys are not saved in browser local storage or returned for download. Keep the original file secure on the customer's device. Revoke an unused or compromised key in App Store Connect. [Apple's key security guidance](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), [Supabase Vault](https://supabase.com/docs/guides/database/vault)

## Existing notification servers

Apple supports one production URL and one sandbox URL. Replacing either can interrupt another service unless its destination is preserved. Salebell forwards the original raw notification body to the appropriate configured forwarding URL. Production and sandbox destinations are reviewed separately. [Apple's notification URL guide](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications)

An existing **V1** destination requires manual handling. Switching Apple to V2 changes the payload format; forwarding that body does not turn it into a V1 notification. First migrate the existing receiver to V2, or deliberately change its configuration through manual setup. The automatic connection flow must not silently replace a V1 destination. V1 is deprecated, and Apple recommends testing V2 in sandbox before switching production. [Enable notifications and migrate versions](https://developer.apple.com/documentation/appstoreservernotifications/enabling-app-store-server-notifications)

Forwarding destinations must pass Salebell's outbound URL checks: HTTPS, a public hostname and no redirect following. Invalid or ambiguous destinations require manual resolution before automatic configuration. Preview and configuration re-read Apple settings so changes made in another session can be reviewed again.

## What is automated

| Task | Supported behavior / remaining step |
|---|---|
| Create or download an Apple key | Customer completes this in Apple; private keys can only be downloaded once. |
| Discover existing apps | Automatic name, bundle ID and numeric Apple ID discovery using the uploaded team ASC key. |
| Add an app to Salebell | Selected app metadata is imported; workspace permissions and plan limits still apply. |
| Read Apple notification settings | Automatic, with separate production and sandbox values shown in the preview. |
| Set Apple notification URLs and V2 | Automatic after the customer reviews and applies the preview. |
| Preserve an existing V2 receiver | Preview and save supported production/sandbox forwarding destinations before applying Apple changes. |
| Migrate an existing V1 receiver | Manual; Salebell does not convert V2 payloads into V1. |
| Request a real Apple TEST notification | Optional separate In-App Purchase connection in app setup; save/reuse the key or use it once. An ASC configuration key cannot perform this test. |
| Confirm the connection | Verified Apple webhook receipt; accepting a configuration or test request alone is insufficient. |
| Generate a new Apple app record | Customer uses App Store Connect; this flow discovers existing apps. |
| Backfill historical purchases | Not implemented. |
| Save and reuse Apple connections | Encrypted private-key storage, metadata-only lists, and replacement/deletion controls. |
| Configure Salebell email, Stripe or iPhone push | Deployment owner completes platform setup; these are separate from customer Apple permissions. |

Apple's [Apps documentation](https://developer.apple.com/documentation/appstoreconnectapi/apps) directs developers to create app records on the website. Apple documents separate [In-App Purchase keys](https://developer.apple.com/documentation/appstoreserverapi/creating-api-keys-to-authorize-api-requests) for App Store Server API requests.

## Keys have different purposes

| Key | Purpose in Salebell |
|---|---|
| Customer App Store Connect team `.p8` | Saved encrypted connection for discovery and notification URL configuration. Choose **Access: App Manager** (recommended) or **Admin** when creating the team key. Requires Key ID and issuer UUID. |
| Customer In-App Purchase `.p8` | Optional real Apple TEST request, using a saved encrypted connection or a one-time upload. An Account Holder or Admin generates it under **Integrations → In-App Purchase**; there is no ASC Access-role selection for this separate key type. Requires Key ID, issuer UUID and the app's bundle ID. It does not configure Apple notification URLs. |
| Customer APNs `.p8` | **Never needed for Salebell push alerts.** This key would send pushes to the customer's own apps. |
| Salebell deployment owner's APNs `.p8` | Sends alerts to the Salebell iPhone app; configured as server-side platform secrets. |
| Salebell deployment owner's SMTP / Stripe secrets | Deliver sign-in emails and manage Salebell billing; configured separately by the deployment owner. |

The fact that all three Apple key types can use a `.p8` extension does not make them interchangeable. ASC and In-App Purchase keys are restricted to their respective Apple APIs. APNs tokens identify a developer Team ID, rather than the App Store Connect issuer UUID. [ASC keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api), [In-App Purchase keys](https://developer.apple.com/documentation/appstoreserverapi/creating-api-keys-to-authorize-api-requests), [APNs keys](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)

Apple documents In-App Purchase key generation separately, including the Account Holder/Admin requirement and the one-time download. [Generate an In-App Purchase key](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/generate-keys-for-in-app-purchases/)

## Implementation contract

`apple-credentials` requires a signed-in user's JWT and supports listing, saving/replacing and deleting workspace Apple connections, distinguished by `apple_connect` and `apple_iap` providers. The private key is encrypted before storage and is not directly available to browser clients. Saved connection metadata can be reused in the setup flow.

`apple-connect` requires a signed-in user's JWT and supports the `discover`, `preview`, and `configure` actions using the saved `credential_id`. Both endpoints require workspace management permissions. App ownership, plan constraints, forwarding destinations and Apple metadata are validated on the server; the browser's imported fields do not grant permission.

Deployment prerequisites:

1. Apply `20261013130000_apple_credentials.sql` and `20261013140000_apple_connection.sql`. The first enables Supabase Vault if needed, creates private credential metadata and service-only access functions, and cleans up secrets when credentials or accounts are deleted. A workspace may save up to 20 Apple credentials.
2. Deploy the authenticated `apple-credentials` and `apple-connect` Edge Functions, the updated `apple-test` function for saved IAP keys, and the web changes that use them.
3. Supply `SITE_URL` to Edge Functions. Webhook destinations are generated from this trusted server configuration and the stored app webhook key; clients cannot choose an arbitrary Apple notification destination.

Supabase manages Vault's encryption key; this feature needs no separate encryption-key environment variable. Anonymous and authenticated database roles cannot read Vault, the private credential table, or the service-only credential RPCs. The SQL test runner uses an explicitly test-only encrypted Vault stand-in on plain PostgreSQL; production requires the real Vault extension and never falls back to that fixture. [Supabase's Vault storage and access model](https://supabase.com/docs/guides/database/vault)

Each installation must apply the credential migrations and configure its own `SITE_URL`. Test Vault save, replacement, deletion and workspace isolation with disposable credentials. Customer-issued Apple credentials are needed to verify actual discovery/configuration and notification delivery.

Discovery uses `GET https://api.appstoreconnect.apple.com/v1/apps`. The response's `data[].id` is the numeric Apple ID and its attributes contain the app name, bundle ID and existing notification settings. Pages allow up to 200 apps; pagination is bounded and remains on the official Apple API host. [List apps](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps)

Configuration uses `PATCH https://api.appstoreconnect.apple.com/v1/apps/{id}` with this shape:

```json
{
  "data": {
    "type": "apps",
    "id": "1234567890",
    "attributes": {
      "subscriptionStatusUrl": "https://salebell.example/hooks/apple/APP_KEY/production",
      "subscriptionStatusUrlVersion": "V2",
      "subscriptionStatusUrlForSandbox": "https://salebell.example/hooks/apple/APP_KEY/sandbox",
      "subscriptionStatusUrlVersionForSandbox": "V2"
    }
  }
}
```

These four notification fields are official writable app attributes. [Modify an app](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_), [Writable app attributes](https://developer.apple.com/documentation/appstoreconnectapi/appupdaterequest/data-data.dictionary/attributes-data.dictionary), [Notification version enum](https://developer.apple.com/documentation/appstoreconnectapi/subscriptionstatusurlversion)

ASC requests use short-lived ES256 bearer JWTs with `kid` and `typ: "JWT"` in the header and `iss`, `iat`, `exp`, and `aud: "appstoreconnect-v1"` in the payload. The normal maximum lifetime is 20 minutes. An In-App Purchase JWT additionally uses `bid` for the bundle ID and has a maximum 60-minute lifetime. [ASC authentication](https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests), [Server API authentication](https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests)

A real Apple test uses `POST /inApps/v1/notifications/test` on `api.storekit.apple.com` or `api.storekit-sandbox.apple.com`. The returned token can be checked with `GET /inApps/v1/notifications/test/{testNotificationToken}`. A successful request means Apple accepted the test; its delivery can still fail. [Request a test](https://developer.apple.com/documentation/appstoreserverapi/request-a-test-notification), [Read test status](https://developer.apple.com/documentation/appstoreserverapi/get-test-notification-status)

Do not log request bodies, PEM keys or bearer JWTs, or return them in responses. Vault's encryption key must never reach browser clients. Decryption and replacement/deletion require authorization for the saved connection's workspace. Do not follow redirects when sending Apple credentials. Surface expired/revoked keys, insufficient permissions and rate limiting as actionable errors. Apple reports dynamic ASC limits in `X-Rate-Limit` and rejects excess requests with `429`. [Rate limits](https://developer.apple.com/documentation/appstoreconnectapi/identifying-rate-limits)
