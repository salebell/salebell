# Salebell

**Open-source purchase alerts for your apps. Self-host it or use Salebell Cloud.**

**Import your iOS app → select it → start receiving App Store notifications.** Use an **App Store Connect API key** to import apps and set their notification URLs. An **In-App Purchase key** is only needed for optional Apple test notifications. Alert destinations are optional; Salebell records verified notifications without them. Android / Google Play is coming soon.

Salebell is MIT-licensed software for indie developers and studios. Run it on your infrastructure or use the optional managed cloud. Connect App Store Server Notifications V2 and get:

- a **"cha-ching" push** on your iPhone for in-app purchases, trials, renewals, refunds and billing issues
- **alerts** in Slack, Discord or Telegram, plus signed webhooks, PostHog and Pushover
- a **live revenue dashboard**: today, 7 days and 30 days in USD (estimated), with a chart and an event feed
- **forwarding**: keep your existing server URL. Salebell relays every raw notification unchanged.

Apps keep using native StoreKit 2. Salebell only consumes App Store Server Notifications V2, so it covers in-app purchases and subscriptions, not paid-app downloads.

Cloud: https://salebell.vercel.app · [Source](https://github.com/salebell/salebell) · [MIT license](LICENSE) · [Product contract](docs/PRODUCT.md)

## Self-host in production

Self-hosting includes all existing app, integration, retained-history and CSV features without a subscription or Stripe. You provide the infrastructure, credentials, updates and backups. Authentication, tenant isolation, Apple signature verification and rate limits still apply.

Use Docker Engine with Compose v2, Node.js **22.6+** for the installer, and two hostnames pointing to your server:

```sh
git clone https://github.com/salebell/salebell.git salebell
cd salebell
npm run self-host -- init \
  --site-url https://salebell.example.com \
  --api-url https://api.salebell.example.com \
  --email owner@example.com
npm run self-host -- up
```

The production Compose stack runs Postgres, Auth, REST, Realtime, Edge Functions, Next.js and an HTTPS gateway. It creates private instance credentials and an owner password file. Public registration is closed by default; SMTP and iPhone push are optional. [Operator guide: install, backup, update and checks](docs/SELF_HOSTING.md).

**Google Play RTDN for Android apps — coming soon.** The planned connection uses Google Cloud Pub/Sub and Google Play Developer API enrichment. This release has no Android receiver, Google credential collection or Android companion app. [RTDN roadmap](docs/GOOGLE_PLAY_RTDN.md).

