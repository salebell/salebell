-- Independent fixtures, rolled back so other schema tests retain their state.
-- Exercise actual service-role fan-out and customer RLS, in both deployment modes.
begin;
insert into auth.users(id) values
  ('92000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002'),
  ('92000000-0000-4000-8000-000000000003');
select account_id as push_account from public.account_members
  where user_id = '92000000-0000-4000-8000-000000000001' \gset
insert into public.account_members(account_id,user_id,role)
  values (:'push_account','92000000-0000-4000-8000-000000000002','member');
insert into public.apps(account_id,name,bundle_id)
  values (:'push_account','Push isolation','com.push.isolation') returning id as push_app \gset

set role authenticated;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select public.register_push_device(repeat('1',64),'production','isolation') as push_owner_device \gset
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
select public.register_push_device(repeat('2',64),'production','isolation') as push_member_device \gset
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000003',true);
select public.register_push_device(repeat('3',64),'production','isolation');
delete from public.push_devices where id = :'push_owner_device';
select pg_temp.check((select count(*) from public.push_devices) = 1,
  'unrelated user sees only their own phone');
select pg_temp.throws(format('select public.test_alert_targets(%L,%L)',
  :'push_app','92000000-0000-4000-8000-000000000001'), '42501',
  'customer cannot impersonate another user in the push target RPC');
reset role;
select pg_temp.check((select count(*) from public.push_devices where id = :'push_owner_device') = 1,
  'unrelated user cannot delete another phone');

set role service_role;
select public.record_store_event(:'push_app', jsonb_build_object('id',gen_random_uuid(),
  'store','app_store','environment','Production','type','test','rawType','TEST','occurredAt',now()), '{}', null) as push_result \gset
select pg_temp.check(jsonb_array_length(:'push_result'::jsonb->'devices') = 2
  and (:'push_result'::jsonb->'devices') @> jsonb_build_array(jsonb_build_object('token',repeat('1',64)))
  and (:'push_result'::jsonb->'devices') @> jsonb_build_array(jsonb_build_object('token',repeat('2',64))),
  'cloud event reaches workspace members and excludes unrelated phones');
select pg_temp.check(public.test_alert_targets(:'push_app','92000000-0000-4000-8000-000000000001')->'devices'
  = jsonb_build_array(jsonb_build_object('token',repeat('1',64),'environment','production')),
  'test alert reaches only caller phones, excluding other members');
select pg_temp.check(public.test_alert_targets(:'push_app','92000000-0000-4000-8000-000000000003') is null,
  'unrelated user cannot test workspace alerts');
reset role;

delete from public.account_members where account_id = :'push_account'
  and user_id = '92000000-0000-4000-8000-000000000002';
set role service_role;
update private.instance_settings set deployment_mode = 'self_hosted' where singleton;
select public.record_store_event(:'push_app', jsonb_build_object('id',gen_random_uuid(),
  'store','app_store','environment','Production','type','test','rawType','TEST','occurredAt',now()), '{}', null) as push_result \gset
select pg_temp.check(:'push_result'::jsonb->'devices'
  = jsonb_build_array(jsonb_build_object('token',repeat('1',64),'environment','production')),
  'self-hosted entitlements preserve isolation and exclude removed members');
select pg_temp.check(public.test_alert_targets(:'push_app','92000000-0000-4000-8000-000000000002') is null,
  'removed member cannot send a test alert');
reset role;
rollback;
