-- Review round 1: membership takeover, outbound URL validation, rate limits, Stripe
-- duplicates and cancel_at_period_end, USD without an fx row. Included from schema_test.sql.

insert into auth.users values ('00000000-0000-0000-0000-00000000000d', 'dana@example.com'),
                              ('00000000-0000-0000-0000-00000000000e', 'eve@example.com');
select a.id as dana_account from public.accounts a join public.account_members m on m.account_id = a.id
  where m.user_id = '00000000-0000-0000-0000-00000000000d' \gset
select a.id as eve_account from public.accounts a join public.account_members m on m.account_id = a.id
  where m.user_id = '00000000-0000-0000-0000-00000000000e' \gset

-- ---------- account_members takeover ----------
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
select pg_temp.throws(format('insert into public.account_members(account_id,user_id,role,created_at) values (%L,%L,%L,%L)',
  :'dana_account', '00000000-0000-0000-0000-00000000000e', 'owner', '2000-01-01'), '42501', 'owner cannot add members (workspace takeover)');
select pg_temp.throws(format('update public.account_members set role = %L where account_id = %L', 'member', :'dana_account'),
  '42501', 'owner cannot change membership rows');
reset role;
insert into public.account_members(account_id, user_id, role) values (:'dana_account', '00000000-0000-0000-0000-00000000000e', 'member');
set role authenticated;
delete from public.account_members where account_id = :'dana_account' and user_id = '00000000-0000-0000-0000-00000000000e';
reset role;
select pg_temp.check((select count(*) from public.account_members where account_id = :'dana_account') = 2,
  'owner cannot remove other members');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false);
delete from public.account_members where account_id = :'dana_account' and user_id = '00000000-0000-0000-0000-00000000000e';
reset role;
select pg_temp.check((select count(*) from public.account_members where account_id = :'dana_account') = 1,
  'a member can leave (delete own row)');

-- ---------- outbound URL validation ----------
select pg_temp.check(bool_and(not private.is_public_https_url(u)), 'private, local and IP-literal URLs rejected')
from unnest(array[
  'http://api.example.com/x', 'https://127.0.0.1/x', 'https://10.0.0.5', 'https://169.254.169.254/latest/meta-data',
  'https://0x7f.0.0.1/', 'https://2130706433/', 'https://127.1/', 'https://[::1]/x', 'https://[fd00::1]:8443/',
  'https://localhost/x', 'https://LOCALHOST./x', 'https://printer.local/x', 'https://metadata.google.internal/x',
  'https://user:pw@api.example.com/x', 'https://intranet/x', 'https://api.example.com/ x', 'https://']) u;
select pg_temp.check(bool_and(private.is_public_https_url(u)), 'public https hostnames accepted')
from unnest(array['https://api.example.com/apple', 'https://hooks.example.co.uk:8443/a?b=c#d', 'https://ntfy.sh', 'https://xn--bcher-kva.example/']) u;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
insert into public.apps(account_id,name,bundle_id) values (:'dana_account','Dana App','com.dana.app') returning id as dana_app \gset
select pg_temp.throws(format('update public.apps set forward_url_production = %L where id = %L', 'https://169.254.169.254/latest', :'dana_app'),
  '23514', 'forward URL to an IP literal rejected');
select pg_temp.throws(format('update public.apps set forward_url_sandbox = %L where id = %L', 'https://db.internal/hook', :'dana_app'),
  '23514', 'forward URL to an internal name rejected');
update public.apps set forward_url_production = 'https://api.dana.dev/apple' where id = :'dana_app';
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'dana_app', 'webhook',
  '{"url":"https://192.168.1.10/hook","secret":"s"}'), '23514', 'webhook URL to a private IP rejected');
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'dana_app', 'ntfy',
  '{"topic":"t","server":"https://ntfy.local"}'), '23514', 'ntfy server on .local rejected');
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'dana_app', 'posthog',
  '{"api_key":"k","host":"http://eu.i.posthog.com"}'), '23514', 'PostHog host must be https');
