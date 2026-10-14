-- SaaS layer: auto-provisioning, column grants, plan limits and gating, push devices,
-- history RLS, FX/overview, billing RPCs. Included from schema_test.sql (uses its
-- helpers and state: Alice = user a on "Alice Co" (Pro) with app :app_id).

-- ---------- auto-provisioning ----------
select pg_temp.check((select count(*) from public.accounts a join public.account_members m on m.account_id = a.id
  where m.user_id = '00000000-0000-0000-0000-00000000000b' and m.role = 'owner' and a.name = 'My workspace' and a.plan = 'free') = 1,
  'new auth user gets an owned free "My workspace"');
insert into auth.users values ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');
select a.id as carol_account from public.accounts a join public.account_members m on m.account_id = a.id
  where m.user_id = '00000000-0000-0000-0000-00000000000c' \gset

-- ---------- column grants ----------
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
update public.accounts set name = 'Alice Studio' where id = :'alice_account';
select pg_temp.check((select name from public.accounts where id = :'alice_account') = 'Alice Studio', 'owner renames account');
select pg_temp.throws(format('update public.accounts set plan = %L where id = %L', 'pro', :'alice_account'), '42501', 'customer cannot set plan');
select pg_temp.throws(format('update public.accounts set stripe_customer_id = %L where id = %L', 'cus_x', :'alice_account'), '42501', 'customer cannot set stripe ids');
select pg_temp.throws(format('update public.apps set webhook_key = %L where id = %L', 'guessable', :'app_id'), '42501', 'customer cannot set webhook_key');
select pg_temp.throws(format('update public.apps set last_event_production_at = now() where id = %L', :'app_id'), '42501', 'customer cannot set last event time');
select pg_temp.throws(format('update public.apps set account_id = %L where id = %L', :'carol_account', :'app_id'), '42501', 'customer cannot move an app between accounts');
update public.apps set forward_url_production = 'https://api.example.com/apple/notifications' where id = :'app_id';
select pg_temp.throws(format('update public.apps set forward_url_sandbox = %L where id = %L', 'http://api.example.com/x', :'app_id'), '23514', 'forward URL must be https');
select pg_temp.throws('truncate public.store_events', '42501', 'customer cannot truncate');
reset role;
set role anon;
select pg_temp.throws('select 1 from public.fx_rates', '42501', 'anon cannot read tables');
reset role;

-- ---------- plan limits (Carol, free) ----------
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
insert into public.apps(account_id,name,bundle_id) values (:'carol_account','Carol One','com.carol.one') returning id as carol_app \gset
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id) values (%L,%L,%L)', :'carol_account', 'Two', 'com.carol.two'),
  '^plan_limit:apps$', 'free plan: second app rejected with plan_limit:apps');
insert into public.alert_channels(app_id,kind,config,environments) values (:'carol_app','slack','{"webhook_url":"https://hooks.slack.com/services/T/B/x"}',array['Production','Sandbox']) returning id as carol_slack \gset
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'carol_app', 'discord', '{}'),
  '^plan_limit:channels$', 'free plan: second channel rejected with plan_limit:channels');

-- Removing an app frees its slot immediately, including its integration slot.
-- Re-adding the same bundle uses new receiver URLs and never needs an upgrade.
select webhook_key as deleted_carol_key from public.apps where id = :'carol_app' \gset
delete from public.apps where id = :'carol_app';
select pg_temp.check((select count(*) from public.apps where account_id = :'carol_account') = 0,
  'free plan: deleting an app frees its app slot');
insert into public.apps(account_id,name,bundle_id) values (:'carol_account','Carol One','com.carol.one') returning id as carol_app \gset
select pg_temp.check((select webhook_key from public.apps where id = :'carol_app') <> :'deleted_carol_key',
  'free plan: the same bundle can be re-added with a fresh receiver key');
