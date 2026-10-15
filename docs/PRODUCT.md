# Salebell: product spec and build contract

> **Salebell**. Cloud site: `https://salebell.vercel.app`. iOS bundle id: `com.salebell.salebell`.
> Forwarding loop-guard header: `x-salebell-forwarded`. Stripe product: "Salebell Pro". The internal Supabase project keeps the name `salebell` (ref unchanged).

This is the single source of truth for every builder (backend, web, iOS) and reviewer.
If something here is wrong, tell the orchestrator. Don't diverge silently.

## 1. Positioning (CEO)

**One line:** Open-source purchase alerts for your apps. Self-host it or use Salebell Cloud.

**Deployment model:** MIT-licensed, self-hostable software with optional managed cloud. Production self-hosting uses the Docker Compose stack in `deploy/`, not the Supabase CLI development stack. See [SELF_HOSTING.md](SELF_HOSTING.md). Self-hosted installations have all existing app/integration/history/CSV capabilities without Stripe or a cloud subscription. Operators provide infrastructure, updates, backups and their own credentials.

**Who pays:** indie iOS developers and small studios (1–20 apps) who use native StoreKit 2 and
don't want RevenueCat/Adapty in their binary. They check App Store Connect several times a day
because Sales and Trends lags by a day. They want to *feel* every sale, and to catch refunds and billing issues.

