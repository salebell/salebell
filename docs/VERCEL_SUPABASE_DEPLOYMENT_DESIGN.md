# Browser deployment to Vercel and Supabase

> Archived (16 October 2026): the browser installer and its shared OAuth/native integration architecture are superseded by the local `npm run deploy` installer. The current [deployment guide](VERCEL_SUPABASE_DEPLOYMENT.md) uses each deploying user's Vercel CLI and Supabase CLI logins. No shared app registration or Marketplace integration is required. The remaining content records the earlier design and is not setup guidance.

Date: 2026-10-15
Status: Archived; superseded by the local guided CLI installer

## Intended outcome

A person clicks **Deploy Salebell**, authorizes their provider accounts, chooses their projects and creates their owner login. They receive a working instance on a Vercel production URL without terminal commands, SQL, copied API keys, DNS configuration or a Salebell subscription. Vercel and Supabase retain control of their own account creation, authorization, plan selection and charges.

The user approved the browser-only approach in chat. This document specifies that approach for review before implementation. It does not describe functionality that already exists.

Success means a fresh owner can sign in, add an app, receive an Apple sandbox notification through the Vercel URL and send a configured test alert. A deployed website or an empty database alone is insufficient.

## Current repository

- `scripts/self-host.mjs` and `deploy/` install a complete Docker Compose stack. That path remains available.
- The Vercel app is `web/`. `web/next.config.ts` currently requires three public environment values before building.
- `supabase/migrations/` and `supabase/functions/` contain the actual backend. `supabase/config.toml` specifies function JWT verification settings.
- `scripts/setup.sh` configures an already-deployed hosted project; it neither creates projects nor deploys the backend.
- Migrations default to cloud mode. Database `private.instance_settings` controls entitlements independently of `NEXT_PUBLIC_DEPLOYMENT_MODE`.
- Owner creation, migration tracking and installation checks already have useful examples in `deploy/bootstrap.mjs` and `deploy/migrate.sh`, but those scripts depend on the private Docker network and cannot be executed unchanged on Vercel.
- There is no deployment OAuth integration or browser installer today.

This design lives under `docs/` because this repository ignores `docs/superpowers/` as local agent material.

## Approach and alternatives

Use Vercel's repository deployment flow and native Supabase integration for creating resources and supplying connection settings. Add a Salebell installer for application provisioning and owner creation.

A bare Vercel deploy button is smaller but leaves backend installation to the user. A button followed by a terminal command is also smaller, but does not meet the accepted browser-only requirement. A fully custom project-provisioning platform would duplicate Vercel's repository, billing and Supabase resource flows. The selected approach reuses those provider flows.

## User journey

1. README and the website's self-host page link to **Deploy Salebell** on the canonical installer host. The page explains that this is an independent installation, with infrastructure charges handled by the providers.
2. Vercel's deployment flow clones the full repository, sets `web/` as the app root, and connects Supabase through its native integration. The user creates a Supabase project or connects an eligible empty project.
3. The user authorizes the Salebell Vercel integration for the selected project. After returning to the installer, they authorize the Salebell Supabase OAuth app for the corresponding organization.
4. The installer displays the verified Vercel and Supabase project names together. It installs the backend, configures the production origin and waits for a ready web deployment. Progress is shown as understandable steps with a retry action.
5. The user enters an owner email and password. The installer creates a confirmed user once and checks their workspace and password login.
6. The installer links to the instance's `/login`. Existing app onboarding handles Apple credentials, notification configuration and optional alert destinations.

Provider authorization screens and owner credentials are expected user actions. Product copy must describe this as guided browser deployment rather than promising a single unattended click.

## Architecture

### Provider integrations

Register one Salebell connectable Vercel integration and one Supabase OAuth app. Both use fixed HTTPS callbacks on the canonical installer host. OAuth client secrets belong only on that host, never in cloned repositories or user instances.

The Vercel integration supplies project-scoped authorization to inspect the selected project, configure its environment and root directory, and trigger/read deployments. Native Supabase provisioning remains the responsibility of Vercel's existing integration. The installer must not create another database when the native integration already created one.

The Supabase OAuth app requests the documented read/write permissions needed for project metadata, database queries, Auth configuration, Edge Functions and secrets/API keys. It does not request unrelated organization administration, storage or project creation permissions. Runtime authorization also binds every operation to the selected project; provider scopes alone are not a project-ownership check.

### Installer host

Implement opt-in installer routes in the existing web application, under `/deploy` and `/api/deploy/`. Enable them only on the canonical operator deployment using a server-side feature flag and an exact configured installer origin. Ordinary cloud and self-hosted instances do not expose an active installer.

