-- Google connections are operator managed; notifications retain no purchase tokens.
begin;
reset role;
select pg_temp.check(exists (select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'apps' and column_name = 'store'
    and column_default = '''app_store''::text' and is_nullable = 'NO'),
  'legacy apps default to the App Store');

insert into auth.users(id, email) values
  ('70000000-0000-4000-8000-000000000001', 'play-owner@example.com'),
  ('70000000-0000-4000-8000-000000000002', 'play-outsider@example.com');
select account_id as play_account from public.account_members
  where user_id = '70000000-0000-4000-8000-000000000001' \gset
update public.accounts set plan = 'pro' where id = :'play_account';

-- Platform-specific identities can share an identifier, but never collide in one store.
set role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);
insert into public.apps(account_id,name,bundle_id) values (:'play_account','iOS app','com.example.shared')
  returning id as play_apple_app, webhook_key as play_apple_key \gset
insert into public.apps(account_id,name,bundle_id,store,package_name)
  values (:'play_account','Android app','com.example.shared','play_store','com.example.shared')
  returning id as play_app, webhook_key as play_key \gset
insert into public.apps(account_id,name,bundle_id,store,package_name)
  values (:'play_account','Unconfigured Android','com.example.unconfigured','play_store','com.example.unconfigured')
  returning id as play_unconfigured, webhook_key as play_unconfigured_key \gset
select pg_temp.check((select count(*) from public.apps where account_id = :'play_account' and bundle_id = 'com.example.shared') = 2,
  'an account can track the same app identifier on both stores');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,store,package_name) values (%L,%L,%L,%L,%L)',
  :'play_account','Duplicate','com.example.shared','play_store','com.example.shared'), '23505',
  'duplicate Android app identifiers are rejected within a workspace');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,store,package_name) values (%L,%L,%L,%L,%L)',
  :'play_account','Malformed','com.example.bad','play_store','not-a-package'), '23514', 'Android package names must have valid segments');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,store) values (%L,%L,%L,%L)',
  :'play_account','Missing package','com.example.missing','play_store'), '23514', 'Android apps require a package name');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,package_name) values (%L,%L,%L,%L)',
  :'play_account','iOS package','com.example.wrongios','com.example.wrongios'), '23514', 'App Store apps cannot have an Android package name');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,store,package_name,apple_app_id) values (%L,%L,%L,%L,%L,123)',
  :'play_account','Android Apple ID','com.example.wrongapple','play_store','com.example.wrongapple'), '23514',
  'Android apps cannot carry an Apple app ID');
select pg_temp.throws(format('insert into public.apps(account_id,name,bundle_id,store,package_name) values (%L,%L,%L,%L,%L)',
  :'play_account','Wrong identifier','com.example.legacy','play_store','com.example.package'), '23514',
  'Android legacy identifiers remain equal to the package name');
select pg_temp.throws(format('update public.apps set store = %L where id = %L', 'app_store', :'play_app'), '42501',
  'customers cannot switch an existing app to another platform');
insert into public.alert_channels(app_id,kind,config,environments) values
  (:'play_app','webhook','{"url":"https://alerts.example.com/events"}',array['Production','Sandbox']);
select public.register_push_device(repeat('7',64), 'production', 'play-sql-test') as play_device \gset
reset role;

-- These JSON keys are SQL-only fixtures, never real service account credentials.
select jsonb_build_object('type','service_account','client_email','publisher@project.iam.gserviceaccount.com',
  'private_key',E'-----BEGIN PRIVATE KEY-----\nPLAY_SQL_ORIGINAL\n-----END PRIVATE KEY-----')::text as play_credentials \gset
set role service_role;
select pg_temp.check((select count(*) from public.google_webhook_app(:'play_key')) = 0,
  'Google lookup excludes apps until an operator configures a connection');
select pg_temp.check((select count(*) from public.webhook_app(:'play_key')) = 0,
  'Apple lookup never exposes Android apps');
select pg_temp.check((select count(*) from public.google_webhook_app(:'play_apple_key')) = 0,
  'Google lookup never exposes App Store apps');
select pg_temp.check((select id from public.webhook_app(:'play_apple_key')) = :'play_apple_app'::uuid,
  'Apple lookup continues to expose App Store apps');
select public.save_google_play_connection(:'play_app','https://receiver.example.com/google/' || :'play_key',
  'push@project.iam.gserviceaccount.com','projects/project/subscriptions/play-rtdn',:'play_credentials'::jsonb);
select pg_temp.check((select id = :'play_app'::uuid and name = 'Android app' and package_name = 'com.example.shared'
  and enabled and audience = 'https://receiver.example.com/google/' || :'play_key'
  and service_account_email = 'push@project.iam.gserviceaccount.com' and subscription = 'projects/project/subscriptions/play-rtdn'
  from public.google_webhook_app(:'play_key')), 'configured Google lookup returns push verification metadata');
select pg_temp.check((select not (to_jsonb(g) ?| array['private_key','credentials','vault_secret_id','decrypted_secret'])
  from public.google_webhook_app(:'play_key') g), 'Google lookup excludes Vault IDs and private credentials');
select pg_temp.check(public.load_google_play_credentials(:'play_app') = :'play_credentials'::jsonb,
  'only the service RPC loads the Publisher service account JSON');
select pg_temp.check(public.load_google_play_credentials(:'play_unconfigured') is null,
  'credential loads for unconfigured apps return no secret');
select pg_temp.throws('select * from private.google_play_connections', '42501',
  'service clients cannot bypass Google connection RPCs to access the private table');

select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_apple_app','https://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn',:'play_credentials'), '22023', 'Apple apps cannot receive Google configuration');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','http://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn',:'play_credentials'), '22023', 'Google audiences must use HTTPS');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://127.0.0.1/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn',:'play_credentials'), '22023', 'Google audiences cannot point at private IP literals');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://receiver.example.com/google','not-an-email',
  'projects/project/subscriptions/play-rtdn',:'play_credentials'), '22023', 'push identity must be a service account email');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'topics/play-rtdn',:'play_credentials'), '22023', 'Google connections require a full Pub/Sub subscription resource');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn','{"type":"service_account","client_email":"publisher@project.iam.gserviceaccount.com","private_key":"not-pem"}'),
  '22023', 'Publisher credentials require a PEM private key');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn',(:'play_credentials'::jsonb - 'client_email')::text),
  '22023', 'Publisher credentials require a service account client email');
reset role;
select vault_secret_id as play_secret from private.google_play_connections where app_id = :'play_app' \gset
select pg_temp.check((select secret not like '%PLAY_SQL_ORIGINAL%' from vault.secrets where id = :'play_secret'),
  'Google service account JSON is encrypted in Vault');
select pg_temp.check((select decrypted_secret::jsonb = :'play_credentials'::jsonb from vault.decrypted_secrets where id = :'play_secret'),
  'privileged server access decrypts the original Google credentials');

-- Browser JWTs cannot save, load, look up or record Google connection data.
set role authenticated;
select pg_temp.throws('select * from private.google_play_connections', '42501', 'owners cannot read the private Google connection table');
select pg_temp.throws('select * from vault.decrypted_secrets', '42501', 'owners cannot read Google Vault secrets');
select pg_temp.throws(format('select public.save_google_play_connection(%L,%L,%L,%L,%L)',
  :'play_app','https://receiver.example.com/google','push@project.iam.gserviceaccount.com',
  'projects/project/subscriptions/play-rtdn',:'play_credentials'), '42501', 'owners cannot configure Google credentials through public RPCs');
select pg_temp.throws(format('select public.load_google_play_credentials(%L)', :'play_app'), '42501',
  'owners cannot load Google credentials through public RPCs');
select pg_temp.throws(format('select public.google_webhook_app(%L)', :'play_key'), '42501',
  'owners cannot call the Google webhook lookup');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app','{}','{}'), '42501',
  'owners cannot record Google webhook events directly');
reset role;
set role anon;
select pg_temp.throws(format('select public.load_google_play_credentials(%L)', :'play_app'), '42501',
  'anonymous callers cannot load Google credentials');
select pg_temp.throws(format('select public.google_webhook_app(%L)', :'play_key'), '42501',
  'anonymous callers cannot call the Google webhook lookup');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app','{}','{}'), '42501',
  'anonymous callers cannot record Google webhook events');
reset role;

-- Rotating a connection replaces its protected secret without creating an orphan.
set role service_role;
select public.save_google_play_connection(:'play_app','https://receiver.example.com/google/' || :'play_key',
  'rotated-push@project.iam.gserviceaccount.com','projects/project/subscriptions/play-rtdn-rotated',
  jsonb_set(:'play_credentials'::jsonb,'{private_key}',to_jsonb(E'-----BEGIN PRIVATE KEY-----\nPLAY_SQL_ROTATED\n-----END PRIVATE KEY-----'::text)));
select pg_temp.check(public.load_google_play_credentials(:'play_app')->>'private_key' =
  E'-----BEGIN PRIVATE KEY-----\nPLAY_SQL_ROTATED\n-----END PRIVATE KEY-----', 'operator rotation replaces the encrypted Google key');
reset role;
select pg_temp.check((select vault_secret_id = :'play_secret'::uuid from private.google_play_connections where app_id = :'play_app'),
  'Google credential rotation reuses the existing Vault secret');
select pg_temp.check((select count(*) from vault.secrets where name = 'salebell/google-play/' || :'play_app') = 1,
  'Google credential rotation does not leave orphaned secrets');

-- The shared event recorder preserves duplicate handling, alert gating and tenancy.
select jsonb_build_object('id','71000000-0000-4000-8000-000000000001','store','play_store','environment','Production',
  'type','renewal','rawType','SUBSCRIPTION_RENEWED','occurredAt',now(),'productId','premium.monthly',
  'originalTransactionId','google-play:' || repeat('a',64),'revenue',null,'currency',null)::text as play_event \gset
select '{"messageId":"12345","subscription":"projects/project/subscriptions/play-rtdn-rotated","packageName":"com.example.shared","purchaseTokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","purchase":{"state":"SUBSCRIPTION_STATE_ACTIVE","productIds":["premium.monthly"]}}' as play_payload \gset
set role service_role;
select public.record_google_play_event(:'play_app',:'play_event'::jsonb,:'play_payload'::jsonb) as play_result \gset
select pg_temp.check((:'play_result'::jsonb->>'fresh')::boolean and (:'play_result'::jsonb->>'active')::boolean
  and jsonb_array_length(:'play_result'::jsonb->'channels') = 1 and jsonb_array_length(:'play_result'::jsonb->'devices') = 1,
  'Google events use the shared integration and device fan-out');
select public.record_google_play_event(:'play_app',:'play_event'::jsonb,:'play_payload'::jsonb) as play_duplicate \gset
select pg_temp.check(not (:'play_duplicate'::jsonb->>'fresh')::boolean
  and jsonb_array_length(:'play_duplicate'::jsonb->'channels') = 0
  and jsonb_array_length(:'play_duplicate'::jsonb->'devices') = 0, 'duplicate Google messages never dispatch twice');
select pg_temp.check((select count(*) from public.store_events where app_id = :'play_app') = 1,
  'duplicate Google messages create one event');
select pg_temp.check((select revenue is null and currency is null and payload = :'play_payload'::jsonb
  from public.store_events where app_id = :'play_app'), 'Google events retain unknown revenue and sanitized metadata');
select pg_temp.check((select count(*) from public.store_transactions where app_id = :'play_app') = 0,
  'Google notifications do not create Apple-shaped ledger transactions');
select pg_temp.check((select last_event_production_at is not null from public.apps where id = :'play_app'),
  'Google recordings update the shared connection activity timestamp');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_apple_app', :'play_event', :'play_payload'),
  '22023', 'Google recorder rejects App Store apps');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app',
  jsonb_set(:'play_event'::jsonb,'{store}','"app_store"')::text, :'play_payload'), '22023', 'Google recorder rejects Apple events');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app',
  jsonb_set(:'play_event'::jsonb,'{revenue}','0')::text, :'play_payload'), '22023', 'Google recorder rejects guessed zero revenue');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app',
  jsonb_set(:'play_event'::jsonb,'{currency}','"USD"')::text, :'play_payload'), '22023', 'Google recorder rejects guessed currency');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app', :'play_event',
  '{"subscriptionNotification":{"purchaseToken":"MUST_NOT_PERSIST"}}'), '22023', 'Google recorder rejects nested raw purchase tokens');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app', :'play_event',
  '{"purchase":{"linkedPurchaseToken":"MUST_NOT_PERSIST"}}'), '22023', 'Google recorder rejects linked purchase tokens');
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L)', :'play_app', :'play_event',
  '{"responses":[{"purchase_token":"MUST_NOT_PERSIST"}]}'), '22023', 'Google recorder rejects snake case purchase tokens in arrays');
reset role;

set role authenticated;
select pg_temp.check((select count(*) from public.store_events where app_id = :'play_app') = 1,
  'Android owners read Google event history through existing RLS');
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select pg_temp.check((select count(*) from public.store_events where app_id = :'play_app') = 0,
  'Google event history remains isolated between accounts');
reset role;
update public.apps set created_at = now() - interval '1 day' where id = :'play_apple_app';
update public.accounts set plan = 'free' where id = :'play_account';
set role service_role;
select public.record_google_play_event(:'play_app',
  jsonb_set(:'play_event'::jsonb,'{id}','"71000000-0000-4000-8000-000000000002"'),:'play_payload'::jsonb) as play_paused \gset
select pg_temp.check((:'play_paused'::jsonb->>'fresh')::boolean and not (:'play_paused'::jsonb->>'active')::boolean
  and jsonb_array_length(:'play_paused'::jsonb->'channels') = 0 and jsonb_array_length(:'play_paused'::jsonb->'devices') = 0,
  'Google events for apps beyond the plan limit are recorded with alerts paused');
reset role;

-- Explicit connection deletion and app cascades both erase their Vault secrets.
delete from private.google_play_connections where app_id = :'play_app';
select pg_temp.check(not exists(select 1 from vault.secrets where id = :'play_secret'),
  'deleting a Google connection deletes its Vault secret');
set role service_role;
select pg_temp.check((select count(*) from public.google_webhook_app(:'play_key')) = 0,
  'deleted Google connections disappear from webhook lookup');
select public.save_google_play_connection(:'play_app','https://receiver.example.com/google/' || :'play_key',
  'push@project.iam.gserviceaccount.com','projects/project/subscriptions/play-rtdn',:'play_credentials'::jsonb);
reset role;
select vault_secret_id as play_cascade_secret from private.google_play_connections where app_id = :'play_app' \gset
delete from public.apps where id = :'play_app';
select pg_temp.check(not exists(select 1 from private.google_play_connections where app_id = :'play_app'),
  'deleting an Android app cascades its Google connection');
select pg_temp.check(not exists(select 1 from vault.secrets where id = :'play_cascade_secret'),
  'deleting an Android app also deletes its Google Vault secret');
rollback;
