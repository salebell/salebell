#!/usr/bin/env bash
# Runs the migrations + schema tests against a throwaway local PostgreSQL 15+.
# Usage: tests/sql/run.sh            (needs initdb/pg_ctl/psql on PATH, in a standard
#                                     install location, or PG_BIN set)
set -euo pipefail
cd "$(dirname "$0")/../.."
find_bin() {
  if [[ -n "${PG_BIN:-}" ]]; then echo "$PG_BIN"; return; fi
  if command -v initdb >/dev/null; then dirname "$(command -v initdb)"; return; fi
  local c
  for c in /usr/lib/postgresql/*/bin /Library/PostgreSQL/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
    [[ -x "$c/initdb" ]] && last="$c"
  done
  [[ -n "${last:-}" ]] || { echo "PostgreSQL binaries not found; set PG_BIN" >&2; exit 1; }
  echo "$last"
}
BIN="$(find_bin)"
DIR="$(mktemp -d)"; PORT="${PG_PORT:-55432}"
trap '"$BIN/pg_ctl" -D "$DIR" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$BIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f tests/sql/supabase_stub.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f tests/sql/schema_test.sql
"${PSQL[@]}" -f deploy/relay/schema.sql
"${PSQL[@]}" -f tests/sql/relay_test.sql
"${PSQL[@]}" -f deploy/installer/control.sql
"${PSQL[@]}" -f tests/sql/installer_test.sql
"${PSQL[@]}" -c 'create database salebell_browser_install_test'
sed '/^create role /d' tests/sql/supabase_stub.sql | "${PSQL[@]}" -d salebell_browser_install_test
BROWSER_PSQL_BIN="$BIN/psql" BROWSER_PGHOST="$DIR" BROWSER_PGPORT="$PORT" node --experimental-strip-types --no-warnings tests/sql/browser_installation_test.mjs
