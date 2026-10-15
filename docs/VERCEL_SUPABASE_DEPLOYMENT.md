# Deploy Salebell to Vercel and Supabase

Vercel hosts your dashboard. Your own Supabase project hosts the database, authentication and backend functions. You can use the addresses supplied by those providers; you do not need to buy a domain or configure the two DNS names from the Docker guide.

The browser installer is implemented as a preview and remains disabled until its operator configures the OAuth integrations and qualifies a real installation. An inactive `/deploy` page explains this instead of starting a partial deployment. The manual steps below work independently of the browser installer.

## Browser installation

When the operator enables the installer:

1. Choose **Deploy Salebell** on the self-host page.
2. Sign in to Vercel and GitHub, create your repository/project, and create or connect a new, empty Supabase project through Vercel's Supabase integration. Review provider plan selections and charges.
3. Authorize the Salebell Vercel integration and select **Connect Supabase** for the organization containing your database.
4. Select your Salebell project. The installer checks the connection, applies migrations, deploys functions and configures sign-in. Keep the setup page open; return in the same browser to resume an interrupted installation.
5. Create your owner email/password and open the dashboard. Add your first app using the existing onboarding.

The OAuth applications are registered once by the Salebell installer operator. Every installing user grants access to **their own** provider projects. The operator's personal provider token is never substituted for a user's authorization. No OAuth client secret is copied into the user's deployment. Once installed, the instance runs independently of the installer service.

The first release accepts empty projects and resumes its own interrupted installations. It does not import or upgrade an existing Salebell database. Canceling stops setup and discards its stored provider credentials; it does not delete provider resources. Provider account connections last at most 24 hours before reconnection is required; the browser session expires after seven days. Recovery after that session expires is an operator task, not a fresh install over the existing database.

## Manual installation available now

### 1. Create and deploy your backend

Create a fresh Supabase project. With Node.js 22.6+ and the Supabase CLI installed, run from the Salebell repository root:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
npm run deploy:db
npm run deploy:functions
```

In that project's SQL Editor, select unrestricted instance mode and configure the scheduled exchange-rate job:

```sql
update private.instance_settings
set deployment_mode = 'self_hosted'
where singleton;

select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'project_url'
);
```

The Vault statement is for a fresh project; update the existing `project_url` secret instead when one already exists.

### 2. Deploy the dashboard

Import your Salebell repository into Vercel. Set **Framework: Next.js** and **Root Directory: web**. Add these production environment values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
NEXT_PUBLIC_SITE_URL=https://YOUR_VERCEL_PROJECT.vercel.app
NEXT_PUBLIC_DEPLOYMENT_MODE=self_hosted
```

Get the public key and project URL from Supabase's Connect/API settings. Use the actual production address assigned by Vercel. Vercel's production-host system variable can also supply the site origin on the first build; preview deployment URLs are not used for Apple notifications. Redeploy after changing public environment values.

Do not put a service-role key, secret key or provider token in a `NEXT_PUBLIC_*` value.

### 3. Configure sign-in

In Supabase **Authentication → URL Configuration**, set the Site URL to the Vercel production origin and add `https://YOUR_VERCEL_PROJECT.vercel.app/**` to allowed redirects.

Set the backend's website origin from your terminal:

```sh
supabase secrets set SITE_URL=https://YOUR_VERCEL_PROJECT.vercel.app \
  --project-ref YOUR_PROJECT_REF
```

Create a confirmed owner user with an email and password in Supabase **Authentication → Users**. Disable public signup for a private instance. Open the dashboard's `/login` and use that password. Password sign-in does not require SMTP; email codes and password-recovery mail do.

### 4. Verify the installation

The dashboard should show **Self-hosted** and an **Instance** tab. Add an app, make a sandbox purchase and verify the Apple event arrives through your Vercel address. Send a test to any alert destination you configure. The installer does not create Apple or messaging-provider credentials for you.

## Operator setup for the browser installer

These steps belong to the operator of the shared installer website. Installing users do not repeat them or share their private credentials with the operator in chat.

### Register the authorization apps

Register a Salebell **connectable Vercel integration**, with:

