-- Exercises tenancy, RLS and the webhook functions. Fails loudly on any mismatch.
\set ON_ERROR_STOP on
create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %', what; end if; raise notice 'ok - %', what; end $$;
-- Runs stmt as the current role and expects an error whose SQLSTATE or message matches pattern.
create function pg_temp.throws(stmt text, pattern text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate ~ pattern or sqlerrm ~ pattern then raise notice 'ok - %', what; return; end if;
    raise exception 'FAILED: % (got % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', what;
end $$;

insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');

-- Alice signs up and creates an app + a channel through RLS.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.throws('select public.create_account(''Extra free workspace'')', '42501', 'customers cannot create extra accounts');
-- A second account for Alice ("Alice Co", on Pro via the Stripe webhook in production).
reset role;
select public.create_account('Alice Co') as alice_account \gset
update public.accounts set plan = 'pro' where id = :'alice_account';
set role authenticated;
insert into public.apps(account_id,name,bundle_id,apple_app_id) values (:'alice_account','Café Timer','com.example.cafetimer',1234567890) returning id as app_id, webhook_key \gset
insert into public.alert_channels(app_id,kind,config) values (:'app_id','pushover','{"token":"t","user":"u"}') returning id as chan_id \gset
insert into public.alert_channels(app_id,kind,config,environments) values (:'app_id','posthog','{"api_key":"k"}',array['Production','Sandbox']);
select pg_temp.check(length(:'webhook_key') = 32, 'webhook key generated');

-- Bob cannot see or touch Alice's data.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.check((select count(*) from public.apps) = 0, 'other tenant sees no apps');
select pg_temp.check((select count(*) from public.alert_channels) = 0, 'other tenant sees no channel secrets');
select set_config('my.acct', :'alice_account', false);
do $$ begin
  insert into public.apps(account_id,name,bundle_id) values (current_setting('my.acct')::uuid,'evil','com.evil');
  raise exception 'FAILED: cross-tenant insert allowed';
exception when insufficient_privilege then raise notice 'ok - cross-tenant insert blocked';
end $$;
do $$ begin
  perform public.record_store_event(null,null,null,null);
  raise exception 'FAILED: authenticated can call webhook RPC';
exception when insufficient_privilege then raise notice 'ok - webhook RPC not callable by customers';
end $$;

-- Webhook (service role) records events.
reset role;
set role service_role;
select pg_temp.check((select bundle_id from public.webhook_app(:'webhook_key')) = 'com.example.cafetimer', 'webhook_app lookup');
select public.record_store_event(:'app_id',
  '{"id":"11111111-1111-4111-8111-111111111111","store":"app_store","environment":"Production","type":"purchase","rawType":"ONE_TIME_CHARGE","rawSubtype":null,"occurredAt":"2026-10-08T05:54:46Z","productId":"com.example.cafetimer.premium.lifetime","transactionId":"T1","originalTransactionId":"T1","revenue":499.99,"currency":"TRY","storefront":"TUR","appUserId":null,"isTrial":false,"isFamilyShared":false}',
  '{"notificationType":"ONE_TIME_CHARGE"}',
  '{"transactionId":"T1","originalTransactionId":"T1","productId":"com.example.cafetimer.premium.lifetime","purchaseDate":1791392086000,"signedDate":1791392086569,"environment":"Production","price":499990,"currency":"TRY","storefront":"TUR","inAppOwnershipType":"PURCHASED","transactionReason":"PURCHASE"}') as r \gset
select pg_temp.check((:'r'::jsonb->>'fresh')::boolean, 'first delivery is fresh');
select pg_temp.check(jsonb_array_length(:'r'::jsonb->'channels') = 2, 'production event returns both channels');
select public.record_store_event(:'app_id',
  '{"id":"11111111-1111-4111-8111-111111111111","store":"app_store","environment":"Production","type":"purchase","rawType":"ONE_TIME_CHARGE","occurredAt":"2026-10-08T05:54:46Z"}', '{}', null) as r2 \gset
select pg_temp.check(not (:'r2'::jsonb->>'fresh')::boolean, 'replay is not fresh');
select pg_temp.check(jsonb_array_length(:'r2'::jsonb->'channels') = 0, 'replay returns no channels');

-- Refund (newer signed data) updates the ledger; an older replay cannot undo it.
select public.record_store_event(:'app_id',
  '{"id":"22222222-2222-4222-8222-222222222222","store":"app_store","environment":"Production","type":"refund","rawType":"REFUND","occurredAt":"2026-10-09T00:00:00Z","revenue":-499.99,"currency":"TRY"}', '{}',
  '{"transactionId":"T1","originalTransactionId":"T1","productId":"com.example.cafetimer.premium.lifetime","purchaseDate":1791392086000,"signedDate":1791500000000,"revocationDate":1791500000000,"environment":"Production","price":499990,"currency":"TRY"}');
select public.record_store_event(:'app_id',
  '{"id":"33333333-3333-4333-8333-333333333333","store":"app_store","environment":"Production","type":"other","rawType":"X","occurredAt":"2026-10-08T06:00:00Z"}', '{}',
  '{"transactionId":"T1","originalTransactionId":"T1","productId":"com.example.cafetimer.premium.lifetime","purchaseDate":1791392086000,"signedDate":1791392086569,"environment":"Production","price":499990,"currency":"TRY"}');
select pg_temp.check((select revoked_at is not null from public.store_transactions where transaction_id='T1'), 'refund state survives older replay');

-- Sandbox events only reach channels opted in to Sandbox.
select public.record_store_event(:'app_id',
  '{"id":"44444444-4444-4444-8444-444444444444","store":"app_store","environment":"Sandbox","type":"test","rawType":"TEST","occurredAt":"2026-10-08T06:00:00Z"}', '{}', null) as r3 \gset
select pg_temp.check(jsonb_array_length(:'r3'::jsonb->'channels') = 1 and :'r3'::jsonb->'channels'->0->>'kind' = 'posthog', 'sandbox routes only to sandbox-enabled channels');

select public.log_alert_deliveries(:'app_id','11111111-1111-4111-8111-111111111111',
  jsonb_build_array(jsonb_build_object('channelId',:'chan_id','ok',true,'status',200,'attempts',3),
                    jsonb_build_object('channelId',gen_random_uuid(),'ok',false,'error','foreign channel ignored')));
select pg_temp.check((select count(*) from public.alert_deliveries) = 1, 'delivery log ignores channels of other apps');
select pg_temp.check((select attempts from public.alert_deliveries) = 3, 'delivery attempts recorded');

-- Alice reads her reports through RLS; Bob sees nothing.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.check((select gross_revenue from public.daily_revenue where day='2026-10-08' and currency='TRY' and environment='Production') = 499.99, 'daily revenue for owner');
select pg_temp.check((select count(*) from public.store_events) = 4, 'owner sees events');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
select pg_temp.check((select count(*) from public.store_events) = 0, 'other tenant sees no events');
select pg_temp.check((select count(*) from public.daily_revenue) = 0, 'other tenant sees no revenue');
select pg_temp.check((select count(*) from public.store_transactions) = 0, 'other tenant sees no transactions');
reset role;
\ir saas_test.sql
\ir push_isolation_test.sql
\ir relay_devices_test.sql
\ir review_test.sql
\ir apple_credentials_test.sql
\ir apple_connection_test.sql
\ir instance_settings_test.sql
\ir google_play_test.sql
\ir google_onboarding_test.sql
\ir google_revenue_test.sql
\echo ALL SQL TESTS PASSED
