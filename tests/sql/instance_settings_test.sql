-- Instance-wide entitlements must be controlled by the operator, never a browser.
begin;
select pg_temp.check(to_regprocedure('public.instance_settings()') is not null, 'instance settings RPC exists');
select pg_temp.check(public.instance_settings() = '{"deployment_mode":"cloud","billing_enabled":true}'::jsonb,
  'new and existing deployments default to cloud billing');
select pg_temp.check(private.plan_limit('free','apps') = 1 and private.plan_limit('pro','apps') = 50,
  'cloud free and Pro app limits are preserved');

set role anon;
select pg_temp.check(public.instance_settings() = '{"deployment_mode":"cloud","billing_enabled":true}'::jsonb,
  'anonymous callers can read only the public instance contract');
select pg_temp.throws('select * from private.instance_settings', '42501', 'anonymous callers cannot read the settings table');
select pg_temp.throws('update private.instance_settings set deployment_mode = ''self_hosted''', '42501',
  'anonymous callers cannot unlock cloud features');
reset role;
set role authenticated;
select pg_temp.throws('update private.instance_settings set deployment_mode = ''self_hosted''', '42501',
  'authenticated callers cannot change deployment mode');
select pg_temp.throws('insert into private.instance_settings values (true,''self_hosted'')', '42501',
  'authenticated callers cannot insert settings');
reset role;

insert into auth.users(id) values ('90000000-0000-4000-8000-000000000001'), ('90000000-0000-4000-8000-000000000002');
select account_id as self_account from public.account_members where user_id = '90000000-0000-4000-8000-000000000001' \gset
set role service_role;
update private.instance_settings set deployment_mode = 'self_hosted' where singleton;
select pg_temp.check(public.instance_settings() = '{"deployment_mode":"self_hosted","billing_enabled":false}'::jsonb,
  'operator mode disables billing without modifying account subscriptions');
reset role;
select pg_temp.check(private.plan_limit('free','apps') is null and private.plan_limit('pro','apps') is null
  and private.plan_limit('free','channels') is null, 'self-hosted app and integration limits are removed');
select pg_temp.throws('update private.instance_settings set deployment_mode = ''invalid''', '23514', 'invalid modes are rejected');
select pg_temp.throws('insert into private.instance_settings values (false,''cloud'')', '23514', 'settings cannot have a second singleton');

set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
insert into public.apps(account_id,name,bundle_id)
  select :'self_account'::uuid, 'Self hosted ' || n, 'com.selfhost.app' || n from generate_series(1,51) n;
select pg_temp.check((select count(*) from public.apps where account_id = :'self_account') = 51,
  'self-hosted free accounts can exceed the cloud Pro app cap');
select id as self_app from public.apps where account_id = :'self_account' and bundle_id = 'com.selfhost.app51' \gset
insert into public.alert_channels(app_id,kind,config) values
  (:'self_app','slack','{"webhook_url":"https://hooks.slack.com/services/T/B/x"}'),
  (:'self_app','discord','{"webhook_url":"https://discord.com/api/webhooks/1/x"}');
select pg_temp.check((select bool_and(not paused) from public.app_overview()), 'self-hosted overview pauses no enabled apps');
reset role;
set role service_role;
select public.record_store_event(:'self_app', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now() - interval '60 days','revenue',1,'currency','USD'), '{}',
  jsonb_build_object('transactionId','SELF_OLD','originalTransactionId','SELF_OLD','productId','p','environment','Production',
    'purchaseDate',(extract(epoch from now() - interval '60 days') * 1000)::bigint,
    'signedDate',(extract(epoch from now() - interval '60 days') * 1000)::bigint)) as self_result \gset
select pg_temp.check((:'self_result'::jsonb->>'active')::boolean and jsonb_array_length(:'self_result'::jsonb->'channels') = 2,
  'self-hosted late app dispatches to every enabled integration');
reset role;
set role authenticated;
select pg_temp.check((select count(*) from public.store_events where app_id = :'self_app') = 1,
  'self-hosted free account sees events older than 30 days');
select pg_temp.check((select count(*) from public.store_transactions where transaction_id = 'SELF_OLD') = 1,
  'self-hosted free account sees old transaction history');
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select pg_temp.check((select count(*) from public.store_events where app_id = :'self_app') = 0,
  'self-hosted history remains isolated between workspaces');
select pg_temp.check((select count(*) from public.apps where account_id = :'self_account') = 0,
  'self-hosted apps remain isolated between workspaces');
reset role;
update private.instance_settings set deployment_mode = 'cloud' where singleton;
set role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select pg_temp.check((select count(*) from public.store_events where app_id = :'self_app') = 0,
  'returning to cloud restores free history gating without deleting data');
select pg_temp.check((select paused from public.app_overview() where app_id = :'self_app'),
  'returning to cloud restores the free app dispatch cap');
reset role;
rollback;
