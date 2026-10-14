-- Deployment-owned entitlements. Existing installations remain hosted cloud instances
-- until their operator explicitly selects self_hosted during installation.
begin;

create table private.instance_settings (
  singleton boolean primary key default true check (singleton),
  deployment_mode text not null default 'cloud' check (deployment_mode in ('cloud','self_hosted'))
);
insert into private.instance_settings(singleton, deployment_mode) values (true, 'cloud');
alter table private.instance_settings enable row level security;
revoke all on private.instance_settings from public, anon, authenticated, service_role;
grant select, update (deployment_mode) on private.instance_settings to service_role;

-- The only public metadata is the instance mode and whether cloud billing is enabled.
-- SECURITY DEFINER avoids granting browser roles access to the private schema/table.
create function public.instance_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('deployment_mode', s.deployment_mode,
    'billing_enabled', s.deployment_mode = 'cloud')
  from private.instance_settings s where s.singleton;
$$;
revoke all on function public.instance_settings() from public, anon, authenticated, service_role;
grant execute on function public.instance_settings() to anon, authenticated, service_role;

-- Browser flags never control entitlements. Both insert triggers and webhook dispatch
-- use this database helper; NULL means no commercial app/integration cap.
create or replace function private.plan_limit(p_plan text, p_what text) returns int
language sql stable set search_path = '' as $$
  select case
    when public.instance_settings()->>'deployment_mode' = 'self_hosted' then null
    when p_plan = 'pro' then case p_what when 'apps' then 50 else null end
    else 1
  end;
$$;

-- Self-hosting restores access to retained history while preserving workspace RLS.
create or replace function private.history_scope() returns table (app_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id,
    case when ac.plan = 'pro' or public.instance_settings()->>'deployment_mode' = 'self_hosted'
      then '-infinity'::timestamptz else now() - interval '30 days' end
  from public.account_members m
  join public.accounts ac on ac.id = m.account_id
  join public.apps a on a.account_id = m.account_id
  where m.user_id = (select auth.uid());
$$;

commit;
