-- Verified orders.get totals feed the shared event analytics and alerts.
-- Keep accounting claims independently of retained event history.
begin;

create table private.google_play_order_totals (
  app_id uuid not null references public.apps(id) on delete cascade,
  environment text not null check (environment in ('Production','Sandbox')),
  order_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  charged_amount numeric(14,3) not null check (charged_amount >= 0),
  charge_recorded boolean not null default false,
  refunded_amount numeric(14,3) not null default 0 check (refunded_amount >= 0 and refunded_amount <= charged_amount),
  primary key (app_id, environment, order_id)
);
alter table private.google_play_order_totals enable row level security;
revoke all on private.google_play_order_totals from public, anon, authenticated, service_role;

create or replace function public.record_google_play_event(p_app_id uuid, p_event jsonb, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_store text;
  e jsonb := p_event;
  o jsonb := p_payload->'order';
  v_order text;
  v_currency text;
  v_charged numeric;
  v_refunded numeric;
  v_delta numeric;
  v_previous private.google_play_order_totals%rowtype;
  v_result jsonb;
  v_duplicate boolean := false;
begin
  -- Configuration, duplicate checks, accounting and event insertion share one
  -- app lock. The generation-checking four-argument wrapper holds this too.
  select a.store into v_store from public.apps a where a.id = p_app_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'app_not_found';
  end if;
  if v_store is distinct from 'play_store' or e->>'store' is distinct from 'play_store' then
    raise exception using errcode = '22023', message = 'platform_mismatch';
  end if;
  if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(p_payload) is distinct from 'object'
      or e->>'environment' is null or e->>'environment' not in ('Production','Sandbox') then
    raise exception using errcode = '22023', message = 'invalid_google_event';
  end if;
  if jsonb_path_exists(e,
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(purchase_?token|linked_?purchase_?token|access_?token)$" flag "i")')
      or jsonb_path_exists(p_payload,
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(purchase_?token|linked_?purchase_?token|access_?token)$" flag "i")') then
    raise exception using errcode = '22023', message = 'google_tokens_must_be_redacted';
  end if;
  if o is not null then
    v_order := o->>'orderId';
    v_currency := o->>'currency';
    if jsonb_typeof(o) is distinct from 'object' or o->>'source' is distinct from 'orders.get'
        or v_order is null or length(v_order) not between 1 and 255
        or v_currency is null or v_currency !~ '^[A-Z]{3}$'
        or e->>'transactionId' is distinct from v_order or e->>'currency' is distinct from v_currency
        or e->>'type' is null or e->>'type' not in ('purchase','renewal','trial_started','refund')
        or jsonb_typeof(o->'chargedAmount') is distinct from 'number'
        or jsonb_typeof(o->'refundedAmount') is distinct from 'number'
        or jsonb_typeof(e->'revenue') is distinct from 'number' then
      raise exception using errcode = '22023', message = 'invalid_google_order';
    end if;
    v_charged := (o->>'chargedAmount')::numeric;
    v_refunded := (o->>'refundedAmount')::numeric;
    if v_charged < 0 or v_charged > 99999999999.999 or v_refunded < 0 or v_refunded > v_charged
        or v_charged <> round(v_charged,3) or v_refunded <> round(v_refunded,3)
        or (e->>'revenue')::numeric is distinct from
          (case when e->>'type' = 'refund' then -v_refunded else v_charged end)
        or (e->>'type' <> 'refund' and v_refunded <> 0) then
      raise exception using errcode = '22023', message = 'invalid_google_order_amount';
    end if;
  elsif e->>'revenue' is not null or e->>'currency' is not null then
    raise exception using errcode = '22023', message = 'invalid_google_event';
  end if;

  -- A replay must never change order accounting, including after later refunds.
  if exists (select 1 from public.store_events s where s.app_id = p_app_id and s.id = (e->>'id')::uuid) then
    return public.record_store_event(p_app_id,e,p_payload,null);
  end if;
  if o is not null then
    insert into private.google_play_order_totals(app_id,environment,order_id,currency,charged_amount)
      values (p_app_id,e->>'environment',v_order,v_currency,v_charged) on conflict do nothing;
    select * into strict v_previous from private.google_play_order_totals t
      where t.app_id = p_app_id and t.environment = e->>'environment' and t.order_id = v_order;
    if v_previous.currency is distinct from v_currency or v_previous.charged_amount <> v_charged then
      raise exception using errcode = '22023', message = 'google_order_changed';
    end if;
    if e->>'type' = 'refund' then
      v_delta := greatest(v_refunded - v_previous.refunded_amount,0);
      v_duplicate := v_delta = 0;
      e := jsonb_set(e,'{revenue}',to_jsonb(-v_delta));
      update private.google_play_order_totals t set refunded_amount = greatest(v_refunded,t.refunded_amount)
        where t.app_id = p_app_id and t.environment = e->>'environment' and t.order_id = v_order;
    else
      v_duplicate := v_previous.charge_recorded;
      update private.google_play_order_totals t set charge_recorded = true
        where t.app_id = p_app_id and t.environment = e->>'environment' and t.order_id = v_order;
    end if;
    if v_duplicate then
      -- Keep delivery history without duplicating money, purchase/refund counts
      -- or notifications when Google republishes under a different message ID.
      e := e || jsonb_build_object('revenue',null,'type','other');
    end if;
  end if;
  v_result := public.record_store_event(p_app_id,e,p_payload,null);
  if v_duplicate then
    v_result := v_result || jsonb_build_object('channels','[]'::jsonb,'devices','[]'::jsonb);
  end if;
  return v_result || jsonb_build_object('event',e);
end $$;

revoke all on function public.record_google_play_event(uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.record_google_play_event(uuid,jsonb,jsonb) to service_role;
commit;
