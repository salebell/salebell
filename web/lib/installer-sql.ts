import type { MigrationAsset } from "./installer-types.ts";
export const sqlLiteral = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function reservationSQL(id: string, release: string) {
  if (!UUID.test(id) || !/^[a-f0-9]{64}$/.test(release)) throw new Error("invalid_installation");
  return `begin;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtextextended('salebell-browser-install', 0));
do $reserve$ begin
  if to_regclass('private.browser_installation') is not null then
    if not exists(select 1 from private.browser_installation where singleton and installation_id = '${id}'::uuid and release_id = '${release}') then
      raise exception 'installation_conflict';
    end if;
    return;
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
    and not exists(select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e'))
    or exists(select 1 from auth.users) then raise exception 'project_not_empty'; end if;
  create schema if not exists private;
  create table private.browser_installation(singleton boolean primary key default true check(singleton), installation_id uuid not null, release_id text not null);
  create table private.browser_migrations(filename text primary key, sha256 text not null);
  revoke all on private.browser_installation, private.browser_migrations from public, anon, authenticated, service_role;
  insert into private.browser_installation values(true, '${id}'::uuid, '${release}');
end $reserve$;
commit;`;
}
export function migrationSQL(asset: MigrationAsset): string {
  if (!/^\d{14}_[a-zA-Z0-9_]+\.sql$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.sql.includes("\0")) throw new Error("invalid_migration");
  const begins = asset.sql.match(/^\s*begin;\s*$/gim)?.length ?? 0;
  const commits = asset.sql.match(/^\s*commit;\s*$/gim)?.length ?? 0;
  if (begins !== commits || begins > 1) throw new Error("unsupported_migration_transaction");
  const body = asset.sql.replace(/^\s*(begin|commit);\s*$/gim, "");
  return `begin;
set local statement_timeout = '35s';
set local lock_timeout = '5s';
select pg_advisory_xact_lock(hashtextextended('salebell-browser-install', 0));
do $apply$ begin
  if exists(select 1 from private.browser_migrations where filename = ${sqlLiteral(asset.name)} and sha256 <> '${asset.sha256}') then raise exception 'migration_conflict'; end if;
  if exists(select 1 from private.browser_migrations where filename = ${sqlLiteral(asset.name)}) then return; end if;
  execute ${sqlLiteral(body)};
  insert into private.browser_migrations values(${sqlLiteral(asset.name)}, '${asset.sha256}');
end $apply$;
commit;`;
}
export function settingsSQL(ref: string) {
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("project_mismatch");
  return `begin;
update private.instance_settings set deployment_mode = 'self_hosted' where singleton;
do $vault$ declare secret_id uuid; begin
  select id into secret_id from vault.secrets where name = 'project_url' limit 1;
  if secret_id is null then perform vault.create_secret('https://${ref}.supabase.co', 'project_url');
  else perform vault.update_secret(secret_id, 'https://${ref}.supabase.co'); end if;
end $vault$;
notify pgrst, 'reload schema';
commit;`;
}
