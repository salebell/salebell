-- Free accounts see the last 30 days of events and transactions; Pro sees everything.
-- Nothing is deleted: upgrading makes older rows visible again.
begin;

-- Apps the caller can read, with the earliest visible timestamp for each. Evaluated
-- once per query (hashed semi-join), not per row.
create function private.history_scope() returns table (app_id uuid, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, case when ac.plan = 'pro' then '-infinity'::timestamptz else now() - interval '30 days' end
  from public.account_members m
  join public.accounts ac on ac.id = m.account_id
  join public.apps a on a.account_id = m.account_id
  where m.user_id = (select auth.uid());
$$;
revoke all on function private.history_scope() from public;
grant execute on function private.history_scope() to authenticated;

drop policy events_read on public.store_events;
create policy events_read on public.store_events for select to authenticated
  using (exists (select 1 from private.history_scope() s
                 where s.app_id = store_events.app_id and store_events.occurred_at >= s.since));

drop policy transactions_read on public.store_transactions;
create policy transactions_read on public.store_transactions for select to authenticated
  using (exists (select 1 from private.history_scope() s
                 where s.app_id = store_transactions.app_id and store_transactions.purchased_at >= s.since));

commit;
