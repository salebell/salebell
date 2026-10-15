-- Operator-only installer storage. Apply separately to the canonical host.
-- This file must never be included in a customer's application migrations.
begin;
create schema if not exists salebell_installer;
revoke all on schema salebell_installer from public, anon, authenticated, service_role;

create table if not exists salebell_installer.sessions (
  id uuid primary key,
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  document jsonb not null,
  credentials text,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  credentials_expires_at timestamptz not null default now() + interval '24 hours',
  lease uuid,
  lease_until timestamptz
);
create table if not exists salebell_installer.bindings (
  project_ref text primary key check (project_ref ~ '^[a-z0-9]{20}$'),
  session_id uuid not null unique references salebell_installer.sessions(id) on delete cascade
);
create table if not exists salebell_installer.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);
alter table salebell_installer.sessions enable row level security;
alter table salebell_installer.bindings enable row level security;
alter table salebell_installer.rate_limits enable row level security;
revoke all on all tables in schema salebell_installer from public, anon, authenticated, service_role;

create or replace function salebell_installer.result(s salebell_installer.sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'version', s.version, 'document', s.document,
    'credentials', case when s.credentials_expires_at > now() then s.credentials else null end);
$$;
revoke all on function salebell_installer.result(salebell_installer.sessions) from public;

create or replace function public.installer_create(p_id uuid, p_hash text, p_document jsonb, p_credentials text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into salebell_installer.sessions(id, secret_hash, document, credentials)
  values (p_id, p_hash, p_document, p_credentials);
end;
$$;
create or replace function public.installer_read(p_id uuid, p_hash text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select salebell_installer.result(s) from salebell_installer.sessions s
  where s.id = p_id and s.secret_hash = p_hash and s.expires_at > now();
$$;
create or replace function public.installer_acquire(p_id uuid, p_hash text, p_lease uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s salebell_installer.sessions;
begin
  update salebell_installer.sessions set lease = p_lease, lease_until = now() + interval '5 minutes', version = version + 1
  where id = p_id and secret_hash = p_hash and expires_at > now()
    and (lease is null or lease_until <= now()) returning * into s;
  if s.id is null then return null; end if;
  return salebell_installer.result(s);
end;
$$;
create or replace function public.installer_save(p_id uuid, p_hash text, p_version bigint, p_lease uuid,
  p_document jsonb, p_credentials text, p_project_ref text default null, p_renew boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s salebell_installer.sessions;
begin
  select * into s from salebell_installer.sessions
    where id = p_id and secret_hash = p_hash and expires_at > now() and version = p_version
      and lease = p_lease and lease_until > now() for update;
  if s.id is null then return null; end if;
  if p_project_ref is not null then
    insert into salebell_installer.bindings(project_ref, session_id) values(p_project_ref, p_id)
      on conflict(project_ref) do update set session_id = excluded.session_id
      where salebell_installer.bindings.session_id = excluded.session_id;
    if not found then raise exception 'project_in_use'; end if;
  end if;
  update salebell_installer.sessions set document = p_document,
    credentials = case when p_renew or credentials_expires_at > now() then p_credentials else null end,
    credentials_expires_at = case when p_renew then now() + interval '24 hours' else credentials_expires_at end,
    version = version + 1, lease = null, lease_until = null
    where id = p_id returning * into s;
  return salebell_installer.result(s);
end;
$$;
create or replace function public.installer_rate_limit(p_key text, p_limit int, p_window int) returns int
language plpgsql security definer set search_path = '' as $$
declare r salebell_installer.rate_limits;
begin
  if length(p_key) > 200 or p_limit < 1 or p_window < 1 or p_window > 86400 then raise exception 'invalid_limit'; end if;
  insert into salebell_installer.rate_limits(key, window_start, count) values(p_key, now(), 1)
  on conflict(key) do update set
    count = case when salebell_installer.rate_limits.window_start + make_interval(secs => p_window) <= now() then 1 else salebell_installer.rate_limits.count + 1 end,
    window_start = case when salebell_installer.rate_limits.window_start + make_interval(secs => p_window) <= now() then now() else salebell_installer.rate_limits.window_start end
  returning * into r;
  return case when r.count <= p_limit then 0 else greatest(1, ceil(extract(epoch from r.window_start + make_interval(secs => p_window) - now()))::int) end;
end;
$$;
create or replace function public.installer_cleanup() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update salebell_installer.sessions set credentials = null where credentials_expires_at <= now() and credentials is not null;
  delete from salebell_installer.sessions where expires_at <= now();
  get diagnostics n = row_count;
  delete from salebell_installer.rate_limits where window_start < now() - interval '1 day';
  return n;
end;
$$;

revoke all on function public.installer_create(uuid,text,jsonb,text), public.installer_read(uuid,text),
  public.installer_acquire(uuid,text,uuid), public.installer_save(uuid,text,bigint,uuid,jsonb,text,text,boolean),
  public.installer_rate_limit(text,int,int), public.installer_cleanup() from public, anon, authenticated;
grant execute on function public.installer_create(uuid,text,jsonb,text), public.installer_read(uuid,text),
  public.installer_acquire(uuid,text,uuid), public.installer_save(uuid,text,bigint,uuid,jsonb,text,text,boolean),
  public.installer_rate_limit(text,int,int), public.installer_cleanup() to service_role;
do $schedule$ begin
  if exists(select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('salebell-installer-cleanup', '*/15 * * * *', 'select public.installer_cleanup();');
  end if;
end $schedule$;
notify pgrst, 'reload schema';
commit;
