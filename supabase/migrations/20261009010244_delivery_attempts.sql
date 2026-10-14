-- Record how many attempts each alert delivery took (retries with backoff).
begin;
alter table public.alert_deliveries add column if not exists attempts int not null default 1;

create or replace function public.log_alert_deliveries(p_app_id uuid, p_event_id uuid, p_deliveries jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.alert_deliveries(app_id, channel_id, event_id, ok, status, error, attempts)
  select p_app_id, (d->>'channelId')::uuid, p_event_id, (d->>'ok')::boolean, (d->>'status')::int, d->>'error',
         coalesce((d->>'attempts')::int, 1)
  from jsonb_array_elements(p_deliveries) d
  where exists (select 1 from public.alert_channels c where c.id = (d->>'channelId')::uuid and c.app_id = p_app_id);
$$;
revoke all on function public.log_alert_deliveries(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.log_alert_deliveries(uuid,uuid,jsonb) to service_role;
commit;