- A fixed Redirect URL: `https://YOUR_INSTALLER_HOST/api/deploy/vercel-callback`.
- Access to the selected project's integration configuration, project settings, environment variables and deployments. Environment access must include reading Supabase's public connection variables and writing the Salebell build values. Confirm these permissions against the live API before public launch.
- A public integration ID (`oac_…`), URL slug and server-only client secret.

Register a **Supabase OAuth app**, with:

- A fixed callback: `https://YOUR_INSTALLER_HOST/api/deploy/supabase-callback`.
- Project metadata read, database read/write, Auth read/write, Edge Functions read/write, and secrets/API keys read/write. It does not need project creation, organization administration or storage permissions.
- A client ID and server-only client secret. Supabase OAuth uses PKCE and a single-use state value.

These registrations identify Salebell's Connect buttons. They are separate from a user's personal access token and separate from creating the user's Vercel/Supabase projects.

### Configure the control database and host

Apply [`deploy/installer/control.sql`](../deploy/installer/control.sql) to the canonical installer's control database using its SQL Editor. This is separate from application migrations and must never run on an installing user's database. It creates private, service-only session/lease storage and schedules cleanup with `pg_cron` when available.

Set the server-only values documented in [`deploy/installer/.env.example`](../deploy/installer/.env.example) on the canonical Vercel project. Keep its normal website/Supabase public values configured too. Generate the installer encryption key with `openssl rand -hex 32`. Use a separate random cleanup secret. Never commit actual values.

`INSTALLER_RELEASE_REF` must be a full immutable commit containing the generated release assets and both the frontend and backend sources. `INSTALLER_SUPABASE_PRODUCT` is the actual product slug from the live Vercel Supabase integration, not an invented ID. The source link pins this commit, while selection verifies the deployed release fingerprint and records the clone's own commit ID for subsequent builds. A clone does not have to preserve the upstream commit ID.

Generate and check the tracked backend/frontend release manifest whenever release sources change:

```sh
npm run installer:assets
npm run installer:assets:check
```

Keep `INSTALLER_PUBLIC_ENABLED=false` during qualification. `INSTALLER_ENABLED=true` enables the direct preview page and APIs only on the exact configured origin; leave it false on other deployments. Account callbacks and the control database are for this host only. An installed user's site receives its own public connection values and a link back to setup, not the operator's credentials.

The control database removes encrypted credentials at completion/cancellation or their 24-hour expiry, and removes session records after seven days. Cleanup runs every 15 minutes when `pg_cron` is installed. If that extension is unavailable, schedule an authenticated GET to `/api/deploy/cleanup` with `Authorization: Bearer <INSTALLER_CLEANUP_SECRET>` in your operator scheduler. Expired credentials cannot be read even before cleanup runs. Finish or cancel active installations before rotating the encryption key: rotation invalidates their encrypted authorization records and may require operator recovery.

### Qualify before publishing the button

Complete a real fresh installation with disposable projects, verifying:

- The clone keeps the whole repository, uses `web/` as its build root and receives the expected native Supabase variables.
- The Salebell callback configures self-hosted/setup mode before the initial build. Initial visitors see setup rather than account registration.
- Both OAuth flows work for another user's permitted projects, including a Marketplace-created Supabase organization, without accessing the operator's own application project.
- Migrations, function source uploads and each function's authentication work with current Supabase signing keys. Protected handlers validate bearer tokens through Auth; webhooks use their own signed payload verification.
- Password login creates a workspace, anonymous data stays private, Realtime connects, the Vercel webhook proxy accepts a real Apple sandbox event and a configured alert arrives.
- Interrupted setup, failed builds, expired authorization and repeated owner submissions recover without resetting passwords or applying migrations twice.

Only then set `INSTALLER_PUBLIC_ENABLED=true` and rebuild the canonical website to expose **Deploy Salebell**. Do not describe mocked tests or a successful website build as proof of a real provider installation.

## References

[Vercel deploy buttons](https://vercel.com/docs/deploy-button), [Supabase on Vercel](https://supabase.com/docs/guides/integrations/vercel-marketplace), [Supabase OAuth applications](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration), [OAuth permissions](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes).
