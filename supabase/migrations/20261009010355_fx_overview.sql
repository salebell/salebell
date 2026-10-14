-- USD estimates: daily FX rates (written by the fx-refresh function), USD totals on
-- daily_revenue, and app_overview for the dashboard and the iOS app.
begin;

create table public.fx_rates (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  usd_per_unit numeric not null check (usd_per_unit > 0),
  updated_at timestamptz not null default now()
);
alter table public.fx_rates enable row level security;
create policy fx_rates_read on public.fx_rates for select to authenticated using (true);
revoke all on public.fx_rates from anon, authenticated;
grant select on public.fx_rates to authenticated;

-- Upserts { "EUR": 1.08, ... } (USD per unit). Service role only.
create function public.upsert_fx_rates(p_rates jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.fx_rates(currency, usd_per_unit, updated_at)
  select r.key, r.value::text::numeric, now()
  from jsonb_each(p_rates) r
  where r.key ~ '^[A-Z]{3}$' and jsonb_typeof(r.value) = 'number' and r.value::text::numeric > 0
  on conflict (currency) do update set usd_per_unit = excluded.usd_per_unit, updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.upsert_fx_rates(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_fx_rates(jsonb) to service_role;

-- Existing columns unchanged; gross_revenue_usd appended (current rates, an estimate).
create or replace view public.daily_revenue with (security_invoker = true) as
select e.app_id, e.environment, (e.occurred_at at time zone 'UTC')::date as day, e.currency,
  sum(e.revenue) filter (where e.revenue is not null) as gross_revenue,
  count(*) filter (where e.type = 'purchase') as purchases,
  count(*) filter (where e.type in ('renewal','billing_recovered')) as renewals,
  count(*) filter (where e.type = 'trial_started') as trials,
  count(*) filter (where e.type = 'refund') as refunds,
  count(*) filter (where e.type = 'cancellation') as cancellations,
  round(sum(e.revenue * fx.usd_per_unit), 2) as gross_revenue_usd
from public.store_events e
left join public.fx_rates fx on fx.currency = e.currency
group by 1,2,3,4;

-- Per app, Production only: today / last 7 / last 30 calendar days in p_tz (IANA name).
-- Gross includes refunds as negative amounts, like daily_revenue. Runs as the caller,
-- so RLS (membership and the 30-day free history window) applies.
-- paused = enabled but beyond the plan's app limit (alerts paused until upgrade).
create function public.app_overview(p_tz text default 'UTC')
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
      round(sum(e.revenue * fx.usd_per_unit) filter (where e.occurred_at >= b.d1), 2) as g1,
      round(sum(e.revenue * fx.usd_per_unit) filter (where e.occurred_at >= b.d7), 2) as g7,
      round(sum(e.revenue * fx.usd_per_unit), 2) as g30,
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
    where e.app_id = a.id and e.environment = 'Production' and e.occurred_at >= b.d30
  ) s
  order by a.created_at, a.id;
$$;
revoke all on function public.app_overview(text) from public, anon;
grant execute on function public.app_overview(text) to authenticated;

commit;
