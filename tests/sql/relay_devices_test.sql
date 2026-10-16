-- Ordinary clients own capabilities; workspace membership controls fan-out.
begin;
insert into auth.users(id) values
  ('94000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002'),
  ('94000000-0000-4000-8000-000000000003');
select account_id as relay_account from public.account_members
  where user_id = '94000000-0000-4000-8000-000000000001' \gset
insert into public.account_members(account_id,user_id,role)
  values (:'relay_account','94000000-0000-4000-8000-000000000002','member');
insert into public.apps(account_id,name,bundle_id)
  values (:'relay_account','Relay isolation','com.relay.isolation') returning id as relay_app \gset

set role authenticated;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
select public.register_relay_device(repeat('e1',32),'production','relay') as relay_owner_device \gset
select public.register_push_device(repeat('e4',32),'production','private');
select pg_temp.check((select count(*) from public.push_devices where transport='relay') = 1,
  'caller can read their delivery capability');
select pg_temp.throws($q$select public.register_relay_device(repeat('a',63),'production',null)$q$, '22023',
  'capability must contain exactly 32 bytes');
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
select public.register_relay_device(repeat('e2',32),'sandbox','relay') as relay_member_device \gset
select pg_temp.check((select count(*) from public.push_devices) = 1,
  'member sees only own capability');
select pg_temp.throws($q$select public.register_relay_device(repeat('e1',32),'production',null)$q$, '23505',
  'copied capability cannot move to another user');
select pg_temp.throws($q$select public.register_push_device(repeat('e1',32),'production',null)$q$, '23505',
  'legacy registration cannot take over a relay capability');
update public.push_devices set sandbox_alerts=true where id=:'relay_member_device';
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000003',true);
select public.register_relay_device(repeat('e3',32),'production','relay');
delete from public.push_devices where id=:'relay_owner_device';
select pg_temp.throws(format('select public.test_alert_targets(%L,%L)', :'relay_app',
  '94000000-0000-4000-8000-000000000001'), '42501', 'ordinary clients cannot impersonate targets');
reset role;
select pg_temp.check((select user_id from public.push_devices where id=:'relay_owner_device') = '94000000-0000-4000-8000-000000000001',
  'capability owner survives takeover attempts');

set role service_role;
select public.record_store_event(:'relay_app', jsonb_build_object('id',gen_random_uuid(),
  'store','app_store','environment','Production','type','test','rawType','TEST','occurredAt',now()), '{}', null) as relay_result \gset
select pg_temp.check(jsonb_array_length(:'relay_result'::jsonb->'devices') = 3
  and (:'relay_result'::jsonb->'devices') @> jsonb_build_array(jsonb_build_object('token',repeat('e1',32),'transport','relay'))
  and (:'relay_result'::jsonb->'devices') @> jsonb_build_array(jsonb_build_object('token',repeat('e2',32),'transport','relay')),
  'events target own workspace relay and private devices only');
select pg_temp.check(public.test_alert_targets(:'relay_app','94000000-0000-4000-8000-000000000002')->'devices'
  = jsonb_build_array(jsonb_build_object('token',repeat('e2',32),'environment','sandbox','transport','relay')),
  'test alerts include relay transport and only caller capability');
select public.record_store_event(:'relay_app', jsonb_build_object('id',gen_random_uuid(),
  'store','app_store','environment','Sandbox','type','test','rawType','TEST','occurredAt',now()), '{}', null) as relay_result \gset
select pg_temp.check(:'relay_result'::jsonb->'devices'
  = jsonb_build_array(jsonb_build_object('token',repeat('e2',32),'environment','sandbox','transport','relay')),
  'sandbox relay delivery requires explicit owner opt in');
reset role;
delete from public.account_members where account_id=:'relay_account' and user_id='94000000-0000-4000-8000-000000000002';
set role service_role;
select pg_temp.check(public.test_alert_targets(:'relay_app','94000000-0000-4000-8000-000000000002') is null,
  'removed member cannot dispatch tests');
select public.record_store_event(:'relay_app', jsonb_build_object('id',gen_random_uuid(),
  'store','app_store','environment','Production','type','test','rawType','TEST','occurredAt',now()), '{}', null) as relay_result \gset
select pg_temp.check(jsonb_array_length(:'relay_result'::jsonb->'devices') = 2
  and not (:'relay_result'::jsonb->'devices') @> jsonb_build_array(jsonb_build_object('token',repeat('e2',32))),
  'removed member capability is excluded from real event fan-out');
reset role;
rollback;