Use a separate private control schema and separately applied installer migrations on the canonical host's database. Keep this schema out of ordinary application migrations. It records sessions, authorized project bindings, release identifiers, job steps, leases and sanitized results. No browser role receives table access.

Persist OAuth credentials encrypted with a dedicated server-side key only while installation is active. Delete credential ciphertext when installation succeeds, is canceled or reaches a 24-hour expiry. Retain nonsecret status records for seven days for authenticated resume, then remove them. A scheduled cleanup on the installer host enforces expiry even when the browser stays closed. Expired records are unusable immediately, independently of cleanup timing. Loss of authorization requires reconnection; it never falls back to an operator-wide provider token.

### Provisioning runner

Use authenticated, bounded server requests to advance a persisted job one step at a time. The browser polls status and requests advancement while setup is open. Closing the tab pauses advancement after the in-flight request; reopening resumes from the recorded state. Do not depend on in-memory state, local files surviving invocations, or background work after a response.

Use an atomic database lease with a fencing version for each job. Recheck the lease before committing progress. A unique active binding for a target Supabase project prevents separate sessions from provisioning it simultaneously. Transient provider errors use bounded retries and honor retry headers; permission failures stop for reconnection.

Release assets are generated from the repository's SQL, function and frontend sources with checksums and a pinned release identifier. The deploy flow clones the matching immutable release revision rather than a moving default branch. Include complete function dependency graphs and JWT settings. Bundle assets for server access; do not fetch arbitrary branch content or execute user-supplied SQL during installation. Verify the clone's deployed content fingerprint, record its own Git commit ID and use that ID for subsequent builds; repository cloning need not preserve the upstream commit history. The deployed dashboard and backend must match the same release identifier.

## Installation steps

### 1. Validate and bind resources

Treat deploy redirects and project IDs as untrusted hints. Resolve the project through the authenticated Vercel integration, then verify the connected Supabase reference through its server-side environment and Supabase OAuth access. Persist the verified binding before any mutation.

Accept a new or empty project and an interrupted installation with the same release manifest. Reject projects with unrelated application tables, conflicting function names, unknown Salebell migrations or existing owners outside this installation. Existing production instances require a future upgrade/import flow.

### 2. Configure the dashboard

Keep the full source repository, with `web/` as Vercel's Root Directory. Supply the current public Supabase URL and key from the native integration and select `self_hosted` mode explicitly. Do not copy database passwords or provider management credentials into public variables.

Resolve the production origin from authenticated Vercel project/deployment metadata. Support deriving `NEXT_PUBLIC_SITE_URL` from Vercel's production-host system variable during the initial installer deployment, with an explicit configured URL taking precedence. Apply this fallback only in the deployment path and validate it as an HTTPS origin. Do not derive notification origins from an incoming Host header or a preview URL.

The initial web deployment may show a setup-pending page while provisioning finishes. It must not need an initialized application schema to render that page or leak raw database errors. Once the final production origin is established, write the explicit site URL, rebuild, and configure the backend to the same origin. No manual URL entry is required.

### 3. Install database and instance settings

Apply ordered SQL migrations through the Supabase Management API. Record each filename and checksum transactionally with its changes, using database locking to prevent duplicate application. A lost response is reconciled by reading the migration marker. Changed already-applied SQL fails rather than being silently reapplied. The SQL wrapper must preserve existing migration transaction envelopes.

Select `self_hosted` in `private.instance_settings`. Upsert the Vault `project_url` used by the FX refresh schedule to the public Supabase origin. Reload PostgREST's schema and verify `instance_settings()` reports unrestricted mode and disabled billing.

### 4. Deploy functions and configure Auth

Deploy these application functions from the release manifest: `apple-webhook`, `apple-connect`, `apple-credentials`, `apple-test`, `test-alert`, `delete-account`, `fx-refresh`, `google-webhook` and `google-connect`. Exclude `billing` and `stripe-webhook` for this fresh self-hosted installation.

Use the documented Management API function deployment operation with complete source assets and each function's `verify_jwt` value from `supabase/config.toml`. Set `SITE_URL` to the verified Vercel production origin. Preserve runtime-provided Supabase credentials instead of replacing reserved environment values.

Configure Auth's site URL and redirect allow-list for that origin, keep email/password authentication enabled and disable public registration. Password login works without SMTP. Email codes and password-recovery email require a later email-provider setup.

Verify the target project's signing-key configuration works with the repository's authenticated-function JWT verification and server-side user checks. Modern signing keys must work or trigger a documented implementation correction; do not silently disable function verification globally.