insert into public.alert_channels(app_id,kind,config,environments) values (:'carol_app','slack','{"webhook_url":"https://hooks.slack.com/services/T/B/x"}',array['Production','Sandbox']) returning id as carol_slack \gset
select pg_temp.check((select count(*) from public.alert_channels c join public.apps a on a.id = c.app_id where a.account_id = :'carol_account') = 1,
  'free plan: re-added app can use the integration slot released by deletion');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id) values (%L,%L,%L)', :'carol_account', 'Two', 'com.carol.two'),
  '^plan_limit:apps$', 'free plan: re-adding does not bypass the simultaneous app limit');

-- Pro (Alice) can add more apps and channels.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
insert into public.apps(account_id,name,bundle_id) values (:'alice_account','Second','com.example.second') returning id as app2 \gset
insert into public.alert_channels(app_id,kind,config) values (:'app_id','discord','{"webhook_url":"https://discord.com/api/webhooks/1/x"}');
select pg_temp.check((select count(*) from public.alert_channels c join public.apps a on a.id = c.app_id where a.account_id = :'alice_account') = 3,
  'pro plan: several channels allowed');
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'app_id', 'email', '{}'),
  '23514', 'unknown channel kind rejected');
reset role;

-- ---------- push devices ----------
\set tok '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select public.register_push_device(upper(:tok), 'sandbox', '1.0') as bob_dev \gset
update public.push_devices set sandbox_alerts = true where id = :'bob_dev';
select pg_temp.check((select count(*) from public.push_devices where token = :tok and sandbox_alerts) = 1, 'device registered (token lower-cased)');
select pg_temp.throws(format('insert into public.push_devices(user_id,token,apns_environment) values (%L,%L,%L)',
  '00000000-0000-0000-0000-00000000000a', repeat('b',64), 'production'), '42501', 'devices are registered only through the RPC');
select pg_temp.throws(format('update public.push_devices set user_id = %L', '00000000-0000-0000-0000-00000000000a'), '42501', 'device owner not customer-writable');
-- The phone changes hands: Alice registers the same token.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select public.register_push_device(:tok, 'production', '1.1') as alice_dev \gset
select pg_temp.check(:'alice_dev' = :'bob_dev', 'register_push_device reassigns an existing token (same row)');
select pg_temp.check((select count(*) from public.push_devices where user_id = '00000000-0000-0000-0000-00000000000a' and not sandbox_alerts
  and apns_environment = 'production' and app_version = '1.1') = 1, 'reassigned token belongs to caller with sandbox opt-in reset');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.check((select count(*) from public.push_devices) = 0, 'previous owner no longer sees the device');
update public.push_devices set enabled = false;
reset role;
select pg_temp.check((select enabled from public.push_devices where id = :'alice_dev'), 'other users cannot modify a device');
set role anon;
select pg_temp.throws(format('select public.register_push_device(%L,%L,null)', repeat('c',64), 'production'), '42501', 'anon cannot register devices');
reset role;

-- Webhook fan-out: Production event reaches Alice's device; Sandbox only after opt-in.
set role service_role;
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now(),'revenue',9.99,'currency','EUR'), '{}', null) as r \gset
select pg_temp.check((:'r'::jsonb->>'active')::boolean and :'r'::jsonb->'devices' = jsonb_build_array(jsonb_build_object('token',:tok,'environment','production')),
  'production event returns member devices');
select pg_temp.check((select last_event_production_at > now() - interval '1 minute' from public.apps where id = :'app_id'), 'last production event time set');
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Sandbox',
  'type','test','rawType','TEST','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'devices') = 0, 'sandbox event skips devices without sandbox_alerts');
select pg_temp.check((select last_event_sandbox_at > now() - interval '1 minute' from public.apps where id = :'app_id'), 'last sandbox event time set');
reset role;
update public.push_devices set sandbox_alerts = true where id = :'alice_dev';
set role service_role;
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Sandbox',
  'type','test','rawType','TEST','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'devices') = 1, 'sandbox event reaches opted-in device');
