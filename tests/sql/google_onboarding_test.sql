-- User-authorized Google onboarding never exposes a credential or a Vault ID.
begin;
reset role;
create function pg_temp.google_throws(stmt text, expected_state text, expected_message text, what text)
returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlstate = expected_state and sqlerrm = expected_message then
      raise notice 'ok - %', what; return;
    end if;
    raise exception 'FAILED: % (got % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', what;
end $$;

-- Missing RPCs must fail this assertion before implementation.
select pg_temp.check(to_regprocedure('public.google_connection_status(uuid,uuid)') is not null,
  'Google connection status RPC exists');
select pg_temp.check(to_regprocedure('public.save_user_google_play_connection(uuid,uuid,text,text,text,text,text,jsonb,text)') is not null,
  'guarded Google connection save RPC exists');
select pg_temp.check(to_regprocedure('public.delete_user_google_play_connection(uuid,uuid)') is not null,
  'guarded Google connection deletion RPC exists');

insert into auth.users(id,email) values
  ('71000000-0000-4000-8000-000000000001','google-onboarding-owner@example.com'),
  ('71000000-0000-4000-8000-000000000002','google-onboarding-outsider@example.com'),
  ('71000000-0000-4000-8000-000000000003','google-onboarding-member@example.com');
select account_id as onboarding_account from public.account_members
  where user_id = '71000000-0000-4000-8000-000000000001' \gset
update public.accounts set plan = 'pro' where id = :'onboarding_account';
insert into public.account_members(account_id,user_id,role)
  values (:'onboarding_account','71000000-0000-4000-8000-000000000003','member');
insert into public.apps(account_id,name,bundle_id,store,package_name,last_event_production_at,last_event_sandbox_at)
  values (:'onboarding_account','Google onboarding fixture','com.example.onboarding','play_store','com.example.onboarding',
    '2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')
  returning id as onboarding_app, webhook_key as onboarding_key \gset
insert into public.apps(account_id,name,bundle_id)
  values (:'onboarding_account','Onboarding iOS fixture','com.example.onboarding.ios')
  returning id as onboarding_ios, webhook_key as onboarding_ios_key \gset
select jsonb_build_object('type','service_account','client_email','publisher@fixture.iam.gserviceaccount.com',
  'private_key',E'-----BEGIN PRIVATE KEY-----\nONBOARDING_SQL_FIXTURE\n-----END PRIVATE KEY-----')::text as onboarding_credentials \gset
select format('select public.save_user_google_play_connection(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000001','com.example.onboarding',:'onboarding_key',
  'https://receiver.example.com/google/' || :'onboarding_key','push@fixture.iam.gserviceaccount.com',
  'projects/fixture/subscriptions/onboarding',:'onboarding_credentials','projects/fixture/topics/onboarding') as onboarding_save \gset

set role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select pg_temp.throws(format('select public.google_connection_status(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000001'),'42501','owners cannot invoke the service status RPC directly');
select pg_temp.throws(:'onboarding_save','42501','owners cannot invoke the guarded save RPC directly');
select pg_temp.throws(format('select public.delete_user_google_play_connection(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000001'),'42501','owners cannot invoke the service delete RPC directly');
reset role;
set role anon;
select pg_temp.throws(format('select public.google_connection_status(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000001'),'42501','anonymous callers cannot invoke connection status');
select pg_temp.throws(:'onboarding_save','42501','anonymous callers cannot save a Google connection');
select pg_temp.throws(format('select public.delete_user_google_play_connection(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000001'),'42501','anonymous callers cannot delete a Google connection');
reset role;

set role service_role;
select pg_temp.check(public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000001') is null,
  'owner sees no status for an unconfigured Google app');
select pg_temp.google_throws(format('select public.google_connection_status(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000002'),'42501','admin_required','cross-workspace status reads are denied');
select pg_temp.google_throws(format('select public.google_connection_status(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000003'),'42501','admin_required','read-only members cannot read connection metadata');
select pg_temp.google_throws(format('select public.google_connection_status(%L,%L)',
  :'onboarding_app',null),'42501','admin_required','missing user identity cannot read connection metadata');
select pg_temp.google_throws(format('select public.google_connection_status(%L,%L)',
  '71000000-0000-4000-8000-000000000099','71000000-0000-4000-8000-000000000001'),
  'P0002','app_not_found','status reports an absent app');
select pg_temp.google_throws(replace(:'onboarding_save','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002'),
  '42501','admin_required','cross-workspace save is denied');
select pg_temp.google_throws(replace(:'onboarding_save','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003'),
  '42501','admin_required','read-only members cannot configure Google');
select pg_temp.google_throws(replace(:'onboarding_save',:'onboarding_app','71000000-0000-4000-8000-000000000099'),
  'P0002','app_not_found','save reports an absent app');