Implementation correction: the six protected user functions authenticate bearer tokens through their existing Auth `getUser` boundary and enforce workspace permissions. Their individual legacy gateway checks are disabled in `supabase/config.toml` to support current signing keys. Anonymous rejection is tested for every handler; webhook signature checks remain separate.

### 5. Create the owner and finish

Allow owner creation only from the authenticated installation session that controls the bound projects. Create a confirmed user through the target Supabase Auth Admin API and verify automatic workspace provisioning. Hold the password only in request memory; never persist it in job state, logs or provider environment variables. Revoke temporary owner sessions used by installation checks and discard their tokens before returning a response.

Check existing user identity before a retry. Never reset an existing password. If creation succeeded but its response was lost, ask the same user to sign in and prove possession before finishing. Record successful completion, remove provider-token ciphertext and leave no public first-owner claim endpoint on the new instance.

## Security and failure behavior

- Bind OAuth state to the installer session, provider and intended project; require short expiry and single use. Use Supabase PKCE and exact callback matching.
- Authorize every status, advance, retry and owner request. Job IDs are not credentials. Protect mutation requests against CSRF and rate-limit authorization and owner creation.
- Verify any return origin from authenticated Vercel metadata. Constrain public health probes to that HTTPS origin and do not follow redirects into private networks or unrelated hosts.
- Keep keys, passwords, OAuth responses, database connection strings and SQL response bodies out of analytics and logs. Return classified errors and a correlation ID.
- Resume from verified provider/database state after timeouts. Do not automatically delete projects, databases or partially installed resources on failure.
- Once complete, the instance uses its own providers and credentials. Runtime login, notifications and alerts do not depend on the installer host.
- First release supports fresh installation and interrupted-install recovery only. Subsequent code pushes must not rerun privileged provisioning during the normal Vercel build.

## Repository changes anticipated

- README, `docs/SELF_HOSTING.md`, `docs/SETUP.md` and the self-host web page: describe Docker and browser deployments separately and expose the deploy entry point only after release qualification.
- `web/next.config.ts`, environment helpers and bootstrap page: validate the initial Vercel production origin and handle setup-pending state.
- New installer routes, focused provider clients, release-asset generation and persisted job orchestration modules.
- Separate operator installer schema/migrations and environment documentation, including OAuth registration and secret rotation.
- Meaningful tests for project binding, OAuth, migration reconciliation, duplicate jobs, retries and owner creation.

## Verification and release gates

Before publishing the public deploy entry point, register the operator integrations and demonstrate a complete installation in disposable provider projects. Account registration, secrets and provider charges are operator setup, not tasks delegated to every installing user.

The integration check must prove that Vercel's clone flow retains the backend source and sets the web root; the native integration provisions and supplies the expected variables; the Salebell integration can verify the selected Vercel project; Supabase OAuth can manage the Marketplace-created project; and function deployment accepts this repository's asset layout and JWT configuration. These are release requirements, not assumptions that mock tests can establish.

Automated verification covers denied/expired/replayed OAuth, mismatched projects, unauthorized job access, duplicate requests, partial SQL failures, lost provider responses, function deployment errors, closed-tab resume, and prevention of password resets. Run existing relevant backend tests plus web lint, tests and production build.

On a real fresh installation verify password login and workspace creation, database entitlement settings, anonymous data isolation, protected functions, authenticated Realtime, FX scheduling configuration and the Vercel Apple proxy. A real Apple sandbox event and a configured test alert complete the acceptance check; an accepted Apple test request is not proof of delivery.

Until those checks pass, report the browser installer as unreleased and keep the Docker and explicit manual hosted instructions usable. Provider registration or live-test access that is unavailable must be reported concretely rather than described as a working one-click deployment.

## Official references checked

- [Vercel Deploy Button](https://vercel.com/docs/deploy-button): repository cloning, integrations, products and deployment redirects.
- [Supabase Vercel Marketplace](https://supabase.com/docs/guides/integrations/vercel-marketplace): project creation, supplied environment variables and Marketplace constraints.
- [Supabase OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration): operator app registration, fixed callbacks, OAuth state and PKCE.
- [Supabase OAuth scopes](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes): management permissions.
- [Supabase Management API](https://supabase.com/docs/reference/api/introduction) and [function deployment](https://supabase.com/docs/reference/api/v1-deploy-a-function): backend provisioning interfaces.
- [Vercel integration requirements](https://vercel.com/docs/integrations/create-integration/submit-integration): operator integration setup and publication requirements.