select pg_temp.check(public.disable_push_devices(array[:tok]) = 1, 'dead tokens disabled');
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'devices') = 0, 'disabled device not returned');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select public.register_push_device(:tok, 'production', '1.1');
select pg_temp.check((select enabled from public.push_devices where id = :'alice_dev'), 'registering again re-enables the token');
reset role;

-- ---------- downgrade gating ----------
update public.accounts set plan = 'free' where id = :'alice_account';
set role service_role;
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check((:'r'::jsonb->>'active')::boolean, 'oldest app stays active after downgrade');
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'channels') = 1 and :'r'::jsonb->'channels'->0->>'id' = :'chan_id',
  'after downgrade only the oldest enabled channel is used');
select public.record_store_event(:'app2', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check(not (:'r'::jsonb->>'active')::boolean and jsonb_array_length(:'r'::jsonb->'devices') = 0,
  'app beyond the limit is recorded but its alerts pause');
select pg_temp.check((select count(*) from public.store_events where app_id = :'app2') = 1, 'paused app still records events');
select pg_temp.check((public.test_alert_targets(:'app_id', '00000000-0000-0000-0000-00000000000a')->'channels'->1->>'active')::boolean = false,
  'test_alert_targets flags paused channels');
select pg_temp.check(public.test_alert_targets(:'app_id', '00000000-0000-0000-0000-00000000000b') is null, 'test_alert_targets refuses non-members');
reset role;
update public.alert_channels set enabled = false where id = :'chan_id';
set role service_role;
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now()), '{}', null) as r \gset
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'channels') = 1 and :'r'::jsonb->'channels'->0->>'kind' = 'posthog',
  'disabling the oldest channel lets the next one take the free slot');
reset role;
update public.alert_channels set enabled = true where id = :'chan_id';

-- ---------- history RLS ----------
set role service_role;
select public.record_store_event(:'app_id', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now() - interval '60 days','revenue',1,'currency','USD'), '{}',
  jsonb_build_object('transactionId','OLD1','originalTransactionId','OLD1','productId','p','environment','Production',
    'purchaseDate',(extract(epoch from now() - interval '60 days') * 1000)::bigint,'signedDate',(extract(epoch from now() - interval '60 days') * 1000)::bigint));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.check((select count(*) from public.store_events where occurred_at < now() - interval '30 days') = 0, 'free plan hides events older than 30 days');
select pg_temp.check((select count(*) from public.store_transactions where transaction_id = 'OLD1') = 0, 'free plan hides old transactions');
select pg_temp.check((select count(*) from public.store_events where app_id = :'app_id' and occurred_at > now() - interval '1 hour') > 0, 'free plan sees recent events');
reset role;
update public.accounts set plan = 'pro' where id = :'alice_account';
set role authenticated;
select pg_temp.check((select count(*) from public.store_events where occurred_at < now() - interval '30 days') = 1, 'upgrading restores old history');
select pg_temp.check((select count(*) from public.store_transactions where transaction_id = 'OLD1') = 1, 'pro sees old transactions');
reset role;

-- ---------- FX and overview ----------
set role service_role;
select pg_temp.check(public.upsert_fx_rates('{"USD":1,"EUR":1.1,"TRY":0.03,"bad":2,"GBP":"x"}') = 3, 'fx upsert ignores invalid entries');
select public.upsert_fx_rates('{"EUR":1.2}');
select pg_temp.check((select usd_per_unit from public.fx_rates where currency = 'EUR') = 1.2, 'fx upsert is idempotent and updates');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.check((select gross_revenue_usd from public.daily_revenue where day = '2026-10-08' and currency = 'TRY' and environment = 'Production') = 15.00,
  'daily_revenue converts to USD');