select pg_temp.google_throws(replace(:'onboarding_save','com.example.onboarding','com.example.stale'),
  '22023','preview_changed','stale package names abort a save');
select pg_temp.google_throws(replace(:'onboarding_save',:'onboarding_key','stale-key'),
  '22023','preview_changed','stale webhook keys abort a save');
select pg_temp.google_throws(format('select public.save_user_google_play_connection(%L,%L,%L,%L,%L,%L,%L,%L,%L)',
  :'onboarding_ios','71000000-0000-4000-8000-000000000001',null,:'onboarding_ios_key',
  'https://receiver.example.com/google','push@fixture.iam.gserviceaccount.com',
  'projects/fixture/subscriptions/onboarding',:'onboarding_credentials','projects/fixture/topics/onboarding'),
  '22023','preview_changed','non-Android apps cannot be connected from a stale preview');
select pg_temp.google_throws(replace(:'onboarding_save','projects/fixture/topics/onboarding','topics/onboarding'),
  '22023','invalid_google_connection','topics require their full project resource name');
select pg_temp.google_throws(replace(:'onboarding_save','projects/fixture/topics/onboarding','projects/fixture/topics/onboarding/extra'),
  '22023','invalid_google_connection','topic names cannot contain trailing resource segments');
select pg_temp.google_throws(replace(:'onboarding_save','projects/fixture/topics/onboarding','projects/fixture/topics/' || repeat('a',512)),
  '22023','invalid_google_connection','oversized topic resource names are rejected');
select pg_temp.google_throws(replace(:'onboarding_save','-----BEGIN PRIVATE KEY-----','NO PRIVATE KEY'),
  '22023','invalid_google_credentials','guarded saves preserve credential validation');
reset role;
select pg_temp.check(not exists(select 1 from private.google_play_connections where app_id = :'onboarding_app'),
  'rejected saves create neither a connection nor its secret');
select pg_temp.check(not exists(select 1 from vault.secrets where name = 'salebell/google-play/' || :'onboarding_app'),
  'failed guarded saves leave no Vault secret');
select pg_temp.check((select last_event_production_at is not null and last_event_sandbox_at is not null
  from public.apps where id = :'onboarding_app'),'failed configuration preserves prior activity');

set role service_role;
:onboarding_save;
select public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000001')::text as onboarding_status \gset
select pg_temp.check(:'onboarding_status'::jsonb->>'topic' = 'projects/fixture/topics/onboarding'
  and :'onboarding_status'::jsonb->>'subscription' = 'projects/fixture/subscriptions/onboarding'
  and :'onboarding_status'::jsonb->>'audience' = 'https://receiver.example.com/google/' || :'onboarding_key'
  and :'onboarding_status'::jsonb->>'service_account_email' = 'push@fixture.iam.gserviceaccount.com'
  and (:'onboarding_status'::jsonb->>'updated_at')::timestamptz is not null,
  'saved status returns the authorized push configuration');
select pg_temp.check((select array_agg(k order by k) from jsonb_object_keys(:'onboarding_status'::jsonb) k)
  = array['audience','service_account_email','subscription','topic','updated_at'],
  'status has only the five public metadata fields');
select pg_temp.check(position('ONBOARDING_SQL_FIXTURE' in :'onboarding_status') = 0,
  'status excludes the private credential contents');
select pg_temp.check((select last_event_production_at is null and last_event_sandbox_at is null
  from public.apps where id = :'onboarding_app'),'new connection requires a fresh verified delivery');
reset role;
select vault_secret_id as onboarding_secret from private.google_play_connections where app_id = :'onboarding_app' \gset
select pg_temp.throws(format('update private.google_play_connections set topic = %L where app_id = %L',
  'topics/bypass',:'onboarding_app'),'23514','the private table also enforces full topic resource names');

-- A delivery verifies this exact configuration; an identical save keeps it verified.
update public.apps set last_event_production_at = '2026-10-03T00:00:00Z',
  last_event_sandbox_at = '2026-10-04T00:00:00Z' where id = :'onboarding_app';
update private.google_play_connections set updated_at = '2026-10-03T00:00:00Z' where app_id = :'onboarding_app';
update vault.secrets set updated_at = '2026-10-03T00:00:00Z' where id = :'onboarding_secret';
set role service_role;
:onboarding_save;
select pg_temp.check((select last_event_production_at = '2026-10-03T00:00:00Z' and last_event_sandbox_at = '2026-10-04T00:00:00Z'
  from public.apps where id = :'onboarding_app'),'identical saves preserve verified delivery timestamps');
