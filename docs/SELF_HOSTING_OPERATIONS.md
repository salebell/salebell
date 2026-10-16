# Operate a self-hosted Salebell instance

Complete the [installation guide](SELF_HOSTING.md) first. Run the commands below from the repository root on your server.

## Configuration

The generated private `.env` contains your public site/API origins, database password, JWT signing secret, anon/service keys, owner email and optional provider settings. Keep it with your backups. Do not regenerate JWT or database credentials while keeping an existing database.

- **Public API:** `SUPABASE_PUBLIC_URL` is the API hostname reachable from browsers and the iPhone companion.
- **Website and Apple receiver:** `SITE_URL` is your website origin. Apple receives URLs under `https://salebell.example.com/hooks/apple/...`.
- **Internal services:** backend functions and Next.js rewrites use private Docker service URLs. Never paste these into App Store Connect or the iPhone Server settings.
- **Deployment mode:** migrations default to cloud for existing cloud deployments. The self-hosting installer explicitly selects `self_hosted` in the database. The safe `instance_settings` RPC exposes capabilities; browser flags cannot grant entitlements.
- **Web build values:** public URLs, deployment mode, operator details and the optional iPhone link are supplied at build time. Run `up` after changing them; restarting an existing image alone does not rebuild the browser bundle.
- **Telemetry:** self-hosted builds disable Vercel analytics and Next.js build telemetry. They still contact the providers you configure and the public exchange-rate source used for estimated USD revenue.

`deploy/.env` is dotenv data, not a shell script. Do not source it. The installer parses values without evaluating commands or substitutions. Keep generated keys private; only the anon key is intended for browser/mobile configuration.


## Optional email, iPhone alerts and operator details

Edit the private `deploy/.env`, then run `npm run self-host -- up`.

**SMTP:** configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL` and `SMTP_SENDER_NAME` to use email-code login. The stack serves the six-digit, 15-minute OTP template to Auth internally. Confirm actual delivery before relying on email sign-in. Setting `DISABLE_SIGNUP=false` opens registration; each new user receives an isolated workspace with self-hosted capabilities, so leave it closed for a private installation.

**iPhone push:** when your operator supplies a compatible shared-app distribution, open **Settings → Server**, enter this instance's public website/API URLs and public key, then sign in. Do not configure customer APNs secrets or install the operator-only relay schema. The shared app depends on the managed relay for push; its implementation is in the repository, but publication and live operation require qualification. See [connection, privacy and relay operations](PUSH_RELAY.md).

**Revocation outages:** sign-out and switching wait for central revocation. If the relay is unreachable, keep the pending operation and retry after connectivity returns. Automatic Auth loss clears the phone's active route immediately and blocks activating a replacement until revocation succeeds. An offline old customer backend cannot prevent central revocation. Do not delete Keychain control state as a workaround.

**Advanced private companion:** a separately built direct-APNs app can use your own Apple identity and backend `APNS_*` secrets through `register_push_device`. Leave `SALEBELL_PUSH_RELAY_ENABLED` unset on that independent backend. The managed shared-app backend blocks all legacy direct sends when this flag is true, so older managed companion versions must update and enroll again. APNs private keys never belong in `NEXT_PUBLIC_*`, an app bundle or a public issue.

**Public identity:** set `NEXT_PUBLIC_COMPANY_NAME`, optional company address/number, and `NEXT_PUBLIC_SUPPORT_EMAIL` to your operator's details. `NEXT_PUBLIC_SOURCE_URL` can point to your fork. Set `NEXT_PUBLIC_IOS_APP_URL` only to a qualified compatible App Store/TestFlight distribution; leave it empty when unavailable. Self-hosted privacy and terms pages describe the instance operator rather than presenting Salebell Cloud's infrastructure as yours.


## Installation checks and logs

```sh
npm run self-host -- status
npm run self-host -- check
```

`check` verifies password sign-in, workspace creation, self-hosted capabilities, anonymous data isolation, protected functions, disabled billing endpoints, the Apple webhook proxy and authenticated Realtime. It temporarily creates an app and removes it afterward. It does not verify public DNS or TLS, send a real purchase, or deliver an external alert; check those from your browser and configured providers.

If you change the owner's login password, update `deploy/owner-password` to match. Checks use this file; `up` and `upgrade` do not reset an existing account's password.

For the default installation, inspect service logs with:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yml logs --tail=100 proxy web auth
```

Review logs before sharing them: credentials and customer purchase data must stay private.

## Backups

```sh
npm run self-host -- backup
```

The command prints the location of a private, timestamped directory under `deploy/backups/`. Copy the **entire directory** to private storage outside the server. It contains:

| File | What it preserves |
|---|---|
| `database.dump` | Application data, Auth accounts and the migration ledger |
| `db-config.tar.gz` | Database configuration and encryption material for saved Vault secrets |
| `.env` | Installation credentials and provider configuration |
| `owner-password` | Password used for installation checks |

A database dump alone cannot recover encrypted Apple keys. Keep its matching credentials and Vault material. Record the source revision (`git rev-parse HEAD`) with each backup so you can restore using matching code and images.

## Updates

Choose and review the source version you want to install. With a clean checkout on a branch that tracks its remote, run:

```sh
npm run self-host -- backup
git pull --ff-only
npm run self-host -- upgrade
```

Copy the first backup off-server before continuing. `upgrade` takes another backup, pulls the images pinned by the checked-out source, rebuilds the web app, applies pending migrations and runs installation checks. It does not download new Salebell source code; that is what the Git update does.

Migrations are serialized and recorded with checksums. Do not edit an applied migration; add a new migration for schema changes. A Postgres major-version upgrade needs a separate migration procedure: do not attach an existing data volume to a new major version.

## Stop and restart

```sh
npm run self-host -- down
npm run self-host -- up
```

`down` stops containers and retains data, keys and certificates. Do not add `--volumes` to Docker teardown unless you intend to delete the installation's data.

## Use a different credentials directory

Add `--directory /absolute/private/path` to **every** installer command, starting with `init`. Configuration, the owner password and backups then live in that directory instead of `deploy/`.

For another independent installation, also pass a unique `--project` name to `init`; it gives Docker services and volumes a separate namespace. Use the matching env file and project when running Compose directly. Each installation needs its own server or an explicit plan for sharing ports 80 and 443.

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