select pg_temp.throws(format('insert into public.alert_channels(app_id,kind,config) values (%L,%L,%L)', :'dana_app', 'slack',
  '{"webhook_url":"https://evil.example.com/hook"}'), '23514', 'Slack webhook must be hooks.slack.com');
insert into public.alert_channels(app_id,kind,config) values (:'dana_app','webhook','{"url":"https://hooks.dana.dev/salebell","secret":"s"}');
select pg_temp.check((select count(*) from public.alert_channels where app_id = :'dana_app') = 1, 'public webhook URL accepted');
reset role;

-- ---------- rate limiter ----------
set role service_role;
select pg_temp.check(public.consume_rate_limit('test:dana', 2, 60) = 0 and public.consume_rate_limit('test:dana', 2, 60) = 0,
  'rate limit allows up to the limit');
select pg_temp.check(public.consume_rate_limit('test:dana', 2, 60) between 1 and 60, 'third hit in the window returns retry_after seconds');
select pg_temp.check(public.consume_rate_limit('test:other', 2, 60) = 0, 'limits are per key');
reset role;
set role authenticated;
select pg_temp.throws('select public.consume_rate_limit(''x'', 1, 60)', '42501', 'customers cannot call the rate limiter');
reset role;

-- ---------- Stripe: duplicates, cancel_at_period_end, customer ----------
set role service_role;
select pg_temp.check(public.set_stripe_customer(:'eve_account', 'cus_E') = 'cus_E', 'customer stored before checkout');
select pg_temp.check(public.set_stripe_customer(:'eve_account', 'cus_other') = 'cus_E', 'existing customer kept');
select pg_temp.check(public.apply_stripe_subscription(:'eve_account', 'cus_E', 'sub_A', 'active', '2026-11-10T00:00:00Z') = 'pro', 'first subscription applied');
select pg_temp.check(public.apply_stripe_subscription(:'eve_account', 'cus_E', 'sub_B', 'active', '2026-11-10T00:00:00Z') = 'duplicate',
  'second active subscription reported as duplicate');
select pg_temp.check((select stripe_subscription_id from public.accounts where id = :'eve_account') = 'sub_A', 'existing subscription kept');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_E', 'sub_B', 'canceled', null) = 'ignored', 'cancelled duplicate ignored');
select pg_temp.check(public.apply_stripe_subscription(null, 'cus_E', 'sub_A', 'active', '2026-11-10T00:00:00Z', true) = 'pro', 'cancel at period end synced');
select pg_temp.check((select (b).cancel_at_period_end from (select public.billing_owner_account('00000000-0000-0000-0000-00000000000e') b) x),
  'billing_owner_account returns cancel_at_period_end');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false);
select pg_temp.check((select cancel_at_period_end and plan = 'pro' from public.accounts where id = :'eve_account'), 'members read cancel_at_period_end');
select pg_temp.throws(format('update public.accounts set cancel_at_period_end = false where id = %L', :'eve_account'), '42501',
  'customers cannot write cancel_at_period_end');
reset role;

-- ---------- USD without an fx row ----------
delete from public.fx_rates where currency = 'USD';
set role service_role;
select public.record_store_event(:'dana_app', jsonb_build_object('id',gen_random_uuid(),'store','app_store','environment','Production',
  'type','purchase','rawType','ONE_TIME_CHARGE','occurredAt',now(),'revenue',49.99,'currency','USD'), '{}', null);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
select pg_temp.check((select sum(gross_revenue_usd) from public.daily_revenue where app_id = :'dana_app') = 49.99,
  'daily_revenue counts USD as 1.0 without an fx row');
select pg_temp.check((select gross_usd_30d from public.app_overview() where app_id = :'dana_app') = 49.99,
  'app_overview counts USD as 1.0 without an fx row');
reset role;
