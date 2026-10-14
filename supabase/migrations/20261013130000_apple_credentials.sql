-- Saved workspace Apple connections. Private keys live only in Supabase Vault;
-- public RPCs are callable by service_role after Edge Functions verify the user JWT.
begin;

create schema if not exists vault;
do $$
begin
  if to_regclass('vault.secrets') is null then
    create extension if not exists supabase_vault with schema vault;
  end if;
end $$;

-- Postgres-owned cron jobs can still access Vault; browser roles cannot.
revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated;
-- Schema USAGE prevents browser roles from resolving or calling Vault functions.
-- Hosted Supabase owns internal crypto functions; their ACLs are platform-managed.
revoke all on all sequences in schema vault from public, anon, authenticated;

create table private.apple_credentials (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('apple_connect', 'apple_iap')),
  label text not null check (length(label) between 1 and 100),
  key_id text not null check (key_id ~ '^[A-Z0-9]{10}$'),
  issuer_id uuid not null,
  vault_secret_id uuid not null unique references vault.secrets(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index apple_credentials_account on private.apple_credentials(account_id);
alter table private.apple_credentials enable row level security;
revoke all on private.apple_credentials from public, anon, authenticated, service_role;

create function private.delete_apple_credential_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end $$;
revoke all on function private.delete_apple_credential_secret() from public, anon, authenticated, service_role;
create trigger apple_credentials_delete_secret after delete on private.apple_credentials
  for each row execute function private.delete_apple_credential_secret();

create function public.list_apple_credentials(p_account uuid, p_user uuid, p_provider text default 'apple_connect')
returns table (id uuid, account_id uuid, provider text, label text, key_id text, issuer_id uuid,
  created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.account_members m
      where m.account_id = p_account and m.user_id = p_user and m.role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if p_provider is null or p_provider not in ('apple_connect','apple_iap') then
    raise exception using errcode = '22023', message = 'invalid_provider';
  end if;
  return query select c.id, c.account_id, c.provider, c.label, c.key_id, c.issuer_id, c.created_at, c.updated_at
    from private.apple_credentials c where c.account_id = p_account and c.provider = p_provider
    order by c.created_at, c.id;
end $$;

create function public.save_apple_credential(p_account uuid, p_user uuid, p_provider text, p_label text,
  p_key_id text, p_issuer_id uuid, p_private_key text, p_id uuid default null)
returns table (id uuid, account_id uuid, provider text, label text, key_id text, issuer_id uuid,
  created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_secret uuid;
  v_label text := btrim(p_label);
  v_key_id text := btrim(p_key_id);
  v_name text := 'salebell/apple/' || v_id::text;
begin
  if not exists (select 1 from public.account_members m
      where m.account_id = p_account and m.user_id = p_user and m.role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if p_provider is null or p_provider not in ('apple_connect','apple_iap') then
    raise exception using errcode = '22023', message = 'invalid_provider';
  end if;
  if v_label is null or length(v_label) not between 1 and 100 or v_label ~ '[[:cntrl:]]'
      or v_key_id is null or v_key_id !~ '^[A-Z0-9]{10}$' or p_issuer_id is null
      or p_private_key is null or octet_length(p_private_key) not between 1 and 4000
      or p_private_key !~ '^-----BEGIN PRIVATE KEY-----[[:space:]]'
      or p_private_key !~ '-----END PRIVATE KEY-----[[:space:]]*$' then
    raise exception using errcode = '22023', message = 'invalid_credentials';
  end if;

  -- Serialize account writes so concurrent creates cannot bypass the storage bound.
  perform 1 from public.accounts a where a.id = p_account for update;
  if p_id is null then
    if (select count(*) from private.apple_credentials c where c.account_id = p_account) >= 20 then
      raise exception using errcode = '23514', message = 'credential_limit';
    end if;
    v_secret := vault.create_secret(p_private_key, v_name, 'Salebell saved Apple credential');
    insert into private.apple_credentials(id, account_id, provider, label, key_id, issuer_id, vault_secret_id)
      values (v_id, p_account, p_provider, v_label, v_key_id, p_issuer_id, v_secret);
  else
    select c.vault_secret_id into v_secret from private.apple_credentials c
      where c.id = p_id and c.account_id = p_account and c.provider = p_provider for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'credential_not_found';
    end if;
    perform vault.update_secret(v_secret, p_private_key, v_name, 'Salebell saved Apple credential');
    update private.apple_credentials c set label = v_label, key_id = v_key_id, issuer_id = p_issuer_id, updated_at = now()
      where c.id = p_id;
  end if;
  return query select c.id, c.account_id, c.provider, c.label, c.key_id, c.issuer_id, c.created_at, c.updated_at
    from private.apple_credentials c where c.id = v_id;
end $$;

create function public.delete_apple_credential(p_id uuid, p_account uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.account_members m
      where m.account_id = p_account and m.user_id = p_user and m.role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  delete from private.apple_credentials c where c.id = p_id and c.account_id = p_account;
  return found;
end $$;

create function public.load_apple_credential(p_id uuid, p_account uuid, p_user uuid, p_provider text default 'apple_connect')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.account_members m
      where m.account_id = p_account and m.user_id = p_user and m.role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'admin_required';
  end if;
  if p_provider is null or p_provider not in ('apple_connect','apple_iap') then
    raise exception using errcode = '22023', message = 'invalid_provider';
  end if;
  select jsonb_build_object('key_id', c.key_id, 'issuer_id', c.issuer_id, 'private_key', s.decrypted_secret)
    into v_result from private.apple_credentials c
    join vault.decrypted_secrets s on s.id = c.vault_secret_id
    where c.id = p_id and c.account_id = p_account and c.provider = p_provider;
  return v_result;
end $$;

revoke all on function public.list_apple_credentials(uuid,uuid,text),
  public.save_apple_credential(uuid,uuid,text,text,text,uuid,text,uuid),
  public.delete_apple_credential(uuid,uuid,uuid), public.load_apple_credential(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.list_apple_credentials(uuid,uuid,text),
  public.save_apple_credential(uuid,uuid,text,text,text,uuid,text,uuid),
  public.delete_apple_credential(uuid,uuid,uuid), public.load_apple_credential(uuid,uuid,uuid,text)
  to service_role;

commit;
