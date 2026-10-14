#!/usr/bin/env bash
# Applies real application migrations once, under a session advisory lock.
# Each file's contents and migration marker commit together; modified applied files fail.
set -euo pipefail
umask 077
sql_file=$(mktemp)
trap 'rm -f "$sql_file"' EXIT
cat > "$sql_file" <<'SQL'
\set ON_ERROR_STOP on
select pg_advisory_lock(hashtextextended('salebell-self-host-migrations', 0));
create schema if not exists private;
create table if not exists private.self_host_migrations (
  filename text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
revoke all on private.self_host_migrations from public, anon, authenticated, service_role;
SQL
for migration in /migrations/*.sql; do
  filename=$(basename "$migration")
  [[ "$filename" =~ ^[0-9]{14}_[a-zA-Z0-9_]+\.sql$ ]] || { echo "Invalid migration filename" >&2; exit 1; }
  checksum=$(sha256sum "$migration" | cut -d ' ' -f 1)
  # Existing migrations either have one BEGIN/COMMIT envelope or no envelope.
  # Reject extra transaction boundaries instead of silently losing atomicity.
  begins=$(awk 'tolower($0) ~ /^[[:space:]]*begin;[[:space:]]*$/ { n++ } END { print n+0 }' "$migration")
  commits=$(awk 'tolower($0) ~ /^[[:space:]]*commit;[[:space:]]*$/ { n++ } END { print n+0 }' "$migration")
  [[ "$begins" == "$commits" && "$begins" -le 1 ]] || { echo "Migration $filename has unsupported transaction boundaries" >&2; exit 1; }
  cat >> "$sql_file" <<SQL
begin;
do \$check\$ begin
  if exists (select 1 from private.self_host_migrations where filename = '$filename' and sha256 <> '$checksum') then
    raise exception 'Applied migration $filename changed. Restore the original file and add a new migration.';
  end if;
end \$check\$;
select exists (select 1 from private.self_host_migrations where filename = '$filename') as applied \gset
\if :applied
\echo Already applied $filename
\else
\echo Applying $filename
SQL
  # Remove only the standalone envelope; PL/pgSQL BEGIN statements have no semicolon.
  sed -E '/^[[:space:]]*[bB][eE][gG][iI][nN];[[:space:]]*$/d; /^[[:space:]]*[cC][oO][mM][mM][iI][tT];[[:space:]]*$/d' "$migration" >> "$sql_file"
  cat >> "$sql_file" <<SQL
insert into private.self_host_migrations(filename, sha256) values ('$filename', '$checksum');
\endif
commit;
SQL
done
cat >> "$sql_file" <<'SQL'
begin;
update private.instance_settings set deployment_mode = 'self_hosted' where singleton;
-- This value is used solely by pg_cron; never expose a private Docker URL to Apple.
do $vault$
declare secret_id uuid;
begin
  select id into secret_id from vault.secrets where name = 'project_url' limit 1;
  if secret_id is null then
    perform vault.create_secret('http://api-gw:8000', 'project_url', 'Internal URL for scheduled FX refresh');
  else
    perform vault.update_secret(secret_id, 'http://api-gw:8000');
  end if;
end
$vault$;
notify pgrst, 'reload schema';
commit;
select pg_advisory_unlock(hashtextextended('salebell-self-host-migrations', 0));
SQL
psql -X --no-psqlrc -q -v ON_ERROR_STOP=1 -f "$sql_file"
