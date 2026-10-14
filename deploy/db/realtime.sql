-- Adapted from Supabase self-hosted/v0.8.1/docker/volumes/db/realtime.sql (Apache-2.0).
create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;
