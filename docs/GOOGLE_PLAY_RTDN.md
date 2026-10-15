# Google Play RTDN

**Status: preview, with Android onboarding.** Choose **Android / Google Play**
when adding an app, upload a service-account JSON key, and select an accessible
app. Salebell can configure authenticated Pub/Sub delivery, or
guide you through connecting an existing subscription. Finish by saving the topic
in Play Console and sending a test. Live Google validation is still pending.
This monitors apps already using Google Play Billing; it does not replace the
billing client or include an Android companion application.

```text
Google Play Console → Cloud Pub/Sub topic
                    → authenticated, wrapped push subscription
                    → /functions/v1/google-webhook/<app-key>
                    → Google Play Developer API v2 purchase lookup
                    → orders.get charged price / refund history
                    → durable event → integrations and optional iPhone push
```

RTDN supplies a change signal. Complete purchase status comes from a subsequent
[Play Developer API lookup](https://developer.android.com/google/play/billing/rtdn-reference).

## Implemented behavior

- Google-signed RS256 OIDC verification with rotating public keys, valid token
  times, issuer, exact configured audience, verified email and exact push service
  account. Temporary key service failures return 503; invalid tokens return 401.
- Exact app package and Pub/Sub subscription checks, bounded request bodies and
  strict decoding of the wrapped base64 payload. Unwrapped delivery is unsupported.
- Subscription and one-time product v2 API lookups using a separately configured
  Play service account. Voided purchases use the corresponding purchase lookup.
  Test notifications skip purchase lookup. Pending refund reviews are retained as
  `other` events; Salebell does not submit a refund-review response.
- A stable UUID derived from subscription and Pub/Sub message ID. Previously
  recorded deliveries skip the Play API; atomic inserts resolve concurrent
  duplicates. Google gets 204 only after recording or finding an existing event.
  Database and API failures return 503, including permission/configuration errors
  that an operator can fix before replaying the notification.
  For a voided purchase whose token Google has permanently discarded (HTTP 410),
  a previously verified environment for the same app/token hash permits a refund
  lookup by its explicit order ID, retaining the verified order price and product.
  Without prior history it stays retryable for dead-letter recovery; no environment
  is guessed.
- Shared tenant isolation, retained-history rules, cloud/self-hosted plan limits,
  integration dispatch and optional APNs fan-out. Duplicate events do not alert
  again; history older than six hours does not push to phones.
- Workspace owner/admin app discovery through the Play Developer Reporting API,
  followed by setup through `google-connect`, with encrypted Vault
  credentials and metadata-only responses. Stored events contain allowlisted
  purchase metadata and a SHA-256 purchase-token hash. Raw purchase tokens, OAuth
  tokens, service-account keys and raw API responses are not stored in event history
  or logged.

Purchase and renewal prices come from the verified order's `total`: the customer
amount paid, including discounts and tax, in its original currency. This is gross
customer spend, not the developer payout. The same event revenue field powers the
event feed, integrations, phone alerts and existing revenue analytics. Google Money
values are rounded to the shared ledger's three decimal places using integer
arithmetic. Catalog and recurring prices are never used as charged amounts.
[Google order totals and refund history](https://developers.google.com/android-publisher/api-ref/rest/v3/orders).

Persistent private order accounting, scoped to app and environment, records a
charge once even when notifications have different message IDs. Completed refund
history supplies cumulative refunds; only the new increment is recorded as negative
revenue and sent in alerts. A full refund after partial refunds deducts only the
remaining amount. Duplicate monetary notifications keep delivery history as `other`
without repeating revenue, purchase/refund counts or alerts. Accounting claims
survive event-history retention and are removed when the app is deleted.
Zero-price subscription orders explicitly marked as free trials become
`trial_started` events with a verified zero amount.

Order IDs, purchase tokens and charge products are checked against the purchase
lookup. Only allowlisted order totals are retained, never raw orders, buyer
addresses or purchase tokens. Order API or invalid-data failures return 503 for
Pub/Sub retry instead of acknowledging a missing price. Nonfinancial lifecycle
events and Console delivery tests have no monetary amount.

An API response is the current purchase snapshot, even for delayed RTDNs. Events
preserve the notification timestamp; Salebell does not apply notifications as an
entitlement state machine. The latest subscription order is assigned only after
verifying its processed timestamp is no later than the notification. An older RTDN
resolving to a newer order retains an unknown amount (`priceUnavailable: newer_order`).
Multi-item subscriptions sharing one order use that total once and leave the
singular product field unknown. Items pointing to different latest orders, or
purchases without an order ID, retain unknown amounts rather than combining
unrelated charges. Replacement-token lineage is deferred. `SUBSCRIPTION_RECOVERED`
also covers resuming from pause, so it is recorded as `other`, without implying a
payment. Google alpha-2 billing regions remain snapshot metadata instead of being
put into the alpha-3 storefront field.

## Connect an Android app

1. Create or select a Google Cloud project. Enable the **Google Play Developer
   Reporting API**, **Cloud Pub/Sub API**, and **Google Play Android Developer
   API**. Create a service account and download a
   JSON private key under its **Keys → Add key → Create new key** menu.
2. In **Play Console → Users and permissions**, invite the service-account email
   and grant it access to this app's purchase information. Google recommends
   **View financial data, orders, and cancellation survey responses** and
   **Manage orders and subscriptions** for billing API access.
   [Play API access](https://developers.google.com/android-publisher/getting_started).
3. In Salebell, choose **Add app → Android**, upload the JSON file, and load your
   apps. Salebell uses the Reporting API's
   [apps.search](https://developers.google.com/play/developer/reporting/reference/rest/v1beta1/apps/search)
   endpoint to list apps the service account can access. Search or load more apps,
   then select one and continue. The app uses the same workspace and plan limits
   as iOS. The key stays in browser memory during selection and is stored encrypted
   only when you save the connection; it cannot be downloaded from the dashboard.
   If Reporting API access is unavailable, use manual app entry with the exact
   package name and upload the key on the app's Setup page instead.
4. Choose automatic setup or the existing-subscription option below. Saving setup
   does not prove delivery; the page stays waiting until a verified event arrives.
5. In **Play Console → your app → Monetize → Monetization setup**, enable RTDN,
   paste the topic shown by Salebell, choose subscription and one-time product
   notifications as needed, and save. Send a test from Play Console, then check
   Salebell for confirmed receipt. This final step happens in Play Console.
   [Google RTDN setup](https://developer.android.com/google/play/billing/getting-ready#configure-rtdn).

### Automatic Pub/Sub setup

The uploaded service account must belong to the Google project in its JSON file.
Also enable the **IAM API** and **Cloud Resource Manager API** for automatic
administration. In addition to its Play access, grant:

| Scope | Access needed |
|---|---|
| Google project | Pub/Sub Admin (`roles/pubsub.admin`) and project metadata read (`resourcemanager.projects.get`, included in Browser) |
| The uploaded service account itself | Service Account User (`iam.serviceAccounts.actAs`) and service-account IAM policy read/write (`roles/iam.serviceAccountAdmin`, scoped to that account) |

For a new Pub/Sub project, initialize Google's service agent using Cloud Shell:

```sh
gcloud beta services identity create --service=pubsub.googleapis.com --project=YOUR_PROJECT_ID
```

Salebell creates a dedicated topic and wrapped push subscription, authorizes the
Google Play publisher on that topic, and grants the Pub/Sub service agent permission
to mint OIDC tokens for the push account. It preserves unrelated IAM bindings and
refuses to overwrite existing resources with conflicting delivery settings.
The receiver URL and OIDC audience are derived by the server from your app.
The subscription uses a 60-second acknowledgement deadline and retry backoff.
[Authenticated push permissions](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions),
[Pub/Sub access control](https://cloud.google.com/pubsub/docs/access-control).

App discovery uses the `playdeveloperreporting` OAuth scope. Cloud setup requests
use `cloud-platform`; purchase lookups use `androidpublisher`. Google IAM and
Play Console permissions still restrict the
operations those tokens can perform.

### Use an existing topic and subscription

If Play Console already publishes RTDN for another backend, keep that topic and
add a separate Salebell push subscription. This keeps other consumers connected.
The manual option needs only the Play lookup key plus the topic, subscription
resource name and push service-account email. It does not administer Google Cloud
resources using the uploaded key.

Create a **wrapped**, authenticated push subscription with the receiver URL,
audience and push account shown in Salebell. Give the Google Play notification
publisher access to the topic and give the Pub/Sub service agent Token Creator
access on the push account. Copy the full topic and subscription resource names
into Salebell. Configure retries and a dead-letter topic for deliveries requiring
operator recovery, such as expired purchase tokens without prior history.

Disconnecting removes Salebell's saved key and connection; Google Cloud resources
remain in your project. Changing a connected package name requires disconnecting
first. Repeating identical setup preserves previously verified delivery; changing
credentials or delivery settings requires a new notification.

## Deploying the feature

Apply the migrations through `20261015160000_google_play_order_revenue.sql`, and
deploy `google-connect` and `google-webhook` alongside the web app. Both functions
are included in the self-hosted router. `google-connect` requires user
authentication and workspace admin access; `google-webhook` verifies Google's
OIDC token instead of a Supabase JWT. For self-hosting, `SUPABASE_PUBLIC_URL` must
identify the public HTTPS API; local HTTP cannot receive Google's push delivery.

For an existing installation, apply the order-revenue migration before deploying
`google-webhook`. The service account needs **View financial data, orders, and
cancellation survey responses** in Play Console; order lookups use the same
Android Publisher API and OAuth scope as purchase lookups. New financial
notifications then include verified prices. Events recorded by the earlier preview
remain unchanged; historical price backfill is not automatic.

### Operator-only provisioning

The original service-role RPC remains available for scripted installations:

1. Apply the database migrations and deploy `google-webhook`. The Supabase config
   disables Supabase JWT verification for this function because its handler verifies
   Google's OIDC token. The self-hosted function router also includes it.
2. Enable the Google Play Developer API and grant the purchase lookup service
   account access to the app in Play Console. API enablement alone does not grant
   Play Console access. [Google API setup](https://developers.google.com/android-publisher/getting_started).
3. Create a Pub/Sub topic and give
   `google-play-developer-notifications@system.gserviceaccount.com` permission to
   publish. Enter the topic in the app's Play Console RTDN settings and enable the
   desired subscription and one-time product notifications.
   [RTDN setup](https://developer.android.com/google/play/billing/getting-ready#configure-rtdn).
4. Using trusted operator tooling, create an app in the intended workspace with
   `store = 'play_store'`, `package_name = '<Android package name>'`,
   `bundle_id = '<same Android package name>'`, and `apple_app_id = null`. The
   legacy `bundle_id` column remains the required display identifier. Existing
   apps default to `app_store`; Apple and Google receivers use separate lookups.
5. Call `save_google_play_connection` as `service_role`, supplying:

   | Argument | Value |
   |---|---|
   | `p_app_id` | The new app UUID |
   | `p_audience` | The exact public HTTPS receiver URL, or another explicitly configured HTTPS audience |
   | `p_service_account_email` | The service account used to authenticate Pub/Sub push |
   | `p_subscription` | Full `projects/<project>/subscriptions/<subscription>` resource name |
   | `p_credentials` | Play API service-account JSON, securely read from its key file |

   The push identity and Play API account may differ. The RPC encrypts the key
   JSON in Vault; repeated calls replace configuration and rotate the existing
   secret. It is unavailable to signed-in browser clients. Removing the connection
   through privileged SQL or deleting the app also removes its Vault secret.
6. Configure **wrapped** Pub/Sub push to
   `https://<api-host>/functions/v1/google-webhook/<app-key>`. Enable OIDC using the
   exact service account and audience saved above. Set an acknowledgement deadline
   that allows the synchronous API/database work (60 seconds is suitable for the
   current request timeouts), plus retry and dead-letter handling. Configure the
   Pub/Sub service agent's token-minting permission for the push identity.
   [Authenticated push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions),
   [push acknowledgement and retries](https://cloud.google.com/pubsub/docs/push).
7. Send a test from Play Console and confirm a `play_store` / `test` event, then
   exercise license-tester subscription/product purchases. Actual test purchases
   use Sandbox based on Google's purchase response; the Console delivery test has
   no purchase environment and is recorded in Production. Confirm redelivery does
   not add an event or repeat an alert. Fix failed API permissions or unavailable
   purchases before replaying messages from the dead-letter topic.

Google forwarding uses Pub/Sub fan-out: keep other consumers on their own topic
subscriptions. The receiver does not use Apple's raw-body forwarding settings.

## Work remaining after preview

- Live Google delivery validation for subscriptions, products, voided and test
  notifications, and expired/inaccessible purchase tokens.
- Historical price backfill and order reconciliation for delayed notifications
  whose purchase lookup already points to a later order.
- Accounting across multi-item subscriptions with distinct latest orders, and
  replacement-token lineage.

Local validation: `npm test`, `npm run test:sql`, and
`deno check --node-modules-dir=none supabase/functions/google-connect/index.ts supabase/functions/google-webhook/index.ts`.
Unit tests use synthetic RSA identities and stubbed Google HTTP responses; SQL
tests use a throwaway database and a Vault API stub. No live credentials are needed.
