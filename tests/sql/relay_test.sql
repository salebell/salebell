\set ON_ERROR_STOP on
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin if not coalesce(ok,false) then raise exception 'FAILED: %', what; end if; raise notice 'ok - %', what; end $$;
create or replace function pg_temp.throws(stmt text, pattern text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if sqlstate ~ pattern or sqlerrm ~ pattern then raise notice 'ok - %', what; return; end if;
    raise exception 'FAILED: % (got % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', what;
end $$;
-- Test secrets here are hashes, never real installation credentials.
select public.relay_enroll('11111111-1111-4111-8111-111111111111',repeat('a',64),repeat('d',64),'production',
 '33333333-3333-4333-8333-333333333333',repeat('e',64)) as challenge \gset
select pg_temp.check(:'challenge'::jsonb = '{"enrolled":false}', 'enrollment returns no challenge plaintext');
select pg_temp.throws($s$select public.relay_enroll('11111111-1111-4111-8111-111111111111',repeat('b',64),repeat('d',64),'production',gen_random_uuid(),repeat('f',64))$s$, '42501', 'existing installation requires its secret');
select pg_temp.throws($s$select public.relay_confirm('11111111-1111-4111-8111-111111111111',repeat('a',64),'33333333-3333-4333-8333-333333333333',repeat('f',64))$s$, '42501', 'wrong challenge cannot enroll stolen APNs token');
select pg_temp.throws($s$select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),1,'https://one.supabase.co','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),repeat('c',64))$s$, '42501', 'unverified enrollment cannot activate');
select public.relay_confirm('11111111-1111-4111-8111-111111111111',repeat('a',64),'33333333-3333-4333-8333-333333333333',repeat('e',64));
select pg_temp.throws($s$select public.relay_confirm('11111111-1111-4111-8111-111111111111',repeat('a',64),'33333333-3333-4333-8333-333333333333',repeat('e',64))$s$, '42501', 'challenge cannot be reused');
select pg_temp.check(public.relay_owned_tokens(array[repeat('d',64),repeat('f',64)]) = array[repeat('d',64)], 'managed direct APNs excludes owned tokens');
select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),5,'https://one.supabase.co','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),repeat('c',64)) as activation \gset
select pg_temp.check(:'activation'::jsonb->>'route_id' = '22222222-2222-4222-8222-222222222222', 'activation yields one route');
update relay_private.routes set expires_at=now()+interval '1 day' where id='22222222-2222-4222-8222-222222222222';
select pg_temp.check(public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),7,'https://one.supabase.co','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),repeat('c',64)) = :'activation'::jsonb, 'newer revision renews same current route');
select pg_temp.check((select expires_at>now()+interval '29 days' and revision=7 from relay_private.routes where id='22222222-2222-4222-8222-222222222222'), 'renewal extends lease without replacing capability');

