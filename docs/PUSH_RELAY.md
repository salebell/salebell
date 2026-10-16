# Shared iPhone app and push relay

The repository implements runtime server selection, the managed push relay, transport-aware backend dispatch and a Notification Service Extension. This does not establish App Store/TestFlight availability or that the production relay is enabled. Publish an installation link with `NEXT_PUBLIC_IOS_APP_URL` only after qualifying the signed build and relay on a physical device.

## Connect an independent instance

1. Install a compatible shared Salebell iPhone build from the distribution link supplied by your operator.
2. Open **Settings → Server** (also available before sign-in). Choose Salebell or enter your instance's HTTPS website URL, Supabase API URL and public/publishable key.
3. Sign in to that instance with its account credentials. Password sign-in does not require SMTP; email codes do. No separate managed Salebell login is needed.
4. Allow notifications, keep the app open while enrollment finishes, then send **a test cha-ching**. Enable sandbox alerts separately if needed.

Never enter a service-role/secret key or management token in the phone. Customer operators apply the normal application migrations and deploy the normal backend functions. They do not apply `deploy/relay/schema.sql`, publish another iPhone app or obtain Salebell's APNs key. The database, Auth and dashboard remain in their own infrastructure.

The app keeps one active backend/user route per installation. Switching or signing out drains registration and revokes the route through the trusted relay before completing the transition. Cleanup of an offline old backend is best effort; central revocation remains required. If the relay cannot confirm revocation, the transition reports a retryable error. Restore relay connectivity and retry. Automatic Auth loss clears the local active route immediately and prevents activating another route until pending revocation succeeds.

## Managed operator setup

These steps belong only to the operator of the shared Salebell app and relay. Verify the intended managed Supabase project and managed website before each change.

1. Apply the normal migrations to the managed Supabase project, including the relay-device transport migration. Then apply [`deploy/relay/schema.sql`](../deploy/relay/schema.sql) to that same project through its SQL Editor or a private database connection. This separate schema is operator-only and is excluded from customer installation assets.
2. Configure the managed project's Edge Function secrets: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC` for the signed shared app, plus `SALEBELL_PUSH_RELAY_ENABLED=true`. Keep the `.p8` only on operator infrastructure. The existing owner push setup can set the APNs secrets; it does not install or enable the relay.
3. Deploy `push-relay` and the updated Apple, Google and test-alert functions to that managed project. `supabase/config.toml` sets `verify_jwt=false` for `push-relay`: the handler authenticates installation control credentials, proof of APNs receipt and delivery capabilities, rather than customer Auth JWTs.

   ```sh
   supabase link --project-ref YOUR_MANAGED_PROJECT_REF
   supabase db push --linked
   # Apply deploy/relay/schema.sql separately, only to this managed database.
   # Configure the APNS_* secrets privately before enabling the relay.
   supabase secrets set --project-ref YOUR_MANAGED_PROJECT_REF SALEBELL_PUSH_RELAY_ENABLED=true
   supabase functions deploy push-relay --project-ref YOUR_MANAGED_PROJECT_REF --use-api
   supabase functions deploy apple-webhook --project-ref YOUR_MANAGED_PROJECT_REF --use-api
   supabase functions deploy google-webhook --project-ref YOUR_MANAGED_PROJECT_REF --use-api
   supabase functions deploy test-alert --project-ref YOUR_MANAGED_PROJECT_REF --use-api
   ```

4. Set the **private** `SALEBELL_PUSH_RELAY_ENABLED=true` environment variable on the managed web deployment, with its own configured Supabase API origin, then deploy the updated website. Do not use a `NEXT_PUBLIC_` flag. `/api/push-relay` forwards bounded POST bodies only to that project's `/functions/v1/push-relay`; it exposes no service key and follows no redirects.
5. Build and sign the shared app and Notification Service Extension with matching App Group access. The trusted endpoint defaults to `https://salebell.vercel.app/api/push-relay`. Only the app operator may change the compiled `PUSH_RELAY_URL`; server settings never override it. Qualify physical-device delivery before setting a distribution link or announcing availability.

