-- Database advisor fixes.
-- * create_account is no longer callable by customers: workspaces are auto-provisioned,
--   and extra free accounts would sidestep the free-plan limits.
-- * is_account_member moves out of the API-exposed schema (it stays usable by policies).
-- * "for all" manage policies are split per command so each table has one SELECT policy.
-- * alert_deliveries.channel_id gets an index (FK with on delete set null).
begin;

revoke execute on function public.create_account(text) from authenticated;

create function private.is_account_member(p_account uuid, p_roles text[] default array['owner','admin','member'])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.account_members m
                where m.account_id = p_account and m.user_id = (select auth.uid()) and m.role = any(p_roles));
$$;
revoke all on function private.is_account_member(uuid, text[]) from public;
grant execute on function private.is_account_member(uuid, text[]) to authenticated;

drop policy accounts_read on public.accounts;
drop policy accounts_update on public.accounts;
drop policy members_read on public.account_members;
drop policy members_manage on public.account_members;
drop policy apps_read on public.apps;
drop policy apps_manage on public.apps;
drop policy channels_manage on public.alert_channels;
drop policy deliveries_read on public.alert_deliveries;
drop function public.is_account_member(uuid, text[]);

create policy accounts_read on public.accounts for select to authenticated
  using (private.is_account_member(id));
create policy accounts_update on public.accounts for update to authenticated
  using (private.is_account_member(id, array['owner'])) with check (private.is_account_member(id, array['owner']));

create policy members_read on public.account_members for select to authenticated
  using (private.is_account_member(account_id));
create policy members_insert on public.account_members for insert to authenticated
  with check (private.is_account_member(account_id, array['owner']));
create policy members_update on public.account_members for update to authenticated
  using (private.is_account_member(account_id, array['owner'])) with check (private.is_account_member(account_id, array['owner']));
create policy members_delete on public.account_members for delete to authenticated
  using (private.is_account_member(account_id, array['owner']));

create policy apps_read on public.apps for select to authenticated
  using (private.is_account_member(account_id));
create policy apps_insert on public.apps for insert to authenticated
  with check (private.is_account_member(account_id, array['owner','admin']));
create policy apps_update on public.apps for update to authenticated
  using (private.is_account_member(account_id, array['owner','admin'])) with check (private.is_account_member(account_id, array['owner','admin']));
create policy apps_delete on public.apps for delete to authenticated
  using (private.is_account_member(account_id, array['owner','admin']));

-- Channel secrets are visible to owners/admins only.
create policy channels_manage on public.alert_channels for all to authenticated
  using (private.is_account_member((select account_id from public.apps a where a.id = app_id), array['owner','admin']))
  with check (private.is_account_member((select account_id from public.apps a where a.id = app_id), array['owner','admin']));

create policy deliveries_read on public.alert_deliveries for select to authenticated
  using (private.is_account_member((select account_id from public.apps a where a.id = app_id)));

create index alert_deliveries_channel on public.alert_deliveries(channel_id);

commit;
