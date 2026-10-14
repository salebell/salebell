#!/bin/sh
set -eu
# Generated JWTs are base64url tokens, so they cannot inject sed expressions/YAML.
case "$SUPABASE_ANON_KEY$SUPABASE_SERVICE_KEY" in *[!a-zA-Z0-9_.-]*) exit 1 ;; esac
umask 077
sed -e "s/__ANON_KEY__/$SUPABASE_ANON_KEY/g" -e "s/__SERVICE_KEY__/$SUPABASE_SERVICE_KEY/g" /config/kong.yml > /tmp/kong.yml
exec /entrypoint.sh kong docker-start
