# Salebell web

Marketing site and dashboard for Salebell, deployed on Vercel at https://salebell.vercel.app.
Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS 4, Supabase (`@supabase/ssr`).
The product contract is [`docs/PRODUCT.md`](../docs/PRODUCT.md).

## Run locally

Use Node.js 22.6+, the Supabase CLI and a running Docker daemon. From the repository root:

```bash
npm run dev
```

The command installs this app's dependencies on first use, starts Supabase, applies pending local migrations, generates `.env.local`, and runs the web app and Edge Functions. Open http://localhost:3000. Sign-in codes go to the local mail catcher (Mailpit, http://127.0.0.1:54324). No production credentials are needed.

Ctrl+C stops the development servers; `npm run dev:stop` at the root stops the database containers. If you only need the web server after the stack is prepared, run `npm run dev` from `web/`. After dependency changes, run `npm ci` here. `.env.example` documents hosted values; `.env.local.example` documents the generated local values. See [setup and launch verification](../docs/SETUP.md).

From `web/`:

```bash
npm run build   # production build + type check
npm run lint
npm test        # unit tests (node --test)
```

## Environment

Only public values live here; every secret is a Supabase Edge Function secret.

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Local Supabase API origin, or your hosted project's URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Local public key or hosted publishable key (`sb_publishable_…`); never a service-role key |
| `NEXT_PUBLIC_SITE_URL` | yes | Website origin; `http://localhost:3000` locally, your HTTPS origin in production. Used in webhook URLs, sitemap and OG tags |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | launch | Support contact on /privacy, /terms and the footer; hidden (with a build warning) when unset |
| `NEXT_PUBLIC_IOS_APP_URL` | no | App Store or TestFlight link for the iPhone app; until set, the UI says it's coming soon |
| `NEXT_PUBLIC_COMPANY_NUMBER` | launch | Company number shown on /privacy, /terms and the footer; `npm run build` warns while unset |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | launch | Registered office, shown with the company number |

## Layout

```
app/(marketing)/      /, /pricing, /docs, /privacy, /terms (static)
app/login/            email one-time code sign-in
app/app/              signed-in dashboard (client components, data via supabase-js + RLS)
  page.tsx            apps list; first-run onboarding when there are none
  new/                add app (wizard step 1)
  apps/[id]/          overview (KPIs, chart, live feed, CSV), setup, integrations, forwarding, settings
  billing/            plan, Stripe Checkout and portal via the `billing` function
  account/            sign out, workspace name, iPhone app, delete account via `delete-account`
proxy.ts              refreshes sessions, guards /app/**, redirects signed-in / to /app
lib/database.types.ts generated Supabase types plus app aliases
```

**Add app** shows **Connect store → Pick app → Connect app**: upload a team key, enter the Issuer ID and continue, select an app to advance, then connect. Saved teams load apps directly. Selection makes no database write; connection performs a fresh app lookup and guarded Apple setup. Verification and alerts each have their own task. Manual setup and expandable connection details remain available. [Setup guide](../docs/SETUP.md).

## Webhook proxy

App Store Connect posts to `<NEXT_PUBLIC_SITE_URL>/hooks/apple/<webhook_key>/<production|sandbox>`.
`next.config.ts` rewrites that path to `<SUPABASE_INTERNAL_URL or NEXT_PUBLIC_SUPABASE_URL>/functions/v1/apple-webhook/<key>/<env>`.
The web host proxies the method, headers and raw body unchanged. `apple-webhook` authenticates Apple's signature rather than a Supabase user JWT.

Smoke test (expects the function's own 404 JSON for an unknown key):

```bash
curl -i -X POST https://your-site.example/hooks/apple/notarealkey1/production -d '{}'
```

## Deploy

For production self-hosting, use [the Compose installer](../docs/SELF_HOSTING.md). For a managed-cloud deployment, configure your own Supabase project and web host with `web/` as the project directory. If using Vercel, link the intended project explicitly before deploying:

```bash
vercel deploy --prod
```

## Regenerating types

After a schema change, regenerate with `supabase gen types typescript --project-id YOUR_PROJECT_REF`, paste the `Database` type into
`lib/database.types.ts` and keep the aliases at the bottom.
