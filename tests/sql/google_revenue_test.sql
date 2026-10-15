-- Verified Google prices feed existing analytics; order accounting survives
-- message-ID changes, out-of-order refund snapshots and event retention.
begin;
reset role;
insert into auth.users(id,email) values ('72000000-0000-4000-8000-000000000001','google-prices@example.com');
select account_id as revenue_account from public.account_members where user_id = '72000000-0000-4000-8000-000000000001' \gset
update public.accounts set plan = 'pro' where id = :'revenue_account';
insert into public.apps(account_id,name,bundle_id,store,package_name)
  values (:'revenue_account','Prices','com.example.prices','play_store','com.example.prices') returning id as revenue_app \gset
insert into public.alert_channels(app_id,kind,config) values (:'revenue_app','webhook','{"url":"https://example.com/events"}');
select jsonb_build_object('id','72000000-0000-4000-8000-000000000010','store','play_store','environment','Production',
  'type','purchase','rawType','SUBSCRIPTION_4','occurredAt',now(),'productId','premium','transactionId','GPA.price',
  'originalTransactionId','google-play:' || repeat('a',64),'revenue',9.99,'currency','USD')::text as revenue_event \gset
select jsonb_build_object('order',jsonb_build_object('source','orders.get','orderId','GPA.price','currency','USD',
  'chargedAmount',9.99,'refundedAmount',0,'processedAt',now() - interval '1 second'))::text as revenue_payload \gset
set role service_role;
select public.record_google_play_event(:'revenue_app',:'revenue_event'::jsonb,:'revenue_payload'::jsonb) as priced \gset
select pg_temp.check((:'priced'::jsonb->>'fresh')::boolean and (:'priced'::jsonb->'event'->>'revenue')::numeric = 9.99,
  'verified order totals become event prices');
select pg_temp.check((select revenue = 9.99 and currency = 'USD' from public.store_events where app_id = :'revenue_app'),
  'Google event feed receives a price and currency');
select pg_temp.check((select gross_revenue = 9.99 and gross_revenue_usd = 9.99 from public.daily_revenue where app_id = :'revenue_app'),
  'Google prices flow into existing daily and USD analytics');
select public.record_google_play_event(:'revenue_app',:'revenue_event'::jsonb,:'revenue_payload'::jsonb) as replay \gset
select pg_temp.check(not (:'replay'::jsonb->>'fresh')::boolean, 'same delivery never counts twice');
select public.record_google_play_event(:'revenue_app',jsonb_set(:'revenue_event'::jsonb,'{id}','"72000000-0000-4000-8000-000000000011"'),
  :'revenue_payload'::jsonb) as charge_duplicate \gset
select pg_temp.check(:'charge_duplicate'::jsonb->'event'->>'revenue' is null
  and jsonb_array_length(:'charge_duplicate'::jsonb->'channels') = 0,
  'different delivery IDs cannot count or alert the same charge twice');
select pg_temp.check((select sum(revenue) = 9.99 and count(*) filter (where type = 'purchase') = 1
  from public.store_events where app_id = :'revenue_app'), 'duplicate charges leave revenue and purchase counts unchanged');