The optional iPhone companion must be built for your backend and Apple signing/APNs identity. Chat and webhook alerts work without it. [Self-hosted iPhone instructions](ios/README.md#self-hosted-companion).

## Start using Salebell

Sign in with an email code, then **Add app**. Select a saved **App Store Connect API key** to load your apps, or upload its `.p8` and press **Load my iOS apps →**. Select your app and press **Start receiving notifications**. Use a team key with **Access: App Manager** (recommended) or **Admin**. Apple's filename supplies the Key ID; enter the Issuer ID once or reuse a known Apple team. If several teams are saved, choose the matching one. Your workspace is created automatically, and selecting an app uses no plan slot.

Each step shows one task. Supported existing servers stay connected; URL cards are under **Connection details**, and **Your server** shows App Store → Salebell → your server. **Check your connection** keeps the optional Apple test visible after a notification arrives. Its single key selector offers saved encrypted **In-App Purchase keys**, an upload, or one-time use. Alerts are optional; go to the dashboard anytime. Signed-in homepage visits go directly to `/app`. Android / Google Play is **Coming soon**.

**Enter app details manually** works without a key: enter the app name and bundle ID, save any existing server URLs under **Keep your existing server connected**, then paste Salebell's two URLs into App Store Connect with Version 2. Saved Apple keys can be replaced or deleted by workspace owners and admins. [Walkthrough](docs/SETUP.md) · [Apple permissions and automation](docs/APPLE_AUTOMATION.md).

## Develop locally

Install **Node.js 22.6+**, the **Supabase CLI 2.90+**, and **Docker Desktop** (or a compatible Docker daemon). Start Docker, then from this directory:

```sh
npm run dev
```

This installs web dependencies on first use, starts local Supabase, applies pending local migrations, selects self-hosted full access, generates `web/.env.local`, and runs the web app plus Edge Functions. Open **http://localhost:3000** and choose **Email me a code instead**. Email codes appear in the local inbox at **http://127.0.0.1:54324**. No hosted keys or provider accounts are needed to try sign-in and add an app. Use `npm run dev -- --cloud` to test cloud Free/Pro behavior locally. This development stack is not a production installation.

Ctrl+C stops the development servers. `npm run dev:stop` stops the local database containers while keeping your data. For setup without starting the development servers, use `npm run dev -- --setup-only`. Real Apple notifications, checkout and iPhone push require hosted provider setup below.

## Cloud plans

These limits apply only to Salebell Cloud. Self-hosted software has no commercial plan limits; the operator controls infrastructure capacity. Cloud subscriptions are separate from the MIT software license.

| | Free | Pro: $9/mo or $79/yr |
|---|---|---|
| Apps | 1 | Unlimited (fair use: 50) |
| iPhone push | ✓ | ✓ |
| Integrations | 1 | Unlimited |
| History | 30 days | Everything |
| Forwarding | ✓ | ✓ |
| CSV export | – | ✓ |

Launch code `FOUNDER`: 33% off forever for the first 100 customers.

## How it works

```
App Store ─▶ salebell.vercel.app/hooks/apple/<key>/<env>     (Vercel rewrite)
          ─▶ Supabase Edge Function apple-webhook
               1. look up the app by key
               2. verify the JWS chain to Apple Root CA G3, plus bundle id, environment and app id
               3. normalise to a store-neutral StoreEvent
               4. record_store_event(): event + ledger upsert (atomic, idempotent, ordered)
               5. 200 to Apple
               6. background: forward the raw body, Slack/Discord/…, APNs push, delivery log
Web (Next.js on Vercel) ─▶ Supabase (anon key + RLS) + functions billing / test-alert / delete-account
iOS app (SwiftUI)       ─▶ Supabase (anon key + RLS) + register_push_device
Stripe ─▶ stripe-webhook ─▶ accounts.plan
```

- **Idempotent and ordered**: Apple retries are safe, and older signed data never overwrites newer state.
- **Fail-safe**: database errors return 503 so Apple retries. Alert and forwarding failures never affect Apple's response.
- **Quiet backfills**: events signed more than 6 hours ago are recorded, but phones aren't alerted.

## Layout

| Path | What |
|---|---|
| `supabase/functions/_shared/core/` | Zero-dependency, runtime-agnostic core: Apple JWS verifier, event normaliser, alert channels, APNs client, forwarding, Stripe helpers |
| `supabase/functions/*` | `apple-webhook`, `test-alert`, `billing`, `stripe-webhook`, `delete-account`, `fx-refresh` |
| `supabase/migrations/` | Tenancy, plans and limits, push devices, history gating, FX rates, `app_overview`, RLS |
| `web/` | Next.js marketing site, docs and dashboard ([web/README.md](web/README.md)) |
| `ios/` | SwiftUI companion app with push and a Today widget ([ios/README.md](ios/README.md)) |
| `scripts/stripe-setup.mjs` | Idempotent Stripe products, prices, FOUNDER coupon and webhook endpoint |
| `scripts/dev.mjs`, `scripts/setup.sh` | Local development bootstrap and explicitly targeted hosted owner setup |
| `tests/` | `npm test` (Node) and `npm run test:sql` (schema and RLS on a throwaway local Postgres) |

## Cloud deployment

Cloud operators configure their own Supabase project and web host. Self-hosted operators use the production Compose setup above. The optional Salebell Cloud service is at https://salebell.vercel.app.

## Launch setup (owner)

Configure customer email first, then billing and push as needed. The owner script requires an explicit target and asks before each selected step:

```sh
npm run setup:owner -- --project-ref YOUR_PROJECT_REF --site-url https://your-site.example
```

For repeatable setup, copy `.env.setup.example` to `.env.setup`, fill in the target and credentials, then preview with `npm run setup:owner -- --env-file .env.setup --check`. Env files are never loaded automatically. [Setup guide and verification](docs/SETUP.md).

Use the [setup verification steps](docs/SETUP.md) to validate your own installation.

## Security model

- Customers authenticate with Supabase Auth. Every table has row-level security on account membership. Channel secrets are readable only by owners and admins, and plan and billing columns only by service_role.
- Webhook RPCs are `SECURITY DEFINER` and granted to `service_role` only.
- Payloads are trusted only after Apple signature, bundle-id and environment checks. Raw JWS is never stored or logged.
- Stripe events are trusted only after Stripe-Signature verification.
- Not yet: OCSP revocation checks, Vault-encrypted channel secrets.

## Run tests

See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and support, and [SECURITY.md](SECURITY.md) for private vulnerability reports.

```sh
npm test
npm run test:sql
npm --prefix web test
npm --prefix web run lint
npm --prefix web run build
cd ios && xcodegen && xcodebuild test -scheme Salebell -destination 'platform=iOS Simulator,name=iPhone 16'
```
