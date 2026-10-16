-- OPERATOR ONLY: install on the managed Supabase project, never a customer backend.
-- No public tables or policies expose credentials, tokens, or content keys.
begin;
create schema if not exists relay_private;
revoke all on schema relay_private from public, anon, authenticated, service_role;
alter default privileges in schema relay_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema relay_private revoke execute on functions from public, anon, authenticated, service_role;
create table if not exists relay_private.installations (
 id uuid primary key,
 control_secret_hash text not null check(control_secret_hash ~ '^[0-9a-f]{64}$'),
 token text unique check(token ~ '^[0-9a-f]{64,200}$' and length(token)%2=0),
 environment text check(environment in ('production','sandbox')),
 verified boolean not null default false,
 revision bigint not null default 0 check(revision between 0 and 9007199254740991),
 last_action text not null default 'enroll',
 active_route uuid,
 created_at timestamptz not null default now()
);
-- Historical enrollment proofs reserve tokens from legacy direct delivery even after rotation.
create table if not exists relay_private.owned_tokens (
 token text primary key check(token ~ '^[0-9a-f]{64,200}$' and length(token)%2=0),
 verified_at timestamptz not null default now()
);
create table if not exists relay_private.challenges (
 id uuid primary key,
 installation_id uuid not null references relay_private.installations(id),
 challenge_hash text not null check(challenge_hash ~ '^[0-9a-f]{64}$'),
 token text not null check(token ~ '^[0-9a-f]{64,200}$' and length(token)%2=0),
 environment text not null check(environment in ('production','sandbox')),
 expires_at timestamptz not null default now()+interval '5 minutes',
 consumed_at timestamptz
);
create index if not exists relay_challenge_install on relay_private.challenges(installation_id);
create table if not exists relay_private.routes (
 id uuid primary key,
 installation_id uuid not null references relay_private.installations(id),
 revision bigint not null check(revision between 1 and 9007199254740991),
 backend text not null check(length(backend)<=2048 and backend ~ '^https://[^/@?#]+$'),
 user_id uuid not null,
 capability_hash text not null unique check(capability_hash ~ '^[0-9a-f]{64}$'),
 content_key text not null check(content_key ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null default now()+interval '30 days',
 revoked_at timestamptz,
 unique(installation_id,revision)
);
create table if not exists relay_private.deliveries (
 route_id uuid not null references relay_private.routes(id),
 notification_id uuid not null,
 created_at timestamptz not null default now(),
 sent boolean not null default false,
 primary key(route_id,notification_id)
);
create table if not exists relay_private.limits (
 key text primary key,
 window_start timestamptz not null,
 count integer not null
);
revoke all on all tables in schema relay_private from public, anon, authenticated, service_role;

-- Every mutating RPC takes the same short transaction lock: ownership transfer,
-- revisions, limiter counters, and claims serialize across concurrent requests.
create or replace function relay_private.consume(p_key text,p_max integer,p_window interval)
returns void language plpgsql set search_path='' as $$
begin
 insert into relay_private.limits(key,window_start,count) values(p_key,now(),1)
 on conflict(key) do update set
 count=case when relay_private.limits.window_start<=now()-p_window then 1 else relay_private.limits.count+1 end,
 window_start=case when relay_private.limits.window_start<=now()-p_window then now() else relay_private.limits.window_start end;
 if (select count from relay_private.limits where key=p_key)>p_max then
  raise exception 'Relay rate limit' using errcode='54000';
 end if;
end $$;

create or replace function public.relay_enroll(p_installation_id uuid,p_control_secret_hash text,p_token text,p_environment text,
 p_challenge_id uuid,p_challenge_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v relay_private.installations;
begin
 perform pg_catalog.pg_advisory_xact_lock(173287);
 select * into v from relay_private.installations where id=p_installation_id;
 if found and v.control_secret_hash is distinct from p_control_secret_hash then
  raise exception 'Relay authorization rejected' using errcode='42501';
 end if;
 perform relay_private.consume('enroll:global',5000,interval '10 minutes');
 perform relay_private.consume('enroll:installation:'||p_installation_id,5,interval '10 minutes');
 perform relay_private.consume('enroll:token:'||p_token,5,interval '10 minutes');
 if v.verified and v.token=p_token and v.environment=p_environment then return '{"enrolled":true}'; end if;
 insert into relay_private.installations(id,control_secret_hash) values(p_installation_id,p_control_secret_hash)
 on conflict(id) do nothing;
 -- A new request supersedes previous challenges. Receipt of a delayed old challenge cannot enroll.
 update relay_private.challenges set consumed_at=now() where installation_id=p_installation_id and consumed_at is null;
 insert into relay_private.challenges(id,installation_id,challenge_hash,token,environment)
 values(p_challenge_id,p_installation_id,p_challenge_hash,p_token,p_environment);
 return '{"enrolled":false}';
end $$;

create or replace function public.relay_confirm(p_installation_id uuid,p_control_secret_hash text,p_challenge_id uuid,p_challenge_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v relay_private.installations; c relay_private.challenges; previous_id uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(173287);
 select * into v from relay_private.installations where id=p_installation_id;
 if not found or v.control_secret_hash is distinct from p_control_secret_hash then
  raise exception 'Relay authorization rejected' using errcode='42501';
 end if;
 perform relay_private.consume('confirm:global',10000,interval '10 minutes');
 perform relay_private.consume('confirm:installation:'||p_installation_id,10,interval '10 minutes');
 select * into c from relay_private.challenges where id=p_challenge_id and installation_id=p_installation_id;
 if not found or c.challenge_hash is distinct from p_challenge_hash or c.expires_at<=now() or c.consumed_at is not null then
  raise exception 'Relay authorization rejected' using errcode='42501';
 end if;
 select id into previous_id from relay_private.installations where token=c.token and id<>p_installation_id;
 if previous_id is not null then
  update relay_private.routes set revoked_at=now() where installation_id=previous_id and revoked_at is null;
  update relay_private.installations set verified=false,token=null,environment=null,active_route=null,last_action='ownership_lost'
   where id=previous_id;
  update relay_private.challenges set consumed_at=now() where installation_id=previous_id and consumed_at is null;
 end if;
 if v.token is distinct from c.token or v.environment is distinct from c.environment or not v.verified then
  update relay_private.routes set revoked_at=now() where installation_id=p_installation_id and revoked_at is null;
  update relay_private.installations set active_route=null,last_action='enroll' where id=p_installation_id;
 end if;
 insert into relay_private.owned_tokens(token) values(c.token) on conflict do nothing;
 update relay_private.installations set token=c.token,environment=c.environment,verified=true where id=p_installation_id;
 update relay_private.challenges set consumed_at=now() where id=c.id;
 -- Defense in depth for old managed clients. Dispatch also calls relay_owned_tokens,
 -- so a subsequent legacy re-registration cannot re-enable direct delivery.
 if pg_catalog.to_regclass('public.push_devices') is not null then
  execute 'update public.push_devices set enabled=false where token=$1' using c.token;
 end if;
 return '{"enrolled":true}';
end $$;

create or replace function public.relay_activate(p_installation_id uuid,p_control_secret_hash text,p_revision bigint,p_backend text,
 p_user_id uuid,p_route_id uuid,p_capability_hash text,p_content_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v relay_private.installations; r relay_private.routes;
begin
 perform pg_catalog.pg_advisory_xact_lock(173287);
 select * into v from relay_private.installations where id=p_installation_id;
 if not found or not v.verified or v.control_secret_hash is distinct from p_control_secret_hash then
  raise exception 'Relay authorization rejected' using errcode='42501';
 end if;
 if p_revision is null or p_revision<1 or p_revision>9007199254740991 then
  raise exception 'Relay revision rejected' using errcode='22023';
 end if;
 if p_revision<=v.revision then
  select * into r from relay_private.routes where id=v.active_route;
  if p_revision=v.revision and v.last_action='activate' and r.id=p_route_id and r.backend=p_backend and r.user_id=p_user_id and
   r.capability_hash=p_capability_hash and r.content_key=p_content_key and r.revoked_at is null then
   return jsonb_build_object('route_id',r.id);
  end if;
  raise exception 'Relay revision rejected' using errcode='40001';
 end if;
 perform relay_private.consume('activate:installation:'||p_installation_id,120,interval '1 hour');
 select * into r from relay_private.routes where id=p_route_id;
 if found then
  if v.active_route=p_route_id and r.installation_id=p_installation_id and r.backend=p_backend and r.user_id=p_user_id and
   r.capability_hash=p_capability_hash and r.content_key=p_content_key and r.revoked_at is null then
   update relay_private.routes set revision=p_revision,expires_at=now()+interval '30 days' where id=p_route_id;
   update relay_private.installations set revision=p_revision,last_action='activate' where id=p_installation_id;
   return jsonb_build_object('route_id',p_route_id);
  end if;
  raise exception 'Relay route rejected' using errcode='40001';
 end if;
 update relay_private.routes set revoked_at=now() where installation_id=p_installation_id and revoked_at is null;
 insert into relay_private.routes(id,installation_id,revision,backend,user_id,capability_hash,content_key)
 values(p_route_id,p_installation_id,p_revision,p_backend,p_user_id,p_capability_hash,p_content_key);
 update relay_private.installations set revision=p_revision,active_route=p_route_id,last_action='activate' where id=p_installation_id;
 return jsonb_build_object('route_id',p_route_id);
end $$;

create or replace function public.relay_revoke(p_installation_id uuid,p_control_secret_hash text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v relay_private.installations;
begin
 perform pg_catalog.pg_advisory_xact_lock(173287);
 select * into v from relay_private.installations where id=p_installation_id;
 if not found or v.control_secret_hash is distinct from p_control_secret_hash then
  raise exception 'Relay authorization rejected' using errcode='42501';
 end if;
 if p_revision is null or p_revision<1 or p_revision>9007199254740991 then
  raise exception 'Relay revision rejected' using errcode='22023';
 end if;
 if p_revision<=v.revision then
  if p_revision=v.revision and v.last_action='revoke' and v.active_route is null then return '{"revoked":true}'; end if;
  raise exception 'Relay revision rejected' using errcode='40001';
 end if;
 update relay_private.routes set revoked_at=now() where installation_id=p_installation_id and revoked_at is null;
 update relay_private.installations set revision=p_revision,active_route=null,last_action='revoke' where id=p_installation_id;
 return '{"revoked":true}';
end $$;

create or replace function public.relay_claim_delivery(p_capability_hash text,p_notification_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r relay_private.routes; v relay_private.installations;
begin
 perform pg_catalog.pg_advisory_xact_lock(173287);
 perform relay_private.consume('deliver:global',10000,interval '1 minute');
 select * into r from relay_private.routes where capability_hash=p_capability_hash and revoked_at is null and expires_at>now();
 if not found then return null; end if;
 select * into v from relay_private.installations where id=r.installation_id and verified and active_route=r.id;
 if not found then return null; end if;
 perform relay_private.consume('deliver:route:'||r.id,60,interval '1 minute');
 insert into relay_private.deliveries(route_id,notification_id) values(r.id,p_notification_id) on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true,'sent',(select sent from relay_private.deliveries where route_id=r.id and notification_id=p_notification_id)); end if;
 return jsonb_build_object('route_id',r.id,'token',v.token,'environment',v.environment,'content_key',r.content_key,'duplicate',false);
end $$;

-- Revalidate after encryption, immediately before contacting Apple. A revocation
-- after this check while Apple's request is in flight cannot recall that request.
create or replace function public.relay_validate_delivery(p_capability_hash text,p_notification_id uuid)
returns boolean language sql security definer stable set search_path='' as $$
 select exists(select 1 from relay_private.routes r
 join relay_private.installations i on i.id=r.installation_id and i.active_route=r.id and i.verified
 join relay_private.deliveries d on d.route_id=r.id and d.notification_id=p_notification_id
 where r.capability_hash=p_capability_hash and r.revoked_at is null and r.expires_at>now() and not d.sent)
$$;

-- Called only after Apple accepts the request; uncertain/failed sends stay reserved.
create or replace function public.relay_finish_delivery(p_capability_hash text,p_notification_id uuid)
returns void language sql security definer set search_path='' as $$
 update relay_private.deliveries d set sent=true from relay_private.routes r
 where d.route_id=r.id and r.capability_hash=p_capability_hash and d.notification_id=p_notification_id
$$;

-- Always defined on the managed project; dispatch fails closed if its RPC fails.
-- Include verified tokens even when their route is revoked/expired: direct sends
-- must never bypass the app's current route selection.
create or replace function public.relay_owned_tokens(p_tokens text[])
returns text[] language sql security definer stable set search_path='' as $$
 select coalesce(array_agg(token),array[]::text[]) from relay_private.owned_tokens where token=any(p_tokens)
$$;

-- Supabase installations may grant API execution through default privileges.
-- Explicitly remove every ordinary role after creating/replacing each RPC.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p
 join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
 ('relay_enroll','relay_confirm','relay_activate','relay_revoke','relay_claim_delivery','relay_validate_delivery','relay_finish_delivery','relay_owned_tokens') loop
  execute format('revoke all on function %s from public, anon, authenticated', f.signature);
  execute format('grant execute on function %s to service_role', f.signature);
 end loop;
end $$;
revoke all on all functions in schema relay_private from public, anon, authenticated, service_role;
commit;
