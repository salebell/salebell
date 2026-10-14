-- Salebell: multi-tenant real-time in-app purchase monitoring.
-- Tenancy: account (team) -> apps -> events / transactions / alert channels.
-- Customers use Supabase Auth; every table is protected by RLS on account membership.
-- The webhook writes only through SECURITY DEFINER functions granted to service_role.
begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------- tenancy ----------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index account_members_user on public.account_members(user_id);

create function public.is_account_member(p_account uuid, p_roles text[] default array['owner','admin','member'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.account_members m
                where m.account_id = p_account and m.user_id = (select auth.uid()) and m.role = any(p_roles));
$$;
revoke all on function public.is_account_member(uuid, text[]) from public, anon;
grant execute on function public.is_account_member(uuid, text[]) to authenticated;

-- Self-service signup: the caller becomes owner of a new account.
create function public.create_account(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.accounts(name) values (p_name) returning id into v_id;
  insert into public.account_members(account_id, user_id, role) values (v_id, auth.uid(), 'owner');
  return v_id;
end $$;
revoke all on function public.create_account(text) from public, anon;
grant execute on function public.create_account(text) to authenticated;

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  -- Unguessable path segment of the webhook URL. Not a secret on its own:
  -- every payload is still verified against Apple's signature and bundle id.
  webhook_key text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  bundle_id text not null,
  apple_app_id bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (account_id, bundle_id)
);
create index apps_account on public.apps(account_id);

create table public.alert_channels (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  kind text not null check (kind in ('pushover','ntfy','telegram','webhook','posthog')),
  name text,
  config jsonb not null default '{}',  -- tokens/keys; TODO: move secrets to Vault before public launch
  events text[],                        -- null = kind defaults
  environments text[] not null default array['Production'],
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index alert_channels_app on public.alert_channels(app_id);

-- ---------- event stream + ledger ----------

create table public.store_events (
  app_id uuid not null references public.apps(id) on delete cascade,
  id uuid not null,                     -- store notification id
  store text not null check (store in ('app_store','play_store')),
  environment text not null check (environment in ('Production','Sandbox')),
  type text not null,
  raw_type text not null,
  raw_subtype text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  product_id text,
  transaction_id text,
  original_transaction_id text,
  revenue numeric(14,3),
  currency text,
  storefront text,
  app_user_id text,
  is_trial boolean not null default false,
  is_family_shared boolean not null default false,
  payload jsonb not null,               -- verified, decoded store payload (no raw JWS)
  primary key (app_id, id)
);
create index store_events_app_time on public.store_events(app_id, occurred_at desc);
create index store_events_app_type on public.store_events(app_id, type, occurred_at desc);

create table public.store_transactions (
  app_id uuid not null references public.apps(id) on delete cascade,
  store text not null default 'app_store',
  environment text not null check (environment in ('Production','Sandbox')),
  transaction_id text not null,
  original_transaction_id text not null,
  product_id text not null,
  purchased_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  price_milliunits bigint check (price_milliunits >= 0),
  currency text,
  storefront text,
  ownership_type text,
  transaction_reason text,
  offer_discount_type text,
  app_user_id text,
  signed_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (app_id, environment, transaction_id)
);
create index store_transactions_app_purchased on public.store_transactions(app_id, purchased_at desc);

create table public.alert_deliveries (
  id bigint generated always as identity primary key,
  app_id uuid not null references public.apps(id) on delete cascade,
  channel_id uuid references public.alert_channels(id) on delete set null,
  event_id uuid not null,
  ok boolean not null,
  status int,
  error text,
  created_at timestamptz not null default now()
);
create index alert_deliveries_app_time on public.alert_deliveries(app_id, created_at desc);

-- ---------- RLS ----------

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.apps enable row level security;
alter table public.alert_channels enable row level security;
alter table public.store_events enable row level security;
alter table public.store_transactions enable row level security;
alter table public.alert_deliveries enable row level security;

create policy accounts_read on public.accounts for select to authenticated using (public.is_account_member(id));
create policy accounts_update on public.accounts for update to authenticated using (public.is_account_member(id, array['owner']));
create policy members_read on public.account_members for select to authenticated using (public.is_account_member(account_id));
create policy members_manage on public.account_members for all to authenticated
  using (public.is_account_member(account_id, array['owner'])) with check (public.is_account_member(account_id, array['owner']));

create policy apps_read on public.apps for select to authenticated using (public.is_account_member(account_id));
create policy apps_manage on public.apps for all to authenticated
  using (public.is_account_member(account_id, array['owner','admin'])) with check (public.is_account_member(account_id, array['owner','admin']));

-- Channel secrets are visible to owners/admins only.
create policy channels_manage on public.alert_channels for all to authenticated
  using (public.is_account_member((select account_id from public.apps a where a.id = app_id), array['owner','admin']))
  with check (public.is_account_member((select account_id from public.apps a where a.id = app_id), array['owner','admin']));

create policy events_read on public.store_events for select to authenticated
  using (public.is_account_member((select account_id from public.apps a where a.id = app_id)));
create policy transactions_read on public.store_transactions for select to authenticated
  using (public.is_account_member((select account_id from public.apps a where a.id = app_id)));
create policy deliveries_read on public.alert_deliveries for select to authenticated
  using (public.is_account_member((select account_id from public.apps a where a.id = app_id)));

revoke all on public.accounts, public.account_members, public.apps, public.alert_channels,
  public.store_events, public.store_transactions, public.alert_deliveries from anon;
grant select on public.accounts, public.account_members, public.apps, public.store_events,
  public.store_transactions, public.alert_deliveries to authenticated;
grant update on public.accounts to authenticated;
grant insert, update, delete on public.account_members, public.apps to authenticated;
grant select, insert, update, delete on public.alert_channels to authenticated;

-- ---------- webhook functions (service_role only) ----------

create function public.webhook_app(p_key text)
returns table (id uuid, name text, bundle_id text, apple_app_id bigint, enabled boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.bundle_id, a.apple_app_id, a.enabled from public.apps a where a.webhook_key = p_key;
$$;

-- Event insert and ledger upsert commit atomically. A replayed notification id
-- does no work. Older signed data never overwrites newer state (e.g. refunds).
-- Returns { fresh, channels } so the caller can fan out alerts in one round trip.
create function public.record_store_event(p_app_id uuid, p_event jsonb, p_payload jsonb, p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e jsonb := p_event;
  t jsonb := p_transaction;
  ms constant numeric := 1000;
begin
  insert into public.store_events(app_id,id,store,environment,type,raw_type,raw_subtype,occurred_at,product_id,
    transaction_id,original_transaction_id,revenue,currency,storefront,app_user_id,is_trial,is_family_shared,payload)
  values (p_app_id,(e->>'id')::uuid,e->>'store',e->>'environment',e->>'type',e->>'rawType',e->>'rawSubtype',
    (e->>'occurredAt')::timestamptz,e->>'productId',e->>'transactionId',e->>'originalTransactionId',
    (e->>'revenue')::numeric,e->>'currency',e->>'storefront',e->>'appUserId',
    coalesce((e->>'isTrial')::boolean,false),coalesce((e->>'isFamilyShared')::boolean,false),p_payload)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('fresh', false, 'channels', '[]'::jsonb);
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

  return jsonb_build_object('fresh', true, 'channels', coalesce((
    select jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'config',c.config,
      'events',to_jsonb(c.events),'environments',to_jsonb(c.environments),'enabled',c.enabled))
    from public.alert_channels c
    where c.app_id = p_app_id and c.enabled and (e->>'environment') = any(c.environments)), '[]'::jsonb));
end $$;

create function public.log_alert_deliveries(p_app_id uuid, p_event_id uuid, p_deliveries jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.alert_deliveries(app_id, channel_id, event_id, ok, status, error)
  select p_app_id, (d->>'channelId')::uuid, p_event_id, (d->>'ok')::boolean, (d->>'status')::int, d->>'error'
  from jsonb_array_elements(p_deliveries) d
  where exists (select 1 from public.alert_channels c where c.id = (d->>'channelId')::uuid and c.app_id = p_app_id);
$$;

revoke all on function public.webhook_app(text), public.record_store_event(uuid,jsonb,jsonb,jsonb),
  public.log_alert_deliveries(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.webhook_app(text), public.record_store_event(uuid,jsonb,jsonb,jsonb),
  public.log_alert_deliveries(uuid,uuid,jsonb) to service_role;

-- ---------- reporting (RLS applies through security_invoker) ----------

create view public.daily_revenue with (security_invoker = true) as
select app_id, environment, (occurred_at at time zone 'UTC')::date as day, currency,
  sum(revenue) filter (where revenue is not null) as gross_revenue,
  count(*) filter (where type = 'purchase') as purchases,
  count(*) filter (where type in ('renewal','billing_recovered')) as renewals,
  count(*) filter (where type = 'trial_started') as trials,
  count(*) filter (where type = 'refund') as refunds,
  count(*) filter (where type = 'cancellation') as cancellations
from public.store_events
group by 1,2,3,4;
grant select on public.daily_revenue to authenticated;

-- Live dashboards subscribe to new events (RLS still applies to subscribers).
alter publication supabase_realtime add table public.store_events;

commit;
