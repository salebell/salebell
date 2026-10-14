-- Adapted from Supabase self-hosted/v0.8.1/docker/volumes/db/roles.sql (Apache-2.0).
\set pgpass `echo "$POSTGRES_PASSWORD"`
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
-- supabase_functions_admin belongs to the unused upstream database-webhook service.
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
