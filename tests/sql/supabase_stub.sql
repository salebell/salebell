-- Minimal stand-in for the pieces of Supabase the migrations depend on, so the
-- schema and RLS can be tested on plain PostgreSQL (see tests/sql/run.sh).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create publication supabase_realtime;
-- Supabase default privileges: API roles get full table access and RLS filters rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- TEST ONLY: Vault-compatible encrypted stand-in for plain PostgreSQL, which has
-- no supabase_vault extension. Never used by production migrations or functions.
-- The fixed test key deliberately lives only in this throwaway database fixture.
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as select s.*,
  extensions.pgp_sym_decrypt(decode(s.secret, 'base64'), 'SALEBELL_SQL_TEST_ONLY_NEVER_PRODUCTION') as decrypted_secret
  from vault.secrets s;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into vault.secrets(name, description, secret) values (new_name, new_description,
    encode(extensions.pgp_sym_encrypt(new_secret, 'SALEBELL_SQL_TEST_ONLY_NEVER_PRODUCTION'), 'base64'))
    returning id into v_id;
  return v_id;
end $$;
create function vault.update_secret(secret_id uuid, new_secret text default null,
  new_name text default null, new_description text default null)
returns void language plpgsql as $$
begin
  update vault.secrets set
    secret = case when new_secret is null then secret else
      encode(extensions.pgp_sym_encrypt(new_secret, 'SALEBELL_SQL_TEST_ONLY_NEVER_PRODUCTION'), 'base64') end,
    name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now()
    where id = secret_id;
end $$;
