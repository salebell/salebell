-- Plans and Stripe billing on accounts, auto-provisioned workspaces, and explicit
-- table grants (customers get only what the RLS policies are meant to allow).
begin;

-- Internal helpers live outside the API-exposed schema.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

alter table public.accounts
  add column plan text not null default 'free' check (plan in ('free','pro')),
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text,
  add column subscription_status text,
  add column current_period_end timestamptz;

-- Plan limits in one place. null = unlimited.
create function private.plan_limit(p_plan text, p_what text) returns int
language sql immutable set search_path = '' as $$
  select case
    when p_plan = 'pro' then case p_what when 'apps' then 50 else null end  -- apps: fair use
    else 1
  end;
$$;
revoke all on function private.plan_limit(text, text) from public;
grant execute on function private.plan_limit(text, text) to authenticated, service_role;

-- ---------- grants ----------
-- Supabase grants ALL on new public tables to anon and authenticated by default; RLS
-- then filters rows. Narrow that to what each table needs (also blocks TRUNCATE).
revoke all on public.accounts, public.account_members, public.apps, public.alert_channels,
  public.store_events, public.store_transactions, public.alert_deliveries, public.daily_revenue
  from anon, authenticated;
grant select on public.accounts, public.account_members, public.apps, public.alert_channels,
  public.store_events, public.store_transactions, public.alert_deliveries, public.daily_revenue to authenticated;
-- Plan and billing columns are written by service_role only.
grant update (name) on public.accounts to authenticated;
grant insert, update, delete on public.account_members to authenticated;
-- webhook_key, timestamps and account_id are not customer-writable after creation.
grant insert (account_id, name, bundle_id, apple_app_id, enabled) on public.apps to authenticated;
grant update (name, bundle_id, apple_app_id, enabled) on public.apps to authenticated;
grant delete on public.apps to authenticated;
grant insert, update, delete on public.alert_channels to authenticated;

-- ---------- auto-provisioning ----------
-- Every new auth user gets a workspace they own; clients never call create_account.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.accounts(name) values ('My workspace') returning id into v_id;
  insert into public.account_members(account_id, user_id, role) values (v_id, new.id, 'owner');
  return new;
end $$;
revoke all on function private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------- billing RPCs (service_role only; called by edge functions) ----------

-- The account the user owns: the given one, or their oldest owned account.
create function public.billing_owner_account(p_user uuid, p_account uuid default null)
returns table (id uuid, name text, plan text, stripe_customer_id text, stripe_subscription_id text, subscription_status text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, a.plan, a.stripe_customer_id, a.stripe_subscription_id, a.subscription_status
  from public.accounts a
  join public.account_members m on m.account_id = a.id and m.user_id = p_user and m.role = 'owner'
  where p_account is null or a.id = p_account
  order by a.created_at, a.id
  limit 1;
$$;

-- Applies the latest Stripe subscription state. Idempotent. A non-active status for a
-- subscription other than the account's current one is ignored (e.g. an old duplicate
-- subscription being cancelled must not downgrade an active one).
create function public.apply_stripe_subscription(p_account uuid, p_customer text, p_subscription text,
  p_status text, p_period_end timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_current text;
  v_pro boolean := p_status in ('active','trialing','past_due');
begin
  if p_account is not null then
    select a.id, a.stripe_subscription_id into v_id, v_current from public.accounts a where a.id = p_account for update;
  end if;
  if v_id is null and p_customer is not null then
    select a.id, a.stripe_subscription_id into v_id, v_current from public.accounts a where a.stripe_customer_id = p_customer for update;
  end if;
  if v_id is null then return 'no_account'; end if;
  if not v_pro and v_current is not null and v_current <> p_subscription then return 'ignored'; end if;
  update public.accounts set
    plan = case when v_pro then 'pro' else 'free' end,
    stripe_customer_id = coalesce(p_customer, stripe_customer_id),
    stripe_subscription_id = p_subscription,
    subscription_status = p_status,
    current_period_end = p_period_end
  where id = v_id;
  return case when v_pro then 'pro' else 'free' end;
end $$;

-- Accounts the user is the only owner of (deleted with the user).
create function public.sole_owned_accounts(p_user uuid)
returns table (id uuid, stripe_subscription_id text, subscription_status text)
language sql stable security definer set search_path = '' as $$
  select a.id, a.stripe_subscription_id, a.subscription_status
  from public.accounts a
  join public.account_members m on m.account_id = a.id and m.user_id = p_user and m.role = 'owner'
  where not exists (select 1 from public.account_members o
                    where o.account_id = a.id and o.role = 'owner' and o.user_id <> p_user);
$$;

create function public.delete_sole_owned_accounts(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  delete from public.accounts where id in (select s.id from public.sole_owned_accounts(p_user) s);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.billing_owner_account(uuid, uuid),
  public.apply_stripe_subscription(uuid, text, text, text, timestamptz),
  public.sole_owned_accounts(uuid), public.delete_sole_owned_accounts(uuid)
  from public, anon, authenticated;
grant execute on function public.billing_owner_account(uuid, uuid),
  public.apply_stripe_subscription(uuid, text, text, text, timestamptz),
  public.sole_owned_accounts(uuid), public.delete_sole_owned_accounts(uuid)
  to service_role;

commit;
