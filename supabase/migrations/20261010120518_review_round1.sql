-- Review round 1 fixes.
-- * account_members: customers can no longer insert or update memberships (an owner could
--   add a victim's user id as owner and take over their default workspace); they may only
--   remove themselves.
-- * Outbound URLs (forward URLs, webhook url, ntfy server, PostHog host) must be public
--   https hostnames: no IP literals, localhost, *.local, *.internal or other private names.
--   Edge functions check resolved addresses again at send time.
-- * Rate limiter used by test-alert and duplicate-forward throttling.
-- * Stripe: accounts.cancel_at_period_end; duplicate subscriptions are detected so the
--   webhook can cancel and refund them; customer created before the first checkout.
-- * USD counts as 1.0 even without an fx_rates row.
begin;

-- ---------- account_members ----------
revoke insert, update on public.account_members from authenticated;
drop policy members_insert on public.account_members;
drop policy members_update on public.account_members;
drop policy members_delete on public.account_members;
create policy members_leave on public.account_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------- outbound URL validation ----------
-- True for null (optional fields). Public https hostname only; resolved addresses are
-- checked again at send time because DNS can point anywhere.
create function private.is_public_https_url(p_url text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_host text;
begin
  if p_url is null then return true; end if;
  if length(p_url) > 2048 or p_url !~ '^https://' or p_url ~ '[[:space:][:cntrl:]]' then return false; end if;
  v_host := lower(substring(p_url from '^https://([^/?#]*)'));
  if v_host is null or v_host = '' or v_host ~ '[@\[\]]' then return false; end if;  -- userinfo, IPv6 literal
  v_host := regexp_replace(v_host, ':[0-9]{1,5}$', '');
  v_host := regexp_replace(v_host, '\.$', '');
  -- Dotted DNS name with an alphabetic TLD: rules out IPv4 literals in any notation.
  if v_host !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$' then return false; end if;
  if v_host ~ '(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa)$' then
    return false;
  end if;
  return true;
end $$;

create function private.channel_config_ok(p_kind text, p_config jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_config) = 'object' and case p_kind
    when 'webhook' then private.is_public_https_url(p_config->>'url')
    when 'ntfy' then private.is_public_https_url(p_config->>'server')
    when 'posthog' then private.is_public_https_url(p_config->>'host')
    when 'slack' then coalesce(p_config->>'webhook_url' ~ '^https://hooks\.slack\.com/', true)
    when 'discord' then coalesce(p_config->>'webhook_url' ~ '^https://((ptb|canary)\.)?discord(app)?\.com/api/webhooks/', true)
    else true
  end;
$$;
revoke all on function private.is_public_https_url(text), private.channel_config_ok(text, jsonb) from public;
grant execute on function private.is_public_https_url(text), private.channel_config_ok(text, jsonb) to authenticated, service_role;

alter table public.apps
  add constraint apps_forward_url_production_public check (private.is_public_https_url(forward_url_production)),
  add constraint apps_forward_url_sandbox_public check (private.is_public_https_url(forward_url_sandbox));
alter table public.alert_channels
  add constraint alert_channels_config_safe check (private.channel_config_ok(kind, config));

-- ---------- rate limiting (fixed windows) ----------
create table private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null,
  primary key (key, window_start)
);
create index rate_limits_window on private.rate_limits(window_start);
alter table private.rate_limits enable row level security;
revoke all on private.rate_limits from public;

-- Counts one hit for p_key. Returns 0 when allowed, else seconds until the window resets.
create function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limits as r (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if random() < 0.01 then
    delete from private.rate_limits where window_start < clock_timestamp() - interval '1 day';
  end if;
  if v_hits <= p_limit then return 0; end if;
  return greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::int);
end $$;

-- ---------- Stripe ----------
alter table public.accounts add column cancel_at_period_end boolean not null default false;

-- Stores the Stripe customer created before the first checkout. Keeps an existing one.
create function public.set_stripe_customer(p_account uuid, p_customer text) returns text
language sql security definer set search_path = '' as $$
  update public.accounts set stripe_customer_id = coalesce(stripe_customer_id, p_customer)
  where id = p_account
  returning stripe_customer_id;
$$;

-- Returns 'pro' | 'free' | 'ignored' | 'no_account' | 'duplicate'. 'duplicate': the account
-- already has a different active/trialing subscription, so the caller cancels and refunds
-- the incoming one and the account keeps the existing subscription.
drop function public.apply_stripe_subscription(uuid, text, text, text, timestamptz);
create function public.apply_stripe_subscription(p_account uuid, p_customer text, p_subscription text,
  p_status text, p_period_end timestamptz, p_cancel_at_period_end boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_current text;
  v_current_status text;
  v_pro boolean := p_status in ('active','trialing','past_due');
begin
  if p_account is not null then
    select a.id, a.stripe_subscription_id, a.subscription_status into v_id, v_current, v_current_status
    from public.accounts a where a.id = p_account for update;
  end if;
  if v_id is null and p_customer is not null then
    select a.id, a.stripe_subscription_id, a.subscription_status into v_id, v_current, v_current_status
    from public.accounts a where a.stripe_customer_id = p_customer for update;
  end if;
  if v_id is null then return 'no_account'; end if;
  if v_current is not null and v_current <> p_subscription then
    if v_current_status in ('active','trialing') then
      return case when v_pro then 'duplicate' else 'ignored' end;
    end if;
    if not v_pro then return 'ignored'; end if;
  end if;
  update public.accounts set
    plan = case when v_pro then 'pro' else 'free' end,
    stripe_customer_id = coalesce(p_customer, stripe_customer_id),
    stripe_subscription_id = p_subscription,
    subscription_status = p_status,
    current_period_end = p_period_end,
    cancel_at_period_end = coalesce(p_cancel_at_period_end, false)
  where id = v_id;
  return case when v_pro then 'pro' else 'free' end;
end $$;

revoke all on function public.consume_rate_limit(text, int, int), public.set_stripe_customer(uuid, text),
  public.apply_stripe_subscription(uuid, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, int), public.set_stripe_customer(uuid, text),
  public.apply_stripe_subscription(uuid, text, text, text, timestamptz, boolean)
  to service_role;

-- billing_owner_account also returns cancel_at_period_end.
drop function public.billing_owner_account(uuid, uuid);
create function public.billing_owner_account(p_user uuid, p_account uuid default null)
returns table (id uuid, name text, plan text, stripe_customer_id text, stripe_subscription_id text,
  subscription_status text, cancel_at_period_end boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.plan, a.stripe_customer_id, a.stripe_subscription_id, a.subscription_status, a.cancel_at_period_end
  from public.accounts a
  join public.account_members m on m.account_id = a.id and m.user_id = p_user and m.role = 'owner'
  where p_account is null or a.id = p_account
  order by a.created_at, a.id
  limit 1;
$$;
revoke all on function public.billing_owner_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.billing_owner_account(uuid, uuid) to service_role;

-- ---------- USD = 1.0 ----------
create or replace view public.daily_revenue with (security_invoker = true) as
select e.app_id, e.environment, (e.occurred_at at time zone 'UTC')::date as day, e.currency,
  sum(e.revenue) filter (where e.revenue is not null) as gross_revenue,
  count(*) filter (where e.type = 'purchase') as purchases,
  count(*) filter (where e.type in ('renewal','billing_recovered')) as renewals,
  count(*) filter (where e.type = 'trial_started') as trials,
  count(*) filter (where e.type = 'refund') as refunds,
  count(*) filter (where e.type = 'cancellation') as cancellations,
  round(sum(e.revenue * coalesce(fx.usd_per_unit, case when e.currency = 'USD' then 1 end)), 2) as gross_revenue_usd
from public.store_events e
left join public.fx_rates fx on fx.currency = e.currency
group by 1,2,3,4;

create or replace function public.app_overview(p_tz text default 'UTC')
returns table (
  app_id uuid, account_id uuid, name text, bundle_id text, apple_app_id bigint, enabled boolean, paused boolean,
  last_event_production_at timestamptz, last_event_sandbox_at timestamptz,
  gross_usd_today numeric, gross_usd_7d numeric, gross_usd_30d numeric,
  purchases_today bigint, purchases_7d bigint, purchases_30d bigint,
  trials_today bigint, trials_7d bigint, trials_30d bigint,
  renewals_today bigint, renewals_7d bigint, renewals_30d bigint,
  refunds_today bigint, refunds_7d bigint, refunds_30d bigint
)
language sql stable set search_path = '' as $$
  with b as (
    select (date_trunc('day', now() at time zone p_tz)) at time zone p_tz as d1,
           (date_trunc('day', now() at time zone p_tz) - interval '6 days') at time zone p_tz as d7,
           (date_trunc('day', now() at time zone p_tz) - interval '29 days') at time zone p_tz as d30
  ), ranked as (
    select a.*, ac.plan,
      row_number() over (partition by a.account_id, a.enabled order by a.created_at, a.id) as rank
    from public.apps a join public.accounts ac on ac.id = a.account_id
  )
  select a.id, a.account_id, a.name, a.bundle_id, a.apple_app_id, a.enabled,
    a.enabled and a.rank > coalesce(private.plan_limit(a.plan, 'apps'), a.rank),
    a.last_event_production_at, a.last_event_sandbox_at,
    coalesce(s.g1, 0), coalesce(s.g7, 0), coalesce(s.g30, 0),
    s.p1, s.p7, s.p30, s.t1, s.t7, s.t30, s.r1, s.r7, s.r30, s.f1, s.f7, s.f30
  from ranked a cross join b
  cross join lateral (
    select
      round(sum(e.revenue * x.rate) filter (where e.occurred_at >= b.d1), 2) as g1,
      round(sum(e.revenue * x.rate) filter (where e.occurred_at >= b.d7), 2) as g7,
      round(sum(e.revenue * x.rate), 2) as g30,
      count(*) filter (where e.type = 'purchase' and e.occurred_at >= b.d1) as p1,
      count(*) filter (where e.type = 'purchase' and e.occurred_at >= b.d7) as p7,
      count(*) filter (where e.type = 'purchase') as p30,
      count(*) filter (where e.type = 'trial_started' and e.occurred_at >= b.d1) as t1,
      count(*) filter (where e.type = 'trial_started' and e.occurred_at >= b.d7) as t7,
      count(*) filter (where e.type = 'trial_started') as t30,
      count(*) filter (where e.type in ('renewal','billing_recovered') and e.occurred_at >= b.d1) as r1,
      count(*) filter (where e.type in ('renewal','billing_recovered') and e.occurred_at >= b.d7) as r7,
      count(*) filter (where e.type in ('renewal','billing_recovered')) as r30,
      count(*) filter (where e.type = 'refund' and e.occurred_at >= b.d1) as f1,
      count(*) filter (where e.type = 'refund' and e.occurred_at >= b.d7) as f7,
      count(*) filter (where e.type = 'refund') as f30
    from public.store_events e
    left join public.fx_rates fx on fx.currency = e.currency
    cross join lateral (select coalesce(fx.usd_per_unit, case when e.currency = 'USD' then 1 end) as rate) x
    where e.app_id = a.id and e.environment = 'Production' and e.occurred_at >= b.d30
  ) s
  order by a.created_at, a.id;
$$;

commit;
