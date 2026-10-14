-- Forward URLs and last-event timestamps on apps, Slack/Discord channels, and
-- free-plan limits. Limits are checked on insert; after a downgrade the extras
-- stay stored and only the oldest enabled N are used at dispatch time.
begin;

alter table public.apps
  add column forward_url_production text
    check (forward_url_production ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' and length(forward_url_production) <= 2048),
  add column forward_url_sandbox text
    check (forward_url_sandbox ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' and length(forward_url_sandbox) <= 2048),
  add column last_event_production_at timestamptz,
  add column last_event_sandbox_at timestamptz;

grant insert (forward_url_production, forward_url_sandbox) on public.apps to authenticated;
grant update (forward_url_production, forward_url_sandbox) on public.apps to authenticated;

alter table public.alert_channels drop constraint alert_channels_kind_check;
alter table public.alert_channels add constraint alert_channels_kind_check
  check (kind in ('pushover','ntfy','telegram','webhook','posthog','slack','discord'));

-- ---------- plan limits ----------
-- The account row lock serialises concurrent inserts so the count cannot race.

create function private.enforce_app_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_limit int;
begin
  select private.plan_limit(a.plan, 'apps') into v_limit from public.accounts a where a.id = new.account_id for update;
  if v_limit is not null and (select count(*) from public.apps x where x.account_id = new.account_id) >= v_limit then
    raise exception using errcode = 'P0001', message = 'plan_limit:apps',
      detail = format('Your plan allows %s app(s).', v_limit), hint = 'Upgrade to Pro to add more apps.';
  end if;
  return new;
end $$;
revoke all on function private.enforce_app_limit() from public;
create trigger apps_plan_limit before insert on public.apps
  for each row execute function private.enforce_app_limit();

create function private.enforce_channel_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; v_limit int;
begin
  select a.account_id into v_account from public.apps a where a.id = new.app_id;
  if tg_op = 'UPDATE' and v_account = (select a.account_id from public.apps a where a.id = old.app_id) then
    return new;  -- moving within one account does not change its count
  end if;
  select private.plan_limit(ac.plan, 'channels') into v_limit from public.accounts ac where ac.id = v_account for update;
  if v_limit is not null and (select count(*) from public.alert_channels c join public.apps a on a.id = c.app_id
                              where a.account_id = v_account) >= v_limit then
    raise exception using errcode = 'P0001', message = 'plan_limit:channels',
      detail = format('Your plan allows %s integration(s).', v_limit), hint = 'Upgrade to Pro for unlimited integrations.';
  end if;
  return new;
end $$;
revoke all on function private.enforce_channel_limit() from public;
create trigger alert_channels_plan_limit before insert or update of app_id on public.alert_channels
  for each row execute function private.enforce_channel_limit();

-- Oldest enabled N apps / channels of an account are active; the rest are paused.
create function private.active_app_ids(p_account uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.apps a
  where a.account_id = p_account and a.enabled
  order by a.created_at, a.id
  limit (select private.plan_limit(ac.plan, 'apps') from public.accounts ac where ac.id = p_account);
$$;
create function private.active_channel_ids(p_account uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.alert_channels c join public.apps a on a.id = c.app_id
  where a.account_id = p_account and c.enabled
  order by c.created_at, c.id
  limit (select private.plan_limit(ac.plan, 'channels') from public.accounts ac where ac.id = p_account);
$$;
revoke all on function private.active_app_ids(uuid), private.active_channel_ids(uuid) from public;
grant execute on function private.active_app_ids(uuid), private.active_channel_ids(uuid) to service_role;

commit;