select pg_temp.check((public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000001')->>'updated_at')::timestamptz
  = '2026-10-03T00:00:00Z','identical saves preserve configuration update time');
reset role;
select pg_temp.check((select updated_at = '2026-10-03T00:00:00Z' from vault.secrets where id = :'onboarding_secret'),
  'identical saves do not rewrite Vault credentials');
set role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select pg_temp.google_throws(format('update public.apps set package_name = %L, bundle_id = %L where id = %L',
  'com.example.changed','com.example.changed',:'onboarding_app'),'55000','google_connection_configured',
  'configured Android identifiers cannot be changed by the owner');
update public.apps set name = 'Renamed Google fixture' where id = :'onboarding_app';
reset role;
select pg_temp.google_throws(format('update public.apps set store = %L, package_name = null where id = %L',
  'app_store',:'onboarding_app'),'55000','google_connection_configured','platform changes cannot bypass the identifier guard');

-- Membership is checked again when the service commits a configuration.
update public.account_members set role = 'admin' where account_id = :'onboarding_account'
  and user_id = '71000000-0000-4000-8000-000000000003';
set role service_role;
select pg_temp.check(public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000003') is not null,
  'workspace admins can read connection status');
select public.save_user_google_play_connection(:'onboarding_app','71000000-0000-4000-8000-000000000003',
  'com.example.onboarding',:'onboarding_key','https://receiver.example.com/google/' || :'onboarding_key',
  'push@fixture.iam.gserviceaccount.com','projects/fixture/subscriptions/onboarding',:'onboarding_credentials'::jsonb,null);
select pg_temp.check(public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000003')->'topic' = 'null'::jsonb,
  'manual connections may omit topic metadata');
select pg_temp.check((select last_event_production_at is null and last_event_sandbox_at is null
  from public.apps where id = :'onboarding_app'),'changed topic metadata resets delivery verification');
reset role;
update public.apps set last_event_production_at = '2026-10-05T00:00:00Z' where id = :'onboarding_app';
set role service_role;
select public.save_user_google_play_connection(:'onboarding_app','71000000-0000-4000-8000-000000000001',
  'com.example.onboarding',:'onboarding_key','https://receiver.example.com/google/' || :'onboarding_key',
  'push@fixture.iam.gserviceaccount.com','projects/fixture/subscriptions/onboarding',
  replace(:'onboarding_credentials','ONBOARDING_SQL_FIXTURE','ONBOARDING_SQL_ROTATED')::jsonb,null);
select pg_temp.check((select last_event_production_at is null from public.apps where id = :'onboarding_app'),
  'credential rotation requires fresh delivery even when metadata is unchanged');
select pg_temp.google_throws(format('select public.delete_user_google_play_connection(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000002'),'42501','admin_required','cross-workspace disconnection is denied');
reset role;
update public.account_members set role = 'member' where account_id = :'onboarding_account'
  and user_id = '71000000-0000-4000-8000-000000000003';
set role service_role;
select pg_temp.google_throws(replace(:'onboarding_save','71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000003'),
  '42501','admin_required','revoked admins cannot commit a previously prepared connection');
select pg_temp.google_throws(format('select public.delete_user_google_play_connection(%L,%L)',
  :'onboarding_app','71000000-0000-4000-8000-000000000003'),'42501','admin_required','read-only members cannot disconnect Google');
reset role;
update public.apps set last_event_production_at = '2026-10-06T00:00:00Z',last_event_sandbox_at = '2026-10-06T00:00:00Z'
  where id = :'onboarding_app';
set role service_role;
select pg_temp.check(public.delete_user_google_play_connection(:'onboarding_app','71000000-0000-4000-8000-000000000001'),
  'owner can disconnect the configured app');
select pg_temp.check(public.google_connection_status(:'onboarding_app','71000000-0000-4000-8000-000000000001') is null,
  'disconnected apps have no connection status');
select pg_temp.check(public.load_google_play_credentials(:'onboarding_app') is null,
  'disconnection removes Publisher credentials');
select pg_temp.check(not public.delete_user_google_play_connection(:'onboarding_app','71000000-0000-4000-8000-000000000001'),
  'repeated disconnection returns false');
select pg_temp.google_throws(format('select public.delete_user_google_play_connection(%L,%L)',
  '71000000-0000-4000-8000-000000000099','71000000-0000-4000-8000-000000000001'),
  'P0002','app_not_found','disconnection reports an absent app');
select pg_temp.check((select last_event_production_at is null and last_event_sandbox_at is null
  from public.apps where id = :'onboarding_app'),'disconnection clears verified delivery timestamps');
reset role;
select pg_temp.check(not exists(select 1 from vault.secrets where id = :'onboarding_secret'),
  'disconnection also deletes the encrypted Vault secret');
set role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
update public.apps set package_name = 'com.example.changed',bundle_id = 'com.example.changed' where id = :'onboarding_app';
select pg_temp.check((select package_name = 'com.example.changed' from public.apps where id = :'onboarding_app'),
  'owners can edit Android identifiers after disconnecting');
reset role;

-- A delivery authenticated before reconfiguration cannot verify the new generation.
set role service_role;
select replace(:'onboarding_save','com.example.onboarding','com.example.changed') as generation_save \gset
:generation_save;
select connection_version as generation_original from public.google_webhook_app(:'onboarding_key') \gset
:generation_save;
select pg_temp.check((select connection_version = :'generation_original'::uuid
  from public.google_webhook_app(:'onboarding_key')),'identical retries preserve the connection generation');
select replace(:'generation_save','ONBOARDING_SQL_FIXTURE','ONBOARDING_GENERATION_ROTATED') as generation_rotate \gset
:generation_rotate;
select connection_version as generation_rotated from public.google_webhook_app(:'onboarding_key') \gset
select pg_temp.check(:'generation_original'::uuid <> :'generation_rotated'::uuid,
  'credential-only rotation changes generation even within one transaction');
select '{"id":"71000000-0000-4000-8000-000000000101","store":"play_store","environment":"Production","type":"test","rawType":"TEST","occurredAt":"2026-10-14T10:00:00Z"}' as generation_event \gset
select format('select public.record_google_play_event(%L,%L,%L,%L)',
  :'onboarding_app',:'generation_event','{}',:'generation_original') as generation_stale_record \gset
select pg_temp.google_throws(:'generation_stale_record','22023','preview_changed',
  'a delivery authenticated against the old credential generation cannot record');
select pg_temp.google_throws(format('select public.record_google_play_event(%L,%L,%L,null)',
  :'onboarding_app',:'generation_event','{}'),'22023','preview_changed','guarded recording requires a non-null generation');
select pg_temp.check((select last_event_production_at is null and last_event_sandbox_at is null
  from public.apps where id = :'onboarding_app'),'stale deliveries cannot verify the replacement connection');
select pg_temp.check((select count(*) from public.store_events where app_id = :'onboarding_app') = 0,
  'stale deliveries never enter event history');
reset role;
set role authenticated;
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L,%L)',
  :'onboarding_app',:'generation_event','{}',:'generation_rotated'),'42501','browser owners cannot call generation-aware recording');
