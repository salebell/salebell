-- User-facing Google Play setup is mediated by authenticated Edge Functions.
-- RPCs still recheck workspace authority and keep all credentials inside Vault.
begin;

alter table private.google_play_connections
  add column topic text,
  add column connection_version uuid not null default gen_random_uuid(),
  add constraint google_play_connections_topic_check check (
    topic is null or (length(topic) <= 512
      and topic ~ '^projects/[a-zA-Z0-9][a-zA-Z0-9._~+%-]*/topics/[a-zA-Z][a-zA-Z0-9._~+%-]*$')
  );

-- A timestamp can stay constant throughout a transaction; an unpredictable UUID
-- distinguishes every configuration write, including credential-only rotations.
create function private.rotate_google_play_connection_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.connection_version := gen_random_uuid();
  return new;
end $$;
revoke all on function private.rotate_google_play_connection_version() from public, anon, authenticated, service_role;
create trigger google_play_connections_rotate_version before update on private.google_play_connections
  for each row execute function private.rotate_google_play_connection_version();

drop function public.google_webhook_app(text);
create function public.google_webhook_app(p_key text)
returns table (id uuid, name text, package_name text, enabled boolean,
  audience text, service_account_email text, subscription text, connection_version uuid)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.package_name, a.enabled, c.audience, c.service_account_email,
    c.subscription, c.connection_version
  from public.apps a join private.google_play_connections c on c.app_id = a.id
  where a.webhook_key = p_key and a.store = 'play_store';
$$;

create function public.google_connection_status(p_app_id uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_account uuid;
  v_status jsonb;
begin
  select a.account_id into v_account from public.apps a where a.id = p_app_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  if not exists (select 1 from public.account_members m
      where m.account_id = v_account and m.user_id = p_user and m.role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  select jsonb_build_object('topic', c.topic, 'subscription', c.subscription,
    'audience', c.audience, 'service_account_email', c.service_account_email, 'updated_at', c.updated_at)
    into v_status from private.google_play_connections c where c.app_id = p_app_id;
  return v_status;
end $$;

create function public.save_user_google_play_connection(
  p_app_id uuid, p_user uuid, p_package_name text, p_webhook_key text,
  p_audience text, p_service_account_email text, p_subscription text,
  p_credentials jsonb, p_topic text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_app public.apps%rowtype;
  v_connection private.google_play_connections%rowtype;
begin
  -- The app lock serializes saves, disconnects, identifier edits and app deletion.
  select * into v_app from public.apps a where a.id = p_app_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  perform 1 from public.account_members m where m.account_id = v_app.account_id
    and m.user_id = p_user and m.role in ('owner','admin') for share;
  if not found then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if v_app.store is distinct from 'play_store'
      or v_app.package_name is distinct from p_package_name
      or v_app.bundle_id is distinct from p_package_name
      or v_app.webhook_key is distinct from p_webhook_key then
    raise exception using errcode = '22023', message = 'preview_changed';
  end if;
  if p_topic is not null and (length(p_topic) > 512
      or p_topic !~ '^projects/[a-zA-Z0-9][a-zA-Z0-9._~+%-]*/topics/[a-zA-Z][a-zA-Z0-9._~+%-]*$') then
    raise exception using errcode = '22023', message = 'invalid_google_connection';
  end if;

  select * into v_connection from private.google_play_connections c where c.app_id = p_app_id;
  if found and v_connection.audience is not distinct from p_audience
      and v_connection.service_account_email is not distinct from p_service_account_email
      and v_connection.subscription is not distinct from p_subscription
      and v_connection.topic is not distinct from p_topic
      and public.load_google_play_credentials(p_app_id) = p_credentials then
    -- Preserve the successful delivery and Vault ciphertext on an identical retry.
    return;
  end if;

  -- Reuse the foundation's audience, subscription, service-account and JSON checks.
  perform public.save_google_play_connection(p_app_id, p_audience, p_service_account_email,
    p_subscription, p_credentials);
  update private.google_play_connections c set topic = p_topic where c.app_id = p_app_id;
  update public.apps a set last_event_production_at = null, last_event_sandbox_at = null where a.id = p_app_id;
end $$;

create function public.delete_user_google_play_connection(p_app_id uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid;
  v_deleted boolean;
begin
  select a.account_id into v_account from public.apps a where a.id = p_app_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  perform 1 from public.account_members m where m.account_id = v_account
    and m.user_id = p_user and m.role in ('owner','admin') for share;
  if not found then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  -- The existing delete trigger removes the encrypted Vault secret in this transaction.
  delete from private.google_play_connections c where c.app_id = p_app_id;
  v_deleted := found;
  update public.apps a set last_event_production_at = null, last_event_sandbox_at = null where a.id = p_app_id;
  return v_deleted;
end $$;

-- The receiver supplies the generation it authenticated. Checking it while
-- holding the same app lock as saves/deletes prevents an old in-flight delivery
-- from recording activity or verifying a newly configured connection.
create function public.record_google_play_event(p_app_id uuid, p_event jsonb, p_payload jsonb,
  p_connection_version uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.apps a where a.id = p_app_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  if p_connection_version is null or not exists (select 1 from private.google_play_connections c
      where c.app_id = p_app_id and c.connection_version = p_connection_version) then
    raise exception using errcode = '22023', message = 'preview_changed';
  end if;
  return public.record_google_play_event(p_app_id, p_event, p_payload);
end $$;

create function private.guard_google_play_identifiers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.store = 'play_store' and (new.store is distinct from old.store
      or new.package_name is distinct from old.package_name or new.bundle_id is distinct from old.bundle_id)
      and exists (select 1 from private.google_play_connections c where c.app_id = old.id) then
    raise exception using errcode = '55000', message = 'google_connection_configured';
  end if;
  return new;
end $$;
revoke all on function private.guard_google_play_identifiers() from public, anon, authenticated, service_role;
create trigger apps_google_play_identifiers before update of store, package_name, bundle_id on public.apps
  for each row execute function private.guard_google_play_identifiers();

revoke all on function public.google_webhook_app(text), public.record_google_play_event(uuid,jsonb,jsonb,uuid),
  public.google_connection_status(uuid,uuid),
  public.save_user_google_play_connection(uuid,uuid,text,text,text,text,text,jsonb,text),
  public.delete_user_google_play_connection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.google_webhook_app(text), public.record_google_play_event(uuid,jsonb,jsonb,uuid),
  public.google_connection_status(uuid,uuid),
  public.save_user_google_play_connection(uuid,uuid,text,text,text,text,text,jsonb,text),
  public.delete_user_google_play_connection(uuid,uuid) to service_role;

commit;
