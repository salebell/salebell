# Self-host Salebell

Salebell is MIT-licensed software. A self-hosted installation includes all existing app, integration, retained-history and CSV features. You operate its infrastructure and credentials; there is no Stripe requirement or Salebell Cloud subscription.

**Available:** App Store Server Notifications V2 for in-app purchases and subscriptions. **Coming soon:** Google Play Real-time Developer Notifications (RTDN). Android setup is disabled until the receiver and purchase API enrichment exist. [RTDN roadmap](GOOGLE_PLAY_RTDN.md).

## Production prerequisites

- A server with Docker Engine and Docker Compose v2, and Node.js 22.6+ for the installer.
- Two distinct public HTTPS hostnames, such as `salebell.example.com` and `api.salebell.example.com`, with DNS records pointing to the server.
- Ports 80 and 443 reachable for Caddy's automatic HTTPS. No database, Studio or administration port needs public access.
- Persistent Docker volumes and a private off-server location for backups.

The stack uses pinned production Supabase components, Postgres, Next.js and Caddy. It omits unused Studio, Storage and analytics services. [Upstream versions and attribution](../deploy/UPSTREAM.md). Supabase CLI's local development stack is a separate tool and must not be exposed as a production deployment. [Official self-hosting guidance](https://supabase.com/docs/guides/self-hosting).

## Install

```sh
git clone https://github.com/salebell/salebell.git salebell
cd salebell
npm run self-host -- init \
  --site-url https://salebell.example.com \
  --api-url https://api.salebell.example.com \
  --email owner@example.com
npm run self-host -- up
```

No npm dependencies or Supabase CLI are needed on the server for the installer itself. Docker builds the web dependencies in its build container. `init` creates `deploy/.env` and `deploy/owner-password` with private permissions and refuses to replace an existing installation's secrets. The password and service keys are never printed by the installer.

Open your website and sign in with the configured owner email and the password saved in `deploy/owner-password`. Registration is closed by default. The owner is created through Auth's administrator API and its workspace is automatically provisioned. No email delivery is needed for password sign-in. Re-running `up` preserves the existing owner and password rather than resetting them.

For credentials outside the checkout, add `--directory /absolute/private/path` to **every** installer command. For a second independent installation, also give `init` a distinct `--project` name so Docker volumes and services do not collide.

## How configuration works

The generated private `.env` contains your public site/API origins, database password, JWT signing secret, anon/service keys, owner email and optional provider settings. Keep it with your backups. Do not regenerate JWT or database credentials while keeping an existing database.

- **Public API:** `SUPABASE_PUBLIC_URL` is the API hostname reachable from browsers and the iPhone companion.
- **Website and Apple receiver:** `SITE_URL` is your website origin. Apple receives URLs under `https://salebell.example.com/hooks/apple/...`.
- **Internal services:** backend functions and Next.js rewrites use private Docker service URLs. Never paste these into App Store Connect or an iPhone build.
- **Deployment mode:** migrations default to cloud for existing cloud deployments. The self-hosting installer explicitly selects `self_hosted` in the database. The safe `instance_settings` RPC exposes capabilities; browser flags cannot grant entitlements.
- **Web build values:** public URLs, deployment mode, operator details and the optional iPhone link are supplied at build time. Run `up` after changing them; restarting an existing image alone does not rebuild the browser bundle.
- **Telemetry:** self-hosted builds disable Vercel analytics and Next.js build telemetry. They still contact the providers you configure and the public exchange-rate source used for estimated USD revenue.

`deploy/.env` is dotenv data, not a shell script. Do not source it. The installer parses values without evaluating commands or substitutions. Keep generated keys private; only the anon key is intended for browser/mobile configuration.

## Connect an app

Use **Add app** to import an app with an App Store Connect API key or choose **Enter app details manually** without a key. Save any existing Apple receiver URLs as forwarding destinations before changing them. The automatic flow preserves supported existing destinations after review.

