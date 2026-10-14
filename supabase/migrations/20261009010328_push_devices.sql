-- iPhone push devices, and the webhook RPCs extended for forwarding, push fan-out
-- and plan gating (still one round trip per notification).
begin;

create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64,200}$'),
  apns_environment text not null check (apns_environment in ('sandbox','production')),
  sandbox_alerts boolean not null default false,
  enabled boolean not null default true,
  app_version text check (length(app_version) <= 50),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_devices_user on public.push_devices(user_id);

alter table public.push_devices enable row level security;
create policy push_devices_own on public.push_devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_devices from anon, authenticated;
grant select, delete on public.push_devices to authenticated;
grant update (sandbox_alerts, enabled) on public.push_devices to authenticated;

-- Upsert by token. A token registered by another user moves to the caller (shared
-- or handed-down phone) and its sandbox preference resets. Registering re-enables
-- the token, matching APNs semantics after a token was reported dead.
create function public.register_push_device(p_token text, p_apns_environment text, p_app_version text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.push_devices as d (user_id, token, apns_environment, app_version)
  values (v_uid, lower(p_token), p_apns_environment, p_app_version)
  on conflict (token) do update set
    sandbox_alerts = case when d.user_id = excluded.user_id then d.sandbox_alerts else false end,
    user_id = excluded.user_id,
    apns_environment = excluded.apns_environment,
    app_version = excluded.app_version,
    enabled = true,
    last_seen_at = now()
  returning d.id into v_id;
  return v_id;
end $$;
revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

-- APNs reported these tokens dead (410 / BadDeviceToken).
create function public.disable_push_devices(p_tokens text[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  update public.push_devices set enabled = false where token = any(p_tokens) and enabled;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- webhook RPCs ----------

drop function public.webhook_app(text);
create function public.webhook_app(p_key text)
returns table (id uuid, name text, bundle_id text, apple_app_id bigint, enabled boolean,
  forward_url_production text, forward_url_sandbox text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.bundle_id, a.apple_app_id, a.enabled, a.forward_url_production, a.forward_url_sandbox
  from public.apps a where a.webhook_key = p_key;
$$;

-- Returns { fresh, active, channels, devices }. active=false when the app is beyond the
-- plan's app limit: the event is still recorded (and forwarded) but alerts pause.
-- Only the oldest enabled N channels of the account are returned (plan gating).
-- Devices: every enabled device of every account member; Sandbox events only reach
-- devices that opted in with sandbox_alerts.
create or replace function public.record_store_event(p_app_id uuid, p_event jsonb, p_payload jsonb, p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e jsonb := p_event;
  t jsonb := p_transaction;
  ms constant numeric := 1000;
  v_sandbox boolean := (p_event->>'environment') = 'Sandbox';
  v_account uuid;
begin
  insert into public.store_events(app_id,id,store,environment,type,raw_type,raw_subtype,occurred_at,product_id,
    transaction_id,original_transaction_id,revenue,currency,storefront,app_user_id,is_trial,is_family_shared,payload)
  values (p_app_id,(e->>'id')::uuid,e->>'store',e->>'environment',e->>'type',e->>'rawType',e->>'rawSubtype',
    (e->>'occurredAt')::timestamptz,e->>'productId',e->>'transactionId',e->>'originalTransactionId',
    (e->>'revenue')::numeric,e->>'currency',e->>'storefront',e->>'appUserId',
    coalesce((e->>'isTrial')::boolean,false),coalesce((e->>'isFamilyShared')::boolean,false),p_payload)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('fresh', false, 'active', true, 'channels', '[]'::jsonb, 'devices', '[]'::jsonb);
  end if;

  if t is not null then
    insert into public.store_transactions as x(app_id,environment,transaction_id,original_transaction_id,product_id,
      purchased_at,expires_at,revoked_at,price_milliunits,currency,storefront,ownership_type,transaction_reason,
      offer_discount_type,app_user_id,signed_at,payload)
    values (p_app_id,t->>'environment',t->>'transactionId',t->>'originalTransactionId',t->>'productId',
      to_timestamp((t->>'purchaseDate')::numeric/ms),to_timestamp((t->>'expiresDate')::numeric/ms),
      to_timestamp((t->>'revocationDate')::numeric/ms),(t->>'price')::bigint,t->>'currency',t->>'storefront',
      t->>'inAppOwnershipType',t->>'transactionReason',t->>'offerDiscountType',t->>'appAccountToken',
      to_timestamp((t->>'signedDate')::numeric/ms),t)
    on conflict (app_id,environment,transaction_id) do update set
      expires_at=excluded.expires_at, revoked_at=excluded.revoked_at,
      price_milliunits=coalesce(excluded.price_milliunits,x.price_milliunits), currency=coalesce(excluded.currency,x.currency),
      ownership_type=excluded.ownership_type, transaction_reason=excluded.transaction_reason,
      offer_discount_type=excluded.offer_discount_type, app_user_id=coalesce(excluded.app_user_id,x.app_user_id),
      signed_at=excluded.signed_at, payload=excluded.payload, updated_at=now()
    where excluded.signed_at >= x.signed_at;
  end if;

  update public.apps a set
    last_event_production_at = case when v_sandbox then a.last_event_production_at else now() end,
    last_event_sandbox_at = case when v_sandbox then now() else a.last_event_sandbox_at end
  where a.id = p_app_id
  returning a.account_id into v_account;

  if p_app_id not in (select private.active_app_ids(v_account)) then
    return jsonb_build_object('fresh', true, 'active', false, 'channels', '[]'::jsonb, 'devices', '[]'::jsonb);
  end if;

  return jsonb_build_object('fresh', true, 'active', true,
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'config',c.config,
        'events',to_jsonb(c.events),'environments',to_jsonb(c.environments),'enabled',c.enabled) order by c.created_at)
      from public.alert_channels c
      where c.app_id = p_app_id and c.enabled and (e->>'environment') = any(c.environments)
        and c.id in (select private.active_channel_ids(v_account))), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('token', d.token, 'environment', d.apns_environment))
      from public.push_devices d
      join public.account_members m on m.user_id = d.user_id and m.account_id = v_account
      where d.enabled and (not v_sandbox or d.sandbox_alerts)), '[]'::jsonb));
end $$;

-- test-alert: the app's channels (with active flag) and the caller's own devices.
-- Returns null unless p_user is a member of the app's account.
create function public.test_alert_targets(p_app_id uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'app', jsonb_build_object('id', a.id, 'name', a.name),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'config',c.config,
        'events',to_jsonb(c.events),'environments',to_jsonb(c.environments),'enabled',c.enabled,
        'active', c.id in (select private.active_channel_ids(a.account_id))) order by c.created_at)
      from public.alert_channels c where c.app_id = a.id and c.enabled), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('token', d.token, 'environment', d.apns_environment))
      from public.push_devices d where d.user_id = p_user and d.enabled), '[]'::jsonb))
  from public.apps a
  join public.account_members m on m.account_id = a.account_id and m.user_id = p_user
  where a.id = p_app_id;
$$;

revoke all on function public.webhook_app(text), public.disable_push_devices(text[]),
  public.test_alert_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.webhook_app(text), public.disable_push_devices(text[]),
  public.test_alert_targets(uuid, uuid) to service_role;

commit;
