-- Exercises real control-table isolation, lease fencing and expiry.
begin;
do $test$
declare a uuid := '72b256b8-1426-4ac3-8d3a-9a77d85fae1f';
  b uuid := '72b256b8-1426-4ac3-8d3a-9a77d85fae20';
  lease uuid := '72b256b8-1426-4ac3-8d3a-9a77d85fae21';
  lease_b uuid := '72b256b8-1426-4ac3-8d3a-9a77d85fae22'; r jsonb;
begin
  assert not has_function_privilege('anon', 'public.installer_read(uuid,text)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.installer_save(uuid,text,bigint,uuid,jsonb,text,text,boolean)', 'EXECUTE');
  assert not has_table_privilege('service_role', 'salebell_installer.sessions', 'SELECT');
  perform public.installer_create(a, repeat('a',64), '{"phase":"clone"}', 'encrypted-token');
  assert public.installer_read(a, repeat('b',64)) is null;
  r := public.installer_acquire(a, repeat('a',64), lease);
  assert (r->>'version')::int = 1;
  assert public.installer_acquire(a, repeat('a',64), lease_b) is null;
  assert public.installer_save(a, repeat('a',64), 0, lease, '{}', null) is null;
  assert public.installer_save(a, repeat('a',64), 1, lease_b, '{}', null) is null;
  r := public.installer_save(a, repeat('a',64), 1, lease, '{"phase":"validate"}', 'encrypted-token', 'abcdefghijklmnopqrst');
  assert (r->>'version')::int = 2;
  perform public.installer_create(b, repeat('b',64), '{}', null);
  r := public.installer_acquire(b, repeat('b',64), lease_b);
  begin
    perform public.installer_save(b, repeat('b',64), 1, lease_b, '{}', null, 'abcdefghijklmnopqrst');
    raise exception 'Expected binding rejection';
  exception when raise_exception then
    if sqlerrm <> 'project_in_use' then raise; end if;
  end;
  update salebell_installer.sessions set credentials_expires_at = now() - interval '1 second' where id = a;
  assert public.installer_read(a, repeat('a',64))->>'credentials' is null;
  perform public.installer_cleanup();
  assert (select credentials is null from salebell_installer.sessions where id = a);
  assert public.installer_rate_limit('test', 1, 60) = 0;
  assert public.installer_rate_limit('test', 1, 60) > 0;
end $test$;
rollback;