select (:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000012","type":"refund","revenue":-2}'::jsonb)::text as refund_event \gset
select jsonb_set(:'revenue_payload'::jsonb,'{order,refundedAmount}','2')::text as refund_payload \gset
select public.record_google_play_event(:'revenue_app',:'refund_event'::jsonb,:'refund_payload'::jsonb) as partial \gset
select pg_temp.check((:'partial'::jsonb->'event'->>'revenue')::numeric = -2, 'partial refund records the verified refund amount');
select public.record_google_play_event(:'revenue_app',(:'refund_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000013","revenue":-5}'::jsonb),
  jsonb_set(:'refund_payload'::jsonb,'{order,refundedAmount}','5')) as next_partial \gset
select pg_temp.check((:'next_partial'::jsonb->'event'->>'revenue')::numeric = -3,
  'next partial refund records only the increment and returns it for alerts');
select public.record_google_play_event(:'revenue_app',jsonb_set(:'refund_event'::jsonb,'{id}','"72000000-0000-4000-8000-000000000014"'),
  :'refund_payload'::jsonb) as older_refund \gset
select pg_temp.check(:'older_refund'::jsonb->'event'->>'revenue' is null and jsonb_array_length(:'older_refund'::jsonb->'channels') = 0,
  'older or duplicate refund snapshots cannot repeat refunds or alerts');
select public.record_google_play_event(:'revenue_app',(:'refund_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000015","revenue":-9.99}'::jsonb),
  jsonb_set(:'refund_payload'::jsonb,'{order,refundedAmount}','9.99')) as full_refund \gset
select pg_temp.check((:'full_refund'::jsonb->'event'->>'revenue')::numeric = -4.99,
  'full refund after partial refunds records only the remaining amount');
select pg_temp.check((select sum(revenue) = 0 from public.store_events where app_id = :'revenue_app'),
  'fully refunded order nets to zero');

-- Environment isolation, zero-price trials, and database validation.
select public.record_google_play_event(:'revenue_app',(:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000016","environment":"Sandbox"}'::jsonb),
  :'revenue_payload'::jsonb) as sandbox_price \gset
select pg_temp.check((:'sandbox_price'::jsonb->'event'->>'revenue')::numeric = 9.99,
  'sandbox and production order accounting remain separate');
select public.record_google_play_event(:'revenue_app',(:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000017","type":"trial_started","revenue":0,"transactionId":"GPA.trial","isTrial":true}'::jsonb),
  jsonb_set(jsonb_set(:'revenue_payload'::jsonb,'{order,orderId}','"GPA.trial"'),'{order,chargedAmount}','0')) as trial_price \gset
select pg_temp.check((:'trial_price'::jsonb->'event'->>'revenue')::numeric = 0, 'verified zero prices are preserved');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'revenue_app',:'revenue_event','{}'),
  '22023', 'unverified prices are rejected');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'revenue_app',
  jsonb_set(:'revenue_event'::jsonb,'{currency}','"EUR"')::text,:'revenue_payload'), '22023', 'currency mismatches are rejected');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'revenue_app',
  jsonb_set(:'revenue_event'::jsonb,'{transactionId}','"GPA.wrong"')::text,:'revenue_payload'), '22023', 'order identity mismatches are rejected');
select pg_temp.throws('select * from private.google_play_order_totals','42501','service clients must use accounting RPCs');

-- A failure after claiming the order rolls back its claim with the event.
select (:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000019","transactionId":"GPA.atomic"}'::jsonb)::text as atomic_event \gset
select jsonb_set(:'revenue_payload'::jsonb,'{order,orderId}','"GPA.atomic"')::text as atomic_payload \gset
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'revenue_app',
  (:'atomic_event'::jsonb - 'rawType')::text, :'atomic_payload'), '23502', 'failed event insertion rolls back order accounting');
select public.record_google_play_event(:'revenue_app',:'atomic_event'::jsonb,:'atomic_payload'::jsonb) as atomic_retry \gset
select pg_temp.check((:'atomic_retry'::jsonb->'event'->>'revenue')::numeric = 9.99,
  'retry after failed persistence still records the charge');

-- Refunds may arrive before their purchase; neither direction loses money.
select (:'refund_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000020","transactionId":"GPA.reversed"}'::jsonb)::text as reverse_refund \gset
select jsonb_set(:'refund_payload'::jsonb,'{order,orderId}','"GPA.reversed"')::text as reverse_refund_payload \gset
select public.record_google_play_event(:'revenue_app',:'reverse_refund'::jsonb,:'reverse_refund_payload'::jsonb);
select public.record_google_play_event(:'revenue_app',(:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000021","transactionId":"GPA.reversed"}'::jsonb),
  jsonb_set(:'revenue_payload'::jsonb,'{order,orderId}','"GPA.reversed"'));
select pg_temp.check((select sum(revenue) = 7.99 from public.store_events where app_id = :'revenue_app' and transaction_id = 'GPA.reversed'),
  'refund before purchase reconciles to the correct net total');
reset role;
-- Retention deletes event history, never the persistent accounting claim.
delete from public.store_events where app_id = :'revenue_app';
set role service_role;
select public.record_google_play_event(:'revenue_app',(:'revenue_event'::jsonb || '{"id":"72000000-0000-4000-8000-000000000018"}'::jsonb),
  :'revenue_payload'::jsonb) as retained_duplicate \gset
select pg_temp.check(:'retained_duplicate'::jsonb->'event'->>'revenue' is null,
  'event retention cannot make an old charge count again');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','72000000-0000-4000-8000-000000000001',true);
select pg_temp.throws('select * from private.google_play_order_totals','42501','browser clients cannot read private accounting');
reset role;
delete from public.apps where id = :'revenue_app';
select pg_temp.check(not exists(select 1 from private.google_play_order_totals where app_id = :'revenue_app'),
  'app deletion also deletes order accounting');
rollback;
