-- Google Play RTDN foundation. Operators configure push verification metadata;
-- Publisher service account JSON remains encrypted in Vault. Google notifications
-- share event history and alert gating, without inventing transaction revenue.
begin;

alter table public.apps
  add column store text not null default 'app_store' check (store in ('app_store','play_store')),
  add column package_name text,
  add constraint apps_store_identifier_check check (
    (store = 'app_store' and package_name is null)
    or (store = 'play_store' and package_name is not null and apple_app_id is null
      and octet_length(package_name) <= 255
      and package_name ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
      and bundle_id = package_name)
  ),
  drop constraint apps_account_id_bundle_id_key,
  add constraint apps_account_store_bundle_id_key unique (account_id, store, bundle_id);

-- Store is chosen at creation and cannot be changed by a browser client.
grant insert (store, package_name) on public.apps to authenticated;
grant update (package_name) on public.apps to authenticated;

create table private.google_play_connections (
  app_id uuid primary key references public.apps(id) on delete cascade,
  audience text not null check (private.is_public_https_url(audience)),
  service_account_email text not null check (
    length(service_account_email) <= 254
    and service_account_email ~ '^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$'),
  subscription text not null check (
    length(subscription) <= 512
    and subscription ~ '^projects/[a-zA-Z0-9][a-zA-Z0-9._~+%-]*/subscriptions/[a-zA-Z][a-zA-Z0-9._~+%-]*$'),
  vault_secret_id uuid not null unique references vault.secrets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.google_play_connections enable row level security;
revoke all on private.google_play_connections from public, anon, authenticated, service_role;

create function private.delete_google_play_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end $$;
revoke all on function private.delete_google_play_secret() from public, anon, authenticated, service_role;
create trigger google_play_connections_delete_secret after delete on private.google_play_connections
  for each row execute function private.delete_google_play_secret();

create function public.save_google_play_connection(p_app_id uuid, p_audience text,
  p_service_account_email text, p_subscription text, p_credentials jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_store text;
  v_secret uuid;
  v_name text := 'salebell/google-play/' || p_app_id::text;
begin
  -- Serialize configuration updates and app deletion before touching Vault.
  select a.store into v_store from public.apps a where a.id = p_app_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  if v_store is distinct from 'play_store' then
    raise exception using errcode = '22023', message = 'platform_mismatch';
  end if;
  if p_audience is null or not private.is_public_https_url(p_audience)
      or p_service_account_email is null or length(p_service_account_email) > 254
      or p_service_account_email !~ '^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$'
      or p_subscription is null or length(p_subscription) > 512
      or p_subscription !~ '^projects/[a-zA-Z0-9][a-zA-Z0-9._~+%-]*/subscriptions/[a-zA-Z][a-zA-Z0-9._~+%-]*$' then
    raise exception using errcode = '22023', message = 'invalid_google_connection';
  end if;
  if p_credentials is null or jsonb_typeof(p_credentials) is distinct from 'object'
      or octet_length(p_credentials::text) > 32768
      or p_credentials->>'type' is distinct from 'service_account'
      or jsonb_typeof(p_credentials->'client_email') is distinct from 'string'
      or length(p_credentials->>'client_email') > 254
      or p_credentials->>'client_email' !~ '^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*\.gserviceaccount\.com$'
      or jsonb_typeof(p_credentials->'private_key') is distinct from 'string'
      or octet_length(p_credentials->>'private_key') not between 1 and 16384
      or p_credentials->>'private_key' !~ '^-----BEGIN PRIVATE KEY-----[[:space:]]'
      or p_credentials->>'private_key' !~ '-----END PRIVATE KEY-----[[:space:]]*$' then
    raise exception using errcode = '22023', message = 'invalid_google_credentials';
  end if;

  select c.vault_secret_id into v_secret from private.google_play_connections c where c.app_id = p_app_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_credentials::text, v_name, 'Salebell Google Play Publisher service account');
    insert into private.google_play_connections(app_id, audience, service_account_email, subscription, vault_secret_id)
      values (p_app_id, p_audience, p_service_account_email, p_subscription, v_secret);
  else
    perform vault.update_secret(v_secret, p_credentials::text, v_name, 'Salebell Google Play Publisher service account');
    update private.google_play_connections c set audience = p_audience, service_account_email = p_service_account_email,
      subscription = p_subscription, updated_at = now() where c.app_id = p_app_id;
  end if;
end $$;

create function public.google_webhook_app(p_key text)
returns table (id uuid, name text, package_name text, enabled boolean,
  audience text, service_account_email text, subscription text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.package_name, a.enabled, c.audience, c.service_account_email, c.subscription
  from public.apps a join private.google_play_connections c on c.app_id = a.id
  where a.webhook_key = p_key and a.store = 'play_store';
$$;

create function public.load_google_play_credentials(p_app_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret::jsonb from private.google_play_connections c
  join public.apps a on a.id = c.app_id and a.store = 'play_store'
  join vault.decrypted_secrets s on s.id = c.vault_secret_id
  where c.app_id = p_app_id;
$$;

create or replace function public.webhook_app(p_key text)
returns table (id uuid, name text, bundle_id text, apple_app_id bigint, enabled boolean,
  forward_url_production text, forward_url_sandbox text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.bundle_id, a.apple_app_id, a.enabled, a.forward_url_production, a.forward_url_sandbox
  from public.apps a where a.webhook_key = p_key and a.store = 'app_store';
$$;

create function public.record_google_play_event(p_app_id uuid, p_event jsonb, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_store text;
begin
  select a.store into v_store from public.apps a where a.id = p_app_id for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  if v_store is distinct from 'play_store' or p_event->>'store' is distinct from 'play_store' then
    raise exception using errcode = '22023', message = 'platform_mismatch';
  end if;
  if jsonb_typeof(p_event) is distinct from 'object' or jsonb_typeof(p_payload) is distinct from 'object'
      or p_event->>'revenue' is not null or p_event->>'currency' is not null then
    raise exception using errcode = '22023', message = 'invalid_google_event';
  end if;
  -- Only hashes can be retained for purchase-token grouping. Reject accidentally
  -- forwarded raw RTDN/API bodies, including tokens nested inside arrays.
  if jsonb_path_exists(p_event,
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(purchase_?token|linked_?purchase_?token|access_?token)$" flag "i")')
      or jsonb_path_exists(p_payload,
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(purchase_?token|linked_?purchase_?token|access_?token)$" flag "i")') then
    raise exception using errcode = '22023', message = 'google_tokens_must_be_redacted';
  end if;
  return public.record_store_event(p_app_id, p_event, p_payload, null);
end $$;

revoke all on function public.save_google_play_connection(uuid,text,text,text,jsonb),
  public.google_webhook_app(text), public.load_google_play_credentials(uuid),
  public.record_google_play_event(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_google_play_connection(uuid,text,text,text,jsonb),
  public.google_webhook_app(text), public.load_google_play_credentials(uuid),
  public.record_google_play_event(uuid,jsonb,jsonb) to service_role;

commit;
