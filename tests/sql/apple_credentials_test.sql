-- Saved-key tenancy, metadata-only responses, privileges, rotation and cleanup.
-- Uses the TEST ONLY encrypted Vault fixture from supabase_stub.sql.
reset role;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'credential-owner@example.com'),
  ('00000000-0000-0000-0000-0000000000f2', 'credential-admin@example.com'),
  ('00000000-0000-0000-0000-0000000000f3', 'credential-member@example.com'),
  ('00000000-0000-0000-0000-0000000000f4', 'credential-outsider@example.com');
select account_id as credential_account from public.account_members
  where user_id = '00000000-0000-0000-0000-0000000000f1' \gset
select account_id as credential_other_account from public.account_members
  where user_id = '00000000-0000-0000-0000-0000000000f4' \gset
insert into public.account_members(account_id, user_id, role) values
  (:'credential_account', '00000000-0000-0000-0000-0000000000f2', 'admin'),
  (:'credential_account', '00000000-0000-0000-0000-0000000000f3', 'member');

set role service_role;
select * from public.save_apple_credential(:'credential_account', '00000000-0000-0000-0000-0000000000f1',
  'apple_connect', 'Apple team', 'ABCDE12345', '11111111-1111-1111-1111-111111111111',
  E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_ORIGINAL\n-----END PRIVATE KEY-----') \gset credential_saved_
select pg_temp.check(:'credential_saved_account_id' = :'credential_account' and :'credential_saved_label' = 'Apple team',
  'owner saves a workspace Apple credential');
select pg_temp.check((select count(*) from public.list_apple_credentials(:'credential_account',
  '00000000-0000-0000-0000-0000000000f2')) = 1, 'admin lists workspace Apple credential metadata');
select pg_temp.check((select bool_and(not (to_jsonb(c) ?| array['private_key','vault_secret_id','secret','decrypted_secret']))
  from public.list_apple_credentials(:'credential_account', '00000000-0000-0000-0000-0000000000f1') c),
  'credential list returns metadata without key material or Vault IDs');
select pg_temp.check(public.load_apple_credential(:'credential_saved_id', :'credential_account',
  '00000000-0000-0000-0000-0000000000f2')->>'private_key' =
  E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_ORIGINAL\n-----END PRIVATE KEY-----', 'admin loads key only through the service RPC');
select pg_temp.check(public.load_apple_credential(:'credential_saved_id', :'credential_account',
  '00000000-0000-0000-0000-0000000000f1', 'apple_iap') is null, 'ASC credential cannot be loaded as an IAP key');
select pg_temp.check((select count(*) from public.list_apple_credentials(:'credential_account',
  '00000000-0000-0000-0000-0000000000f1', 'apple_iap')) = 0, 'credential metadata is filtered by provider');

-- Explicit p_user authorization remains required even for service-role calls.
select pg_temp.throws(format('select public.list_apple_credentials(%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f3'), '42501', 'ordinary members cannot list Apple connections');
select pg_temp.throws(format('select public.load_apple_credential(%L,%L,%L)',
  :'credential_saved_id', :'credential_account', '00000000-0000-0000-0000-0000000000f3'), '42501', 'ordinary members cannot load keys');
select pg_temp.throws(format('select public.delete_apple_credential(%L,%L,%L)',
  :'credential_saved_id', :'credential_account', '00000000-0000-0000-0000-0000000000f3'), '42501', 'ordinary members cannot delete keys');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f3', 'apple_connect', 'Blocked', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nMEMBER\n-----END PRIVATE KEY-----'),
  '42501', 'ordinary members cannot save keys');
select pg_temp.throws(format('select public.load_apple_credential(%L,%L,%L)',
  :'credential_saved_id', :'credential_account', '00000000-0000-0000-0000-0000000000f4'), '42501', 'another tenant cannot load keys');
select pg_temp.check(public.load_apple_credential(:'credential_saved_id', :'credential_other_account',
  '00000000-0000-0000-0000-0000000000f4') is null, 'credential ID cannot cross account boundaries');
select pg_temp.check(not public.delete_apple_credential(:'credential_saved_id', :'credential_other_account',
  '00000000-0000-0000-0000-0000000000f4'), 'another tenant cannot delete by credential ID');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L,%L)',
  :'credential_other_account', '00000000-0000-0000-0000-0000000000f4', 'apple_connect', 'Blocked', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nOTHER\n-----END PRIVATE KEY-----', :'credential_saved_id'),
  'P0002', 'replacement cannot move another account credential');

select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1', 'apns', 'Blocked', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nOTHER\n-----END PRIVATE KEY-----'),
  '22023', 'unrelated credential providers are rejected');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1', 'apple_connect', 'Blocked', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', repeat('x',4001)), '22023', 'oversized private keys are rejected');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1', 'apple_connect', 'Blocked', 'bad-key-id',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nOTHER\n-----END PRIVATE KEY-----'),
  '22023', 'malformed credential metadata is rejected');

