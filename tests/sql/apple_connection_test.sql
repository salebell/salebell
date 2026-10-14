-- Guarded forwarding preparation for Apple connection automation.
-- Dedicated fixtures survive the account deletion tests that run earlier.
insert into auth.users values ('00000000-0000-0000-0000-0000000000f5', 'forward-owner@example.com'),
                              ('00000000-0000-0000-0000-0000000000f6', 'forward-member@example.com');
select account_id as connection_account from public.account_members
  where user_id = '00000000-0000-0000-0000-0000000000f5' and role = 'owner' \gset
insert into public.apps(account_id,name,bundle_id,apple_app_id)
  values (:'connection_account','Connection Test','com.example.cafetimer',1234567890)
  returning id as connection_app, webhook_key as connection_key \gset

set role authenticated;
select pg_temp.throws(format('select public.prepare_apple_connection(%L,%L,%L,%L,%L,null,null,null,null)',
  :'connection_app', '00000000-0000-0000-0000-0000000000f5', 'com.example.cafetimer', '1234567890', :'connection_key'),
  '42501', 'customers cannot invoke service forwarding preparation');
reset role;
set role anon;
select pg_temp.throws(format('select public.prepare_apple_connection(%L,%L,%L,%L,%L,null,null,null,null)',
  :'connection_app', '00000000-0000-0000-0000-0000000000f5', 'com.example.cafetimer', '1234567890', :'connection_key'),
  '42501', 'anonymous callers cannot prepare forwarding');
reset role;

set role service_role;
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f6',
  'com.example.cafetimer', '1234567890', :'connection_key', null, null,
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'forbidden', 'service RPC independently rejects non-member');
select pg_temp.check((select forward_url_production is null and forward_url_sandbox is null from public.apps where id = :'connection_app'),
  'unauthorized preparation leaves forwarding unchanged');

select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.someone.else', '1234567890', :'connection_key', null, null, null, null) = 'preview_changed', 'changed bundle aborts preparation');
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '9999999999', :'connection_key', null, null, null, null) = 'preview_changed', 'changed Apple app ID aborts preparation');
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', 'changed-key', null, null, null, null) = 'preview_changed', 'changed receiver key aborts preparation');

select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', :'connection_key', null, null,
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'ok', 'owner preserves prior production URL for both environments');
select pg_temp.check((select forward_url_production = 'https://api.example.com/apple' and forward_url_sandbox = 'https://api.example.com/apple'
  from public.apps where id = :'connection_app'), 'forwarding is saved before Apple configuration');

select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', :'connection_key', null, null,
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'preview_changed', 'stale forwarding snapshot is rejected');
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', :'connection_key', 'https://api.example.com/apple', 'https://api.example.com/apple',
  'https://different.example.com/apple', 'https://api.example.com/apple') = 'preview_changed', 'existing nonempty forwarding cannot be overwritten');
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', :'connection_key', 'https://api.example.com/apple', 'https://api.example.com/apple',
  null, null) = 'preview_changed', 'existing forwarding cannot be silently cleared');
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f5',
  'com.example.cafetimer', '1234567890', :'connection_key', 'https://api.example.com/apple', 'https://api.example.com/apple',
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'ok', 'unchanged setup is idempotent');
reset role;

-- A workspace member can read an app but cannot change its connection.
insert into public.account_members(account_id,user_id,role) values (:'connection_account', '00000000-0000-0000-0000-0000000000f6', 'member');
set role service_role;
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f6',
  'com.example.cafetimer', '1234567890', :'connection_key', 'https://api.example.com/apple', 'https://api.example.com/apple',
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'forbidden', 'read-only member cannot prepare a connection');
reset role;
update public.account_members set role = 'admin' where account_id = :'connection_account' and user_id = '00000000-0000-0000-0000-0000000000f6';
set role service_role;
select pg_temp.check(public.prepare_apple_connection(:'connection_app', '00000000-0000-0000-0000-0000000000f6',
  'com.example.cafetimer', '1234567890', :'connection_key', 'https://api.example.com/apple', 'https://api.example.com/apple',
  'https://api.example.com/apple', 'https://api.example.com/apple') = 'ok', 'workspace admin can prepare a connection');
reset role;
