# Deploy Salebell to Vercel and Supabase

Prefer a custom server? The same backend works with a [VPS-hosted website](VPS_SUPABASE_DEPLOYMENT.md). The shared iPhone app implementation accepts instance details in **Settings → Server**; a compatible distribution and managed relay rollout still need live qualification. See the [deployment review](DEPLOYMENT_REVIEW.md).

Vercel hosts your dashboard. Your own Supabase project hosts the database, authentication and backend functions. They are separate services: Salebell connects them using your project's API URL and public key. You do not need Vercel's Supabase Marketplace integration, a shared OAuth app, a purchased domain or Docker.

## Guided installation

Install **Git** and **Node.js 22.6+** with npm, then run these commands on your computer:

```sh
git clone https://github.com/salebell/salebell.git salebell
cd salebell
npm run deploy
```

The installer uses your local **Vercel CLI** and **Supabase CLI** accounts. It reuses existing logins, or opens the providers' login flows when you are not signed in. If a CLI is missing, it offers to download the pinned version used by this installer. You do not send provider credentials to a shared Salebell website.

The guided prompts ask you to:

1. Choose your Supabase organization and create a project, or select an existing empty project. A single organization or team can be selected automatically.
2. Choose your Vercel team and a name for a new website project. New projects receive unique default names that you can keep.
3. Enter the email and password for your Salebell owner account.
4. Review the selected targets before installation.

Use provider accounts and organizations you control. Review the providers' plan limits and any charges when creating resources. The installer does not depend on Marketplace availability or combine your Vercel and Supabase billing.

It applies the database migrations, deploys backend functions, selects unrestricted self-hosted mode, configures the scheduled exchange-rate job and authentication URLs, sets the dashboard's public environment values, deploys the production website and creates your owner account. Public signup is disabled for the private instance. Password sign-in works without an email provider; email codes and password recovery require SMTP later.

Keep the terminal open until the checks finish. Open the production URL printed by the installer, then sign in at `/login` with the owner credentials you chose. Your website uses a Vercel-supplied address and your backend uses a Supabase-supplied address, so no DNS setup is needed.

### Check access or resume

```sh
npm run deploy -- --check
npm run deploy -- --help
```

`--check` checks CLI availability and provider authentication without creating or modifying provider resources. The installer keeps local checkpoints in the gitignored `.salebell-deploy` directory. If a step fails, rerun `npm run deploy` from the same checkout to resume. Keep this directory private and out of source control.

This is a fresh-install command, not a database import or upgrade tool. It must not be pointed at a database containing another application. An interrupted installation resumes its own migrations and checkpoints; stopping the installer does not delete your provider projects.

## After installation

The dashboard should show **Self-hosted** and an **Instance** tab. Add your app, make a sandbox purchase and confirm an Apple event arrives through your Vercel address. Send a test to any alert destination you configure. Successful infrastructure checks do not replace this real notification test.

Apple, Google Play and messaging-provider credentials remain optional app setup tasks. See [connect your first app](SETUP.md#connect-your-first-app-as-a-customer) and [the iPhone connection guide](../ios/README.md#self-hosted-companion). Enter website/API URLs and the public key in **Settings → Server**, then sign in to this backend. Customers do not publish an app or supply APNs secrets. [Managed relay rollout and privacy](PUSH_RELAY.md). A Salebell Cloud subscription and Stripe configuration are not required.

## Manual installation

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

## Previous browser installer

The earlier shared browser installer depended on Supabase OAuth and Vercel's native Supabase integration. It is superseded by `npm run deploy` and is not required for this installation. Do not register OAuth apps, enable `INSTALLER_*` settings or install `deploy/installer/control.sql` for the local CLI flow. The browser [design](VERCEL_SUPABASE_DEPLOYMENT_DESIGN.md) and [implementation plan](VERCEL_SUPABASE_DEPLOYMENT_PLAN.md) are retained as historical records.

## References

[Vercel CLI](https://vercel.com/docs/cli), [Supabase CLI](https://supabase.com/docs/reference/cli/introduction), [Supabase project API keys](https://supabase.com/docs/guides/api/api-keys).