reset role;
set role anon;
select pg_temp.throws(format('select public.record_google_play_event(%L,%L,%L,%L)',
  :'onboarding_app',:'generation_event','{}',:'generation_rotated'),'42501','anonymous callers cannot call generation-aware recording');
reset role;
set role service_role;
select public.record_google_play_event(:'onboarding_app',:'generation_event'::jsonb,'{}'::jsonb,:'generation_rotated'::uuid) as generation_result \gset
select pg_temp.check((:'generation_result'::jsonb->>'fresh')::boolean,
  'a delivery authenticated against the current generation records normally');
select pg_temp.check((select last_event_production_at is not null from public.apps where id = :'onboarding_app'),
  'current-generation recording verifies the connection');
select public.delete_user_google_play_connection(:'onboarding_app','71000000-0000-4000-8000-000000000001');
select replace(:'generation_event','71000000-0000-4000-8000-000000000101','71000000-0000-4000-8000-000000000102') as generation_next_event \gset
select format('select public.record_google_play_event(%L,%L,%L,%L)',
  :'onboarding_app',:'generation_next_event','{}',:'generation_rotated') as generation_disconnected_record \gset
select pg_temp.google_throws(:'generation_disconnected_record','22023','preview_changed',
  'disconnect rejects an in-flight delivery before it can restore activity');
:generation_rotate;
select connection_version as generation_reconnected from public.google_webhook_app(:'onboarding_key') \gset
select pg_temp.check(:'generation_reconnected'::uuid <> :'generation_rotated'::uuid,
  'reconnecting with identical settings creates a new generation');
select pg_temp.google_throws(:'generation_disconnected_record','22023','preview_changed',
  'a delivery from before disconnect cannot verify an identical reconnect');
select pg_temp.check((select last_event_production_at is null and last_event_sandbox_at is null
  from public.apps where id = :'onboarding_app'),'rejected pre-disconnect deliveries leave reconnect unverified');
select pg_temp.check((select count(*) from public.store_events where app_id = :'onboarding_app') = 1,
  'rejected pre-disconnect deliveries leave event history unchanged');
select public.record_google_play_event(:'onboarding_app',:'generation_next_event'::jsonb,'{}'::jsonb,:'generation_reconnected'::uuid) as generation_next_result \gset
select pg_temp.check((:'generation_next_result'::jsonb->>'fresh')::boolean,
  'the reconnect accepts deliveries authenticated against its new generation');
reset role;
rollback;