-- Neither customer nor service clients can bypass the scoped metadata RPC.
select pg_temp.throws('select * from private.apple_credentials', '42501', 'service role has no direct credential-table access');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
select pg_temp.throws('select * from private.apple_credentials', '42501', 'owner browser cannot read private credential table');
select pg_temp.throws('select * from vault.secrets', '42501', 'owner browser cannot read Vault ciphertext');
select pg_temp.throws('select * from vault.decrypted_secrets', '42501', 'owner browser cannot read decrypted Vault keys');
select pg_temp.throws(format('select public.list_apple_credentials(%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1'), '42501', 'authenticated cannot call list RPC directly');
select pg_temp.throws(format('select public.load_apple_credential(%L,%L,%L)',
  :'credential_saved_id', :'credential_account', '00000000-0000-0000-0000-0000000000f1'), '42501', 'authenticated cannot spoof a load RPC user');
select pg_temp.throws(format('select public.delete_apple_credential(%L,%L,%L)',
  :'credential_saved_id', :'credential_account', '00000000-0000-0000-0000-0000000000f1'), '42501', 'authenticated cannot call delete RPC directly');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1', 'apple_connect', 'Blocked', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nOTHER\n-----END PRIVATE KEY-----'),
  '42501', 'authenticated cannot call save RPC directly');
select pg_temp.throws('select vault.create_secret(''forged'')', '42501', 'authenticated cannot write Vault directly');
reset role;
set role anon;
select pg_temp.throws('select * from private.apple_credentials', '42501', 'anonymous cannot read private credential table');
select pg_temp.throws('select * from vault.decrypted_secrets', '42501', 'anonymous cannot read decrypted Vault keys');
reset role;

select vault_secret_id as credential_vault_id from private.apple_credentials where id = :'credential_saved_id' \gset
select pg_temp.check((select secret not like '%SQL_TEST_ONLY_ORIGINAL%' from vault.secrets where id = :'credential_vault_id'),
  'Vault stores ciphertext rather than the original private key');
select pg_temp.check((select decrypted_secret = E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_ORIGINAL\n-----END PRIVATE KEY-----'
  from vault.decrypted_secrets where id = :'credential_vault_id'), 'postgres can access Vault for privileged server and cron use');

-- Rotation changes the protected secret and metadata while retaining the connection ID.
set role service_role;
select * from public.save_apple_credential(:'credential_account', '00000000-0000-0000-0000-0000000000f2',
  'apple_connect', 'Rotated team', 'FGHIJ67890', '22222222-2222-2222-2222-222222222222',
  E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_REPLACED\n-----END PRIVATE KEY-----', :'credential_saved_id') \gset credential_updated_
select pg_temp.check(:'credential_updated_id' = :'credential_saved_id' and :'credential_updated_label' = 'Rotated team',
  'admin replaces credentials without changing the saved connection ID');
select pg_temp.check(public.load_apple_credential(:'credential_saved_id', :'credential_account',
  '00000000-0000-0000-0000-0000000000f1')->>'private_key' =
  E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_REPLACED\n-----END PRIVATE KEY-----', 'credential load returns the replaced key');
reset role;
select pg_temp.check((select vault_secret_id = :'credential_vault_id'::uuid from private.apple_credentials where id = :'credential_saved_id'),
  'replacement updates the same Vault secret');
select pg_temp.check((select count(*) from vault.secrets where name = 'salebell/apple/' || :'credential_saved_id') = 1,
  'replacement does not leave an orphaned old Vault secret');

set role service_role;
select pg_temp.check(public.delete_apple_credential(:'credential_saved_id', :'credential_account',
  '00000000-0000-0000-0000-0000000000f2'), 'admin deletes a saved credential');
select pg_temp.check(public.load_apple_credential(:'credential_saved_id', :'credential_account',
  '00000000-0000-0000-0000-0000000000f1') is null, 'deleted credential cannot be loaded');
reset role;
select pg_temp.check(not exists(select 1 from vault.secrets where id = :'credential_vault_id'),
  'credential deletion also removes its Vault secret');

-- The account-wide bound is enforced in SQL, including IAP credentials.
set role service_role;
select count(*) from generate_series(1,20) n cross join lateral public.save_apple_credential(
  :'credential_account', '00000000-0000-0000-0000-0000000000f1',
  case when n = 20 then 'apple_iap' else 'apple_connect' end, 'Connection ' || n,
  'ABCDE12345', '11111111-1111-1111-1111-111111111111',
  E'-----BEGIN PRIVATE KEY-----\nSQL_TEST_ONLY_LIMIT\n-----END PRIVATE KEY-----');
select pg_temp.throws(format('select public.save_apple_credential(%L,%L,%L,%L,%L,%L,%L)',
  :'credential_account', '00000000-0000-0000-0000-0000000000f1', 'apple_connect', 'Over limit', 'ABCDE12345',
  '11111111-1111-1111-1111-111111111111', E'-----BEGIN PRIVATE KEY-----\nOTHER\n-----END PRIVATE KEY-----'),
  '23514', 'workspace cannot save more than twenty Apple connections');
reset role;
create temporary table credential_cascade_secrets as
  select vault_secret_id from private.apple_credentials where account_id = :'credential_account';
select pg_temp.check((select count(*) from credential_cascade_secrets) = 20, 'all bounded test credentials were saved');
delete from public.accounts where id = :'credential_account';
select pg_temp.check(not exists(select 1 from private.apple_credentials where account_id = :'credential_account'),
  'account deletion cascades saved credential metadata');
select pg_temp.check(not exists(select 1 from vault.secrets s join credential_cascade_secrets c on s.id = c.vault_secret_id),
  'account deletion also deletes every corresponding Vault secret');
reset role;