select pg_temp.check(public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),7,'https://one.supabase.co','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),repeat('c',64)) = :'activation'::jsonb, 'exact activation retry idempotent');
select pg_temp.throws($s$select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),7,'https://other.supabase.co','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',repeat('b',64),repeat('c',64))$s$, '40001', 'same revision differing backend rejected');
select pg_temp.throws($s$select public.relay_revoke('11111111-1111-4111-8111-111111111111',repeat('a',64),6)$s$, '40001', 'stale revoke rejected');
select pg_temp.check((public.relay_claim_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444')->>'duplicate')::boolean = false, 'current capability resolves delivery');
select pg_temp.check((public.relay_claim_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444')->>'duplicate')::boolean, 'notification id deduplicated');
select pg_temp.check(not (public.relay_claim_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444')->>'sent')::boolean, 'pending duplicate not reported successful');
select pg_temp.check(public.relay_validate_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444'), 'current claimed route passes final validation');
select public.relay_finish_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444');
select pg_temp.check((public.relay_claim_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444')->>'sent')::boolean, 'durable successful receipt acknowledges duplicate');

-- Route and global limit failures cannot reserve a delivery or call Apple.
update relay_private.limits set count=60 where key='deliver:route:22222222-2222-4222-8222-222222222222';
select pg_temp.throws($s$select public.relay_claim_delivery(repeat('b',64),'abababab-abab-4bab-8bab-abababababab')$s$, '54000', 'route delivery limit fails closed');
select pg_temp.check(not exists(select 1 from relay_private.deliveries where notification_id='abababab-abab-4bab-8bab-abababababab'), 'rate rejected delivery is not reserved');
update relay_private.limits set count=1 where key='deliver:route:22222222-2222-4222-8222-222222222222';
update relay_private.limits set count=10000 where key='deliver:global';
select pg_temp.throws($s$select public.relay_claim_delivery(repeat('b',64),gen_random_uuid())$s$, '54000', 'global delivery limit fails closed');
update relay_private.limits set count=1 where key='deliver:global';
select public.relay_revoke('11111111-1111-4111-8111-111111111111',repeat('a',64),8);
select pg_temp.check(public.relay_claim_delivery(repeat('b',64),gen_random_uuid()) is null, 'revoked capability cannot deliver');
select pg_temp.check(not public.relay_validate_delivery(repeat('b',64),'44444444-4444-4444-8444-444444444444'), 'revocation invalidates previously claimed delivery');
select pg_temp.check(public.relay_revoke('11111111-1111-4111-8111-111111111111',repeat('a',64),8) = '{"revoked":true}', 'exact revoke retry idempotent');
select pg_temp.throws($s$select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),8,'https://one.supabase.co','11111111-1111-4111-8111-111111111111',gen_random_uuid(),repeat('f',64),repeat('c',64))$s$, '40001', 'revoked revision cannot reactivate');
-- A token change needs a new physical proof and preserves the durable revision.
select public.relay_enroll('11111111-1111-4111-8111-111111111111',repeat('a',64),repeat('f',64),'sandbox',
 '55555555-5555-4555-8555-555555555555',repeat('e',64));
select public.relay_confirm('11111111-1111-4111-8111-111111111111',repeat('a',64),'55555555-5555-4555-8555-555555555555',repeat('e',64));
select pg_temp.check(public.relay_owned_tokens(array[repeat('d',64)]) = array[repeat('d',64)], 'historical relay token remains excluded from direct APNs');
select pg_temp.check((select revision from relay_private.installations where id='11111111-1111-4111-8111-111111111111') = 8, 'token change does not reset revision');
select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),9,'https://two.supabase.co','11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',repeat('f',64),repeat('c',64));
select pg_temp.check(public.relay_claim_delivery(repeat('b',64),gen_random_uuid()) is null, 'old backend capability cannot reach new route');
update relay_private.routes set expires_at=now()-interval '1 second' where id='66666666-6666-4666-8666-666666666666';
select pg_temp.check(public.relay_claim_delivery(repeat('f',64),gen_random_uuid()) is null, 'expired 30 day lease cannot deliver');
select pg_temp.check(public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),9,'https://two.supabase.co','11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',repeat('f',64),repeat('c',64))->>'route_id' = '66666666-6666-4666-8666-666666666666', 'expired same revision retry remains idempotent');
select pg_temp.check(public.relay_claim_delivery(repeat('f',64),gen_random_uuid()) is null, 'same revision retry never refreshes expired lease');
select pg_temp.throws($s$select public.relay_activate('11111111-1111-4111-8111-111111111111',repeat('a',64),10,'https://other.supabase.co','11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',repeat('f',64),repeat('c',64))$s$, '40001', 'new revision cannot reuse route id with changed backend');

-- Another installation cannot take a token just by knowing it.
select public.relay_enroll('77777777-7777-4777-8777-777777777777',repeat('b',64),repeat('f',64),'sandbox',
 '88888888-8888-4888-8888-888888888888',repeat('e',64));
select pg_temp.check((select verified from relay_private.installations where id='11111111-1111-4111-8111-111111111111'), 'unconfirmed takeover leaves owner verified');
select public.relay_confirm('77777777-7777-4777-8777-777777777777',repeat('b',64),'88888888-8888-4888-8888-888888888888',repeat('e',64));
select pg_temp.check(not (select verified from relay_private.installations where id='11111111-1111-4111-8111-111111111111'), 'confirmed token takeover revokes old installation');
-- Expired challenges fail closed.
select public.relay_enroll('99999999-9999-4999-8999-999999999999',repeat('b',64),repeat('9',64),'production',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('e',64));
update relay_private.challenges set expires_at=now()-interval '1 second' where installation_id='99999999-9999-4999-8999-999999999999';
select pg_temp.throws($s$select public.relay_confirm('99999999-9999-4999-8999-999999999999',repeat('b',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',repeat('e',64))$s$, '42501', 'expired challenge rejected');
-- Exhaust a token limiter without losing accepted attempts on rejection.
do $$ begin
 for i in 1..4 loop
  perform public.relay_enroll('99999999-9999-4999-8999-999999999999',repeat('b',64),repeat('9',64),'production',gen_random_uuid(),repeat('e',64));
 end loop;
end $$;
select pg_temp.throws($s$select public.relay_enroll(gen_random_uuid(),repeat('b',64),repeat('9',64),'production',gen_random_uuid(),repeat('e',64))$s$, '54000', 'enrollment token limit spans installations');
update relay_private.limits set count=5000 where key='enroll:global';
select pg_temp.throws($s$select public.relay_enroll(gen_random_uuid(),repeat('b',64),repeat('8',64),'production',gen_random_uuid(),repeat('e',64))$s$, '54000', 'global enrollment limit fails closed');
select pg_temp.check(not has_schema_privilege('authenticated','relay_private','USAGE'), 'private schema inaccessible');
select pg_temp.check(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'relay_%' and
 (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))), 'all relay RPCs service role only');
set role service_role;
select pg_temp.check(cardinality(public.relay_owned_tokens(array[repeat('f',64)])) = 1, 'service role can query relay owned tokens');
reset role;
\echo RELAY SQL TESTS PASSED
