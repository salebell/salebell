-- Customer backends store opaque relay delivery capabilities alongside private APNs devices.
-- Ownership is derived from Auth and a copied capability cannot transfer an existing row.
begin;
alter table public.push_devices add column transport text not null default 'apns'
  check (transport in ('apns','relay'));
alter table public.push_devices add constraint relay_capability_length
  check (transport <> 'relay' or token ~ '^[0-9a-f]{64}$');

create function public.register_relay_device(p_capability text, p_apns_environment text, p_app_version text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_capability is null or p_capability !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid relay capability' using errcode = '22023';
  end if;
  insert into public.push_devices as d (user_id,token,apns_environment,app_version,transport)
  values (v_uid,p_capability,p_apns_environment,p_app_version,'relay')
  on conflict (token) do update set
    apns_environment=excluded.apns_environment, app_version=excluded.app_version,
    enabled=true, last_seen_at=now()
  where d.user_id=v_uid and d.transport='relay'
  returning d.id into v_id;
  if v_id is null then raise exception 'device ownership conflict' using errcode = '23505'; end if;
  return v_id;
end $$;
revoke all on function public.register_relay_device(text,text,text) from public,anon;
grant execute on function public.register_relay_device(text,text,text) to authenticated;

create or replace function public.register_push_device(p_token text, p_apns_environment text, p_app_version text default null)
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
  where d.transport = 'apns'
  returning d.id into v_id;
  if v_id is null then raise exception 'device transport conflict' using errcode = '23505'; end if;
  return v_id;
end $$;
revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;


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
      select jsonb_agg(jsonb_build_object('token', d.token, 'environment', d.apns_environment)
        || case when d.transport = 'relay' then jsonb_build_object('transport','relay') else '{}'::jsonb end)
      from public.push_devices d
      join public.account_members m on m.user_id = d.user_id and m.account_id = v_account
      where d.enabled and (not v_sandbox or d.sandbox_alerts)), '[]'::jsonb));
end $$;

-- test-alert: the app's channels (with active flag) and the caller's own devices.
-- Returns null unless p_user is a member of the app's account.
create or replace function public.test_alert_targets(p_app_id uuid, p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'app', jsonb_build_object('id', a.id, 'name', a.name),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'config',c.config,
        'events',to_jsonb(c.events),'environments',to_jsonb(c.environments),'enabled',c.enabled,
        'active', c.id in (select private.active_channel_ids(a.account_id))) order by c.created_at)
      from public.alert_channels c where c.app_id = a.id and c.enabled), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('token', d.token, 'environment', d.apns_environment)
        || case when d.transport = 'relay' then jsonb_build_object('transport','relay') else '{}'::jsonb end)
      from public.push_devices d where d.user_id = p_user and d.enabled), '[]'::jsonb))
  from public.apps a
  join public.account_members m on m.account_id = a.account_id and m.user_id = p_user
  where a.id = p_app_id;
$$;

commit;