Independent backends use that same trusted delivery endpoint by default. An operator-controlled `SALEBELL_PUSH_RELAY_URL` can override backend delivery; use HTTPS. `SALEBELL_DEBUG=true` permits HTTP only for loopback backend testing. It does not change the iPhone's trusted endpoint.

## Upgrade and direct APNs policy

Enabling `SALEBELL_PUSH_RELAY_ENABLED=true` on the managed backend blocks **all legacy direct APNs sends**, including tokens that have never enrolled with the relay. Older installed companion versions must update and enroll again before push works. This is an intentional compatibility break: keeping an unenrolled legacy send path would allow stale registrations to bypass central revocation during migration. Never re-enable managed direct sends to work around an enrollment issue.

Independent operators can retain direct APNs for an advanced, privately built companion that registers `transport=apns` through `register_push_device` and uses their own signing identity. Leave the managed relay enable flag unset on that independent backend. The shared app registers opaque capabilities with `register_relay_device`; direct registration is a separate app integration and requires an Apple developer membership and matching APNs topic. Neither transport falls back to the other after failure.

## Data and delivery boundaries

The customer backend stores its user's delivery capability, not the physical APNs token or relay control secret. Enrollment proves receipt of a random, expiring APNs challenge. The relay stores hashes of installation control secrets and delivery capabilities. It also stores the backend origin, user/route IDs, APNs token and route content key in its private schema; database backups must protect this material. These credentials are access restricted, but the content key is stored and must not be described as a hash or as encrypted-at-rest application data.

The relay sees each notification's title and body before encrypting sale content with AES-256-GCM. This is not end-to-end encryption from the customer backend to the phone. APNs receives a generic visible fallback and encrypted sale text. The extension decrypts only the active route; unknown, revoked or obsolete routes retain generic content without the sale sound or badge. An Apple-accepted push cannot be recalled, and iOS may skip extension execution, so late generic alerts remain possible.

Expiry and revocation invalidate delivery authorization; they do not delete the routing records, content keys or deduplication identifiers. The current schema has no automatic retention purge. Before live rollout, define and document the managed operator's removal/backup retention procedure. Deleting an account on a customer backend does not delete the relay's independent records.

Capabilities target exactly one active, unexpired route. Sender requests cannot choose a token, topic or recipient list. Workspace membership and per-device sandbox preferences remain authoritative at the customer backend; test alerts target only the caller's devices. Routes expire after 30 days and refresh during registration. Revoked/expired capabilities, stale revisions, malformed input and limiter/storage outages fail closed. A delivery capability authorizes delivery; it does not prove that a customer's reported sale occurred.

## Verify and operate

Before release, test production and sandbox APNs on physical devices using the exact signed app and extension. Verify enrollment, foreground/background enrichment, taps, token rotation, registration retries, workspace membership changes, account deletion, automatic Auth loss and switching between two backends with identical user UUIDs. Confirm that revoked and expired capabilities reject delivery and that managed legacy direct registrations cannot receive pushes.

Simulate the old backend being offline: the relay must still revoke its route and allow switching after central confirmation. Simulate a relay outage: registration fails, explicit sign-out/switch reports a retryable revocation error, and another route cannot activate until recovery. After restoring the relay, retry in the app rather than deleting installation control state. Do not copy control secrets, capabilities, content keys, APNs keys or payloads into support logs.

The dashboard and other alert channels continue to work during a relay outage. Protect private relay database backups, review sanitized function errors, and qualify schema/function changes before enabling them. Disabling the relay is an outage control, not a confirmed per-installation revocation: resolve pending revocations before claiming notifications have stopped. Local unit, SQL and simulator checks do not replace these live deployment and physical-device checks.