select * from public.app_overview('Europe/London') where app_id = :'app_id' \gset ov_
reset role;
-- Independent computation of "today" in London (fixtures include a TRY refund dated 2026-10-09).
select round(sum(e.revenue * fx.usd_per_unit), 2) as exp_today, count(*) filter (where e.type = 'purchase') as exp_purchases
  from public.store_events e left join public.fx_rates fx on fx.currency = e.currency
  where e.app_id = :'app_id' and e.environment = 'Production'
    and e.occurred_at >= date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London' \gset
set role authenticated;
select pg_temp.check(:'ov_gross_usd_today'::numeric = :'exp_today'::numeric and :'ov_purchases_today'::int = :'exp_purchases'::int
  and :'ov_purchases_today'::int >= 4 and :'ov_purchases_30d'::int >= :'ov_purchases_today'::int,
  'app_overview today matches the ledger in the caller time zone (USD via fx_rates)');
select pg_temp.check(not :'ov_paused'::boolean and :'ov_last_event_sandbox_at' <> '', 'app_overview exposes paused flag and last event times');
select pg_temp.check((select count(*) from public.app_overview()) = 2, 'app_overview lists every app of the caller');
select pg_temp.throws('select * from public.app_overview(''Mars/Base'')', '22023', 'invalid time zone rejected');
reset role;
update public.accounts set plan = 'free' where id = :'alice_account';
set role authenticated;
select pg_temp.check((select paused from public.app_overview() where app_id = :'app2'), 'app_overview flags apps paused by the plan');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.check((select count(*) from public.app_overview()) = 0, 'app_overview is empty for other tenants');
reset role;
set role anon;
select pg_temp.throws('select * from public.app_overview()', '42501', 'anon cannot call app_overview');
reset role;

-- ---------- Stripe billing state ----------
set role authenticated;
select pg_temp.throws(format('select public.apply_stripe_subscription(%L,%L,%L,%L,null)', :'carol_account', 'cus_1', 'sub_1', 'active'),
  '42501', 'customers cannot call billing RPCs');
reset role;
set role service_role;
select pg_temp.check((select id from public.billing_owner_account('00000000-0000-0000-0000-00000000000c')) = :'carol_account'::uuid, 'billing_owner_account finds the owned account');
select pg_temp.check(public.apply_stripe_subscription(:'carol_account', 'cus_C', 'sub_1', 'active', '2026-11-09T00:00:00Z') = 'pro', 'checkout activates Pro');
select pg_temp.check(public.apply_stripe_subscription(:'carol_account', 'cus_C', 'sub_1', 'active', '2026-11-09T00:00:00Z') = 'pro', 'replay is idempotent');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_C', 'sub_old', 'canceled', null) = 'ignored', 'cancelling another subscription does not downgrade');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_C', 'sub_1', 'past_due', '2026-11-09T00:00:00Z') = 'pro', 'past_due keeps Pro during dunning');
select pg_temp.check((select plan = 'pro' and stripe_customer_id = 'cus_C' and subscription_status = 'past_due' from public.accounts where id = :'carol_account'), 'billing columns written');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_C', 'sub_1', 'canceled', '2026-11-09T00:00:00Z') = 'free', 'cancellation downgrades');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_unknown', 'sub_9', 'active', null) = 'no_account', 'unknown customer reported');

-- ---------- account deletion ----------
select pg_temp.check((select count(*) from public.sole_owned_accounts('00000000-0000-0000-0000-00000000000a')) = 2, 'sole-owned accounts listed');
insert into public.account_members(account_id, user_id, role) values (:'alice_account', '00000000-0000-0000-0000-00000000000b', 'owner');
select pg_temp.check(public.delete_sole_owned_accounts('00000000-0000-0000-0000-00000000000a') = 1, 'only sole-owned accounts are deleted');
select pg_temp.check((select count(*) from public.accounts where id = :'alice_account') = 1, 'co-owned account survives');
reset role;
