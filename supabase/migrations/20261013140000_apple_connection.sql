-- App Store Connect automation. This operation handles forwarding only.
-- Save prior notification destinations before changing Apple's URLs, with optimistic
-- checks so another tab cannot silently overwrite forwarding or connect a changed app.
begin;

create function public.prepare_apple_connection(
  p_app uuid, p_user uuid, p_bundle_id text, p_apple_app_id text, p_webhook_key text,
  p_expected_production text, p_expected_sandbox text,
  p_forward_production text, p_forward_sandbox text
) returns text language plpgsql security definer set search_path = '' as $$
declare v_app public.apps%rowtype;
begin
  select * into v_app from public.apps where id = p_app for update;
  if not found then return 'app_not_found'; end if;
  if not exists(select 1 from public.account_members m
                where m.account_id = v_app.account_id and m.user_id = p_user and m.role in ('owner','admin')) then
    return 'forbidden';
  end if;
  if v_app.bundle_id is distinct from p_bundle_id
     or v_app.apple_app_id::text is distinct from p_apple_app_id
     or v_app.webhook_key is distinct from p_webhook_key
     or v_app.forward_url_production is distinct from p_expected_production
     or v_app.forward_url_sandbox is distinct from p_expected_sandbox then
    return 'preview_changed';
  end if;
  -- This operation only fills empty forwarding or preserves the existing destination.
  if (v_app.forward_url_production is not null and v_app.forward_url_production is distinct from p_forward_production)
     or (v_app.forward_url_sandbox is not null and v_app.forward_url_sandbox is distinct from p_forward_sandbox) then
    return 'preview_changed';
  end if;
  update public.apps set forward_url_production = p_forward_production,
                         forward_url_sandbox = p_forward_sandbox where id = p_app;
  return 'ok';
end $$;

revoke all on function public.prepare_apple_connection(uuid, uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.prepare_apple_connection(uuid, uuid, text, text, text, text, text, text, text) to service_role;

commit;