**Product differentiation**
- Auditable code, a self-hosting option and optional managed operation; native StoreKit 2 remains in the customer app.
- Apple signature verification, normalized events, configurable destinations and existing-backend forwarding in one focused product.
- Do not claim competitors universally require an SDK: [RevenueCat supports SDK-less purchase tracking](https://www.revenuecat.com/docs/migrating-to-revenuecat/sdk-or-not/sdk-less-integration). Do not promise a fixed setup duration or assume these differences establish customer demand.

**Forwarding is a must-have.** App Store Connect allows one Production URL and one Sandbox URL.
Devs who already have a server URL can keep it: Salebell forwards every raw notification unchanged.
Without this, they can't adopt us. Forwarding is on every plan.

## 2. Cloud pricing and self-hosted access

The table below applies only to cloud deployments. Self-hosted software has no commercial plan limits, retained-history gating or CSV paywall. Capacity is the operator's responsibility. The software license is separate from hosted subscriptions.

| | Free | Pro |
|---|---|---|
| Price | $0 | **$9/month** or **$79/year** |
| Apps | 1 | Unlimited (fair use: 50) |
| iPhone push alerts (Salebell iOS app) | ✓ | ✓ |
| Integrations (Slack, Discord, Telegram, webhook, PostHog, Pushover) | 1 | Unlimited |
| Dashboard history | Last 30 days | Everything |
| Forwarding to your existing server URL | ✓ | ✓ |
| CSV export | – | ✓ |

The upgrade triggers: adding a 2nd app, adding a 2nd integration, viewing data older than 30 days, and CSV export.
Billing goes through Stripe Checkout and the Customer Portal. Only account owners manage billing.
Launch offer: Stripe promotion code `FOUNDER` (33% off forever, first 100 redemptions), so $6/mo for founding members.
Data is never deleted on downgrade. It's hidden and the extras pause, so re-upgrading restores everything.

**Honest coverage (CEO review, 2026-10-09):** App Store Server Notifications cover in-app purchases and subscriptions
(purchases, renewals, trials, refunds, billing issues), **not paid-app downloads**. All copy says "in-app purchase and
subscription events", never "every sale/download". ntfy is hidden from the UI because ntfy.sh rate-limits Supabase egress IPs. The backend keeps it.
Each integration shows its last delivery status (from `alert_deliveries`), so users can trust it.

## 3. Core user story (Product)

1. Land on the site, then **Start free**, then sign in with email (one-time code). An account (workspace) is created automatically. Returning signed-in visitors to `/` go directly to `/app`; other public pages remain available.
2. **Add app** defaults to **Connect store → Pick app → Connect app**, with one active task at a time. Upload a team App Store Connect `.p8`, enter the Issuer ID and press **Continue →**; the Key ID is inferred from Apple's filename. Credential JSON can include all three fields. A saved Apple team card skips upload and loads apps directly. Tap an app to advance immediately; selection does not create an app or use a plan slot. Search appears for longer lists.
3. Check the app and any existing server, then press **Connect app**, above expandable **Connection details**. Salebell finds or imports the app, requests a fresh server preview, and applies V2 settings with existing supported destinations preserved. Changed Apple settings stop setup for renewed review. Retries find the saved app first, and deleting an app frees its slot for re-adding; genuine new-app plan limits still apply.
4. **Set up manually instead** requires name + bundle ID; Apple ID is optional. Show **two URLs** with copy buttons in an App Store Connect style card:
   - Production: `https://<site>/hooks/apple/<webhook_key>/production`
   - Sandbox: `https://<site>/hooks/apple/<webhook_key>/sandbox`
   Plus exact App Store Connect steps (App → App Information → App Store Server Notifications → Version 2).
   **Keep your existing server connected** saves forwarding URL(s) before replacing the current Apple URLs. Press **I've saved both URLs →** to proceed.
5. **Check your connection** waits live (**Waiting for the first notification…**) and flips to ✓ Connected when a verified event lands. A successful configuration is shown separately from verified delivery. **Choose alerts →** continues while waiting; the Apple test is optional.
6. Choose Slack/Discord/etc., or the iPhone app when its distribution link is available. Selecting iPhone reveals its install/sign-in/test task. Alerts can be skipped for the dashboard; a **Send test alert** button checks a configured destination.
7. Dashboard: today / 7d / 30d gross sales (USD est.), purchases, trials, renewals, refunds, a daily chart, and a live event feed. Setup hides completed forms and collapses technical connection details.

Google Play **RTDN** is available in preview. Android apps use the usual app slot and package name, with service-account JSON upload, encrypted per-app credentials, automatic Pub/Sub setup or an existing-subscription option, and receipt verification. The final topic setting and test are completed in Play Console. Purchase and renewal prices come from verified Google orders, with charge deduplication and incremental refund accounting. Live Google validation remains pending; RTDN is a change signal, not a complete purchase record. [Roadmap and official references](GOOGLE_PLAY_RTDN.md). The dashboard stays at `/app` on the configured instance host.

In scope: optional team App Store Connect key import and encrypted saved connections with update/delete controls
for app discovery and notification URL setup,
plus separate optional In-App Purchase connections for Apple TEST notifications (saved or used once). Existing V1 receivers
require manual migration; V2 forwarding is preserved only after review. See [Apple automation](APPLE_AUTOMATION.md)
for the key types, supported API operations and security contract. Customer APNs keys are never needed for Salebell push.

Out of scope for the original v1: team invites, historical purchase backfill, a general-purpose
credential vault for unrelated systems, proceeds/tax math, email alerts, custom domains per tenant, widgets other than the one listed in iOS stretch.

## 4. Architecture

```
App Store ─▶ https://<site>/hooks/apple/<key>/<env>    (Vercel rewrite, proxy)
            ─▶ Supabase Edge Function apple-webhook      (verify → record → forward → alerts + APNs)
Web (Next.js on Vercel) ─▶ Supabase (anon key + user session, RLS) + Edge Functions (billing, test-alert, delete-account)
iOS app (SwiftUI)       ─▶ Supabase (anon key + user session, RLS) + register push device RPC
Stripe ─▶ Supabase Edge Function stripe-webhook ─▶ accounts.plan
```

Platform provider secrets live in Supabase Edge Function secrets (cloud) or private deployment environment/volumes (self-hosted). The web browser receives only public configuration. Self-hosting uses explicit public site/API URLs and internal service URLs; the latter must not appear in Apple's configured receiver URLs or the browser bundle. Vercel analytics is disabled in self-hosted mode.
Customer App Store Connect and saved In-App Purchase private keys are encrypted in Supabase Vault, with metadata in `private.apple_credentials`. Browsers can list connection metadata,
replace credentials and delete a saved connection, but cannot read private keys. Optional one-time In-App Purchase test uploads remain request-scoped.

- Cloud operators use their own Supabase project and web-host account. Apply the repository migrations and Edge Functions to that explicit target. Production self-hosting installs these through the Compose maintenance commands.
- Set `SITE_URL` and the matching public web configuration to your own HTTPS origin; select a suitable hosting region for your users.
- Supabase Auth: email one-time code (6 digits, template must show `{{ .Token }}`), site_url = SITE_URL, redirect allow-list includes SITE_URL/** and http://localhost:3000/**. Backend keeps this in `supabase/config.toml` and pushes it.
- iOS bundle id: `com.salebell.salebell` (configurable via xcconfig).

## 5. Data contract (backend owns, web and iOS consume)

Existing tables (see `supabase/migrations/20261009010219_init.sql`): accounts, account_members, apps, alert_channels,
store_events, store_transactions, alert_deliveries, view daily_revenue. Additions:

**accounts**: `plan text not null default 'free' check (plan in ('free','pro'))`, `stripe_customer_id text unique`,
`stripe_subscription_id text`, `subscription_status text`, `current_period_end timestamptz`.
Customers may update `name` only (column-level grant). Plan columns are written by service_role only.

**Instance mode:** `private.instance_settings(singleton boolean primary key, deployment_mode text)` is authoritative, defaulting to `cloud` for existing deployments. The production installer explicitly selects `self_hosted`; browser users cannot change it. `public.instance_settings()` returns only `{deployment_mode,billing_enabled}`. `private.plan_limit` and `private.history_scope` unlock self-hosted entitlements in the database. Web capabilities use the RPC rather than trusting browser build configuration. Self-hosted billing returns `billing_disabled`; Stripe events cannot change accounts. Existing cloud subscription records and account-deletion cancellation safeguards remain intact.

**Auto-provisioning**: a trigger on `auth.users` insert creates an account "My workspace" with the user as owner.
Clients never need to call create_account.

**apps**: `forward_url_production text`, `forward_url_sandbox text` (https only, nullable),
`last_event_production_at timestamptz`, `last_event_sandbox_at timestamptz` (set by record_store_event).
Free plan: max 1 app per account (enforced in DB with a clear error message `plan_limit:apps`).

**alert_channels**: kinds add `slack`, `discord`. Free plan: max 1 channel per account (`plan_limit:channels`).
Config shapes:
- slack `{ "webhook_url": "https://hooks.slack.com/..." }`, discord `{ "webhook_url": "https://discord.com/api/webhooks/..." }`
- telegram `{ "bot_token", "chat_id" }`, pushover `{ "token", "user" }`, ntfy `{ "topic", "server"? }`
- webhook `{ "url", "secret" }`, posthog `{ "api_key", "host" }`
When an account is over its plan's limit (after a downgrade), only the oldest N apps/channels stay active at dispatch time.

**push_devices**: `id uuid pk`, `user_id uuid → auth.users on delete cascade`, `token text unique`,
`apns_environment text check in ('sandbox','production')`, `sandbox_alerts boolean default false`,
`enabled boolean default true`, `app_version text`, `created_at`, `last_seen_at`.
RLS: a user sees and manages only their own rows.
RPC `register_push_device(p_token text, p_apns_environment text, p_app_version text) returns uuid` (authenticated, upsert, reassigns the token to the caller).
Pushes go to every enabled device of every member of the app's account. Sandbox events go only to devices with sandbox_alerts.

**History gating**: for free accounts, RLS hides store_events/store_transactions older than 30 days.

**Revenue in USD**: `fx_rates(currency text pk, usd_per_unit numeric, updated_at)` refreshed daily (pg_cron → edge function `fx-refresh`,
free no-key source covering all App Store currencies). View `daily_revenue` gains `gross_revenue_usd`.
Also view or RPC `app_overview` usable by web and iOS: per app today/7d/30d gross USD, purchases, trials, renewals, refunds, last event times.

**Edge functions**
| Name | Auth | Contract |
|---|---|---|
| `apple-webhook` | none (Apple JWS) | existing. Adds forwarding of the raw body to the env's forward URL (background, 10s timeout, logged), APNs push, slack/discord, plan gating |
| `test-alert` | user JWT | `POST {app_id}` sends a synthetic `test` event to the app's channels and the caller's devices. Returns per-channel results `{deliveries:[{channelId,ok,status,error}], push:{sent,failed}}` |
| `apple-credentials` | user JWT, owner/admin | List/save/replace/delete encrypted workspace ASC and IAP connections; return metadata only, never private keys |
| `apple-connect` | user JWT, owner/admin | `discover`, `preview`, `configure` actions use a saved `credential_id` to discover apps, review existing URLs/forwarding and apply V2 notification settings; destinations derive from server `SITE_URL` and the owned app |
| `billing` | user JWT, owner | `POST {action:"checkout", interval:"month"|"year"}` → `{url}`; `POST {action:"portal"}` → `{url}` |
| `stripe-webhook` | Stripe signature | syncs plan from checkout.session.completed and customer.subscription.* |
| `delete-account` | user JWT | deletes the caller's auth user and every account where they are the sole owner (needed for App Store guideline 5.1.1(v)) |
| `fx-refresh` | service/cron | refreshes fx_rates |

**Review round 1 contract changes (2026-10-09)**
- `accounts.cancel_at_period_end boolean not null default false`, synced from Stripe and readable by members like the other plan columns. Web shows "Pro until {date}. Won't renew."
- `test-alert` accepts `{app_id, target?: "all" | "push"}`. `"push"` sends only to the caller's devices (used by iOS "Send a test cha-ching" and the web iPhone card). There is one attempt per channel with no retry schedule. It is rate limited to 10 calls per minute per user, returning `429 {error:"rate_limited", retry_after}`. Errors are generic: `connection_failed`, `timeout`, `http_<status>`, `blocked_destination`, `paused_on_free`.
- Outbound URLs (forward URLs, webhook, ntfy server, PostHog host) must be https and must not be an IP literal, localhost or a private, link-local or loopback address. This is checked in the DB on write and again at send time. Redirects are not followed.
- Customers can no longer insert or update `account_members`; they can only delete their own row.
- USD always counts as 1.0 in revenue math, even when `fx_rates` has no USD row.
- iOS App Review: email + password sign-in stays enabled so the owner can create a reviewer demo account. iOS has a discreet "Use a password" option on sign-in.

Secrets (set by the owner, documented in README): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_YEARLY`, `SITE_URL`, `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (= iOS bundle id).
Every function must degrade cleanly when its secrets are missing (clear 503 message, never crash the webhook).

## 6. Quality bar
- Every new behaviour has tests (`npm test`, `npm run test:sql`). Keep the zero-dependency core style.
- Security: RLS on every table, no secret readable by non-owners, Stripe/Apple signatures verified, no raw JWS stored.
- Web: fast, accessible, responsive (works at 375px), dark mode, no placeholder lorem ipsum, no fake testimonials or fake logos.
- Copy is honest: never claim features that don't exist.
- No references to any other product of the owner, by name or id.