Alert channels are optional: receiving verified notifications and recording events works without them. Use a sandbox purchase or the optional In-App Purchase-key test to verify delivery. An accepted Apple test request is not proof that a notification arrived. [Full connection walkthrough](SETUP.md#connect-your-first-app-as-a-customer), [Apple keys and permissions](APPLE_AUTOMATION.md).

## Optional providers and operator details

Edit the private `deploy/.env`, then run `npm run self-host -- up`.

**SMTP:** configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL` and `SMTP_SENDER_NAME` to use email-code login. The stack serves the six-digit, 15-minute OTP template to Auth internally. Confirm actual delivery before relying on email sign-in. Setting `DISABLE_SIGNUP=false` opens registration; each new user receives an isolated workspace with self-hosted capabilities, so leave it closed for a private installation.

**iPhone push:** build [the companion source](../ios/README.md#self-hosted-companion) for your backend and Apple signing identity. Configure `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` and `APNS_KEY_P8` on the backend. `APNS_KEY_P8` can be a multiline quoted PEM value. Never place it in `NEXT_PUBLIC_*`, an app bundle or a public issue. The cloud-configured iPhone binary is not a universal self-hosted client; chat/webhook alerts work independently.

**Public identity:** set `NEXT_PUBLIC_COMPANY_NAME`, optional company address/number, and `NEXT_PUBLIC_SUPPORT_EMAIL` to your operator's details. `NEXT_PUBLIC_SOURCE_URL` can point to your fork. Set `NEXT_PUBLIC_IOS_APP_URL` only to a compatible companion build you distribute. Self-hosted privacy and terms pages describe the instance operator rather than presenting Salebell Cloud's infrastructure as yours.

## Check and maintain

```sh
npm run self-host -- status
npm run self-host -- check
npm run self-host -- backup
npm run self-host -- upgrade
```

`check` tests the actual internal deployment: owner password authentication, workspace provisioning, self-hosted settings, anonymous data isolation, protected functions, the Next.js Apple webhook proxy, and authenticated Realtime. It creates and removes a temporary app. It does not send a real Apple purchase, APNs push or external chat message, or prove public DNS/TLS. Verify these separately from your browser/phone when enabling the corresponding provider.

If you change the owner's login password, update the private `owner-password` file to match; `check` uses it. `up` and `upgrade` preserve existing accounts and do not reset credentials.

Migrations run in a serialized database session with a per-file checksum ledger. Applied files are not rerun; editing an applied migration fails rather than silently changing its meaning. Add a new migration for later schema changes.

`backup` writes a private timestamped directory under `deploy/backups/` with:

- `database.dump`: a PostgreSQL custom-format dump, including application/Auth state and the migration ledger.
- `db-config.tar.gz`: persistent database configuration and encryption material needed for saved Vault secrets.
- `.env` and `owner-password`: instance credentials and the bootstrap/check password.

Copy the entire backup directory to private off-server storage. A database dump without its matching credentials and Vault material is insufficient to recover encrypted Apple keys.

`upgrade` takes a backup, pulls the pinned service images from the checked-out source, rebuilds the web app, applies pending migrations and runs the installation check. Review the source update before running it. A Postgres major-version change requires its own documented database migration; do not point a new major image at an old data volume.

To stop services while retaining data, keys and certificates:

```sh
npm run self-host -- down
```

Do not add `--volumes` to Docker teardown unless you intentionally want to destroy the installation.

## Recovery

Restore into a separate installation first so the original data remains available. Retain the source revision and image versions used to make the backup. The sequence below was checked with the pinned images in `deploy/UPSTREAM.md`: it restores the matching secrets and Vault material before starting the fresh database, recreates the two runtime roles referenced by the dump, then restores into an empty database.

Run from the repository root at the backup's source revision. Use a **new directory and an unused project name**. This sequence replaces the recovery project's `postgres` database. Keep the original installation's volumes intact. If both projects run on the same server, stop the original with `down` before the final `up` to free ports 80/443.

```sh
set -eu
export BACKUP=/absolute/private/path/to/timestamped-backup
export RECOVERY=/absolute/private/path/to/new-recovery
export RECOVERY_PROJECT=salebell-recovery
mkdir -m 700 "$RECOVERY"
cp "$BACKUP/.env" "$RECOVERY/.env"
cp "$BACKUP/owner-password" "$RECOVERY/owner-password"
chmod 600 "$RECOVERY/.env" "$RECOVERY/owner-password"

# Give the copied credentials a distinct volume namespace without sourcing dotenv.
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { encodeEnv } from './scripts/self-host.mjs';
const path = `${process.env.RECOVERY}/.env`;
const values = parseEnv(readFileSync(path, 'utf8'));
values.COMPOSE_PROJECT_NAME = process.env.RECOVERY_PROJECT;
writeFileSync(path, encodeEnv(values), { mode: 0o600 });
JS

dc() {
  SALEBELL_DEPLOY_DIR="$RECOVERY" docker compose \
    --project-name "$RECOVERY_PROJECT" --env-file "$RECOVERY/.env" -f deploy/compose.yml "$@"
}

# Restore persistent encryption material before the first database start.
dc run --rm --no-deps --entrypoint sh -v "$BACKUP:/backup:ro" db \
  -c 'tar xzf /backup/db-config.tar.gz -C /etc/postgresql-custom'
dc up -d --wait --wait-timeout 180 db

# pg_dump contains database objects, but runtime-created cluster roles are separate.
dc exec -T db psql -X -U supabase_admin -d template1 -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin noinherit nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_functions_admin') then
    create role supabase_functions_admin noinherit createrole login;
  end if;
end $$;
SQL
dc exec -T db psql -X -U supabase_admin -d template1 -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE postgres WITH (FORCE)' \
  -c 'CREATE DATABASE postgres OWNER postgres TEMPLATE template0'
dc exec -T db pg_restore -U supabase_admin -d postgres --exit-on-error \
  < "$BACKUP/database.dump"
npm run self-host -- up --directory "$RECOVERY"
```

The final `up` checks the restored owner's password and workspace and retains the restored migration ledger. Confirm that a saved Apple connection can still be decrypted before directing production notifications to the recovery instance. Reconfigure public DNS/URLs deliberately if recovering onto a different hostname. Custom database roles or a different image revision require a matching recovery procedure; test recovery as part of operating the instance.

## Troubleshooting

| Symptom | Check |
|---|---|
| Docker cannot connect | Start Docker Engine/Desktop and check `docker info` |
| HTTPS site unavailable | Both DNS records, server ports 80/443, and Caddy logs |
| Password sign-in fails | Owner email and private password file; Auth health and logs |
| No email code | Configure and verify SMTP, or use owner password sign-in |
| UI still shows cloud limits | Database `instance_settings()` must return `self_hosted`; rebuild the web image with matching mode |
| Browser cannot reach API | Use public API hostname at build time, not `http://api-gw:8000` |
| Existing forwarding rejected | Check that it is an external HTTPS receiver, not this instance's own webhook or a private address |
| No Apple notification | Public HTTPS receiver URL, Version 2, correct environment and real App Store sandbox/production event |
| No iPhone push | Compatible build, APNs topic/team/key, device permission and matching sandbox/production gateway |

Use the Compose file in `deploy/compose.yml` and private env file when inspecting service logs. Review logs before sharing them; installation credentials and customer purchase data must stay private. [Security reports](../SECURITY.md).
