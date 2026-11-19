-- UNAPPLIED FORWARD CHANGE PROPOSAL. No live database execution is authorized
-- by this file. Root will copy the reviewed body into a CLI-generated migration
-- and an atomic, approved installation/rehearsal wrapper.
-- Intentionally no BEGIN/COMMIT: the caller must supply transaction boundaries.
-- Does not alter installed migrations, Auth settings, invitation verification,
-- RLS policies, existing memberships, credentials, or existing farm records.

do $prerequisites$
begin
  if to_regprocedure('fw_private.require_account()') is null
    or to_regprocedure('fw_private.check_assignment(uuid,text,text,uuid[],text)') is null
    or to_regprocedure('public.fw_role(uuid)') is null then
    raise exception 'Install the reviewed account and membership upgrades first';
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fw_add_member_by_id') then
    raise exception 'Review the existing fw_add_member_by_id function before installing this forward change';
  end if;
end $prerequisites$;

create function public.fw_add_member_by_id(
  p_workspace_id uuid,p_user_id uuid,p_role text,p_farm_ids uuid[] default null
) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog,public as $function$
declare
  uid uuid:=fw_private.require_account();
  item jsonb;
  authenticated_at timestamptz;
  recent_primary boolean:=false;
  assigned_farms uuid[];
  assigned_scope text;
begin
  -- This is an explicit owner's approval, not evidence about an email address.
  -- The owner must independently identify the person sharing this Account ID.
  if not exists(select 1 from auth.users u where u.id=uid
    and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
    and to_jsonb(u)->>'deleted_at' is null
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=statement_timestamp())) then
    raise exception 'Use an active permanent account to approve workspace access' using errcode='42501';
  end if;
  -- Match the server account API's primary authentication methods. Recovery or
  -- MFA-only AMR is not a fresh primary sign-in for approving a new member.
  for item in select value from jsonb_array_elements(
    case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end
  ) loop
    if not coalesce(item->>'method'=any(array['password','oauth','otp','magiclink','sso/saml']),false)
      or jsonb_typeof(item->'timestamp') is distinct from 'number' then continue;end if;
    begin authenticated_at:=to_timestamp((item->>'timestamp')::double precision);
    exception when others then continue;end;
    if authenticated_at>=statement_timestamp()-interval '10 minutes'
      and authenticated_at<=statement_timestamp()+interval '30 seconds' then recent_primary:=true;end if;
  end loop;
  if not recent_primary then
    raise exception 'Sign in again before approving a new workspace member' using errcode='42501';
  end if;

  -- Existing member mutations and account deletion use the same workspace lock.
  -- Check the owner's current role after acquiring it, never a client role claim.
  perform 1 from public.workspaces where id=p_workspace_id for update;
  if not found or public.fw_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'Only a current workspace owner can approve an Account ID' using errcode='42501';
  end if;
  if p_role is null or p_role not in ('manager','accountant','worker','viewer') then
    raise exception 'Choose manager, accountant, worker or viewer' using errcode='22023';
  end if;
  if p_user_id is null or p_user_id=uid then
    raise exception 'Choose another existing permanent Account ID' using errcode='22023';
  end if;
  if exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id) then
    raise exception 'This account is already a member; use Change access instead' using errcode='23505';
  end if;
  if not exists(select 1 from auth.users u where u.id=p_user_id
    and not coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
    and to_jsonb(u)->>'deleted_at' is null
    and (to_jsonb(u)->>'banned_until' is null or (to_jsonb(u)->>'banned_until')::timestamptz<=statement_timestamp())) then
    raise exception 'Choose an existing permanent Account ID' using errcode='22023';
  end if;
  -- A UID can be shared by an auto-confirmed password account and a later
  -- Google sign-in. Owner recognition of that UID does not remove the old
  -- credential. This temporary path accepts only one verified Google identity
  -- and no password; mixed/password accounts retain the email-recovery route.
  -- Inspect only password presence here, never return or copy its stored value.
  if not exists(select 1 from auth.users u where u.id=p_user_id
    and coalesce(u.encrypted_password,'')=''
    and nullif(lower(btrim(u.email)),'') is not null
    and (select count(*) from auth.identities i where i.user_id=u.id)=1
    and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google'
      and i.identity_data->'email_verified'='true'::jsonb
      and nullif(lower(btrim(i.identity_data->>'email')),'')=lower(btrim(u.email)))) then
    raise exception 'This account needs email recovery before it can be added. Google-only accounts can be added now.' using errcode='42501';
  end if;
  -- This checks nonempty scope and every farm's workspace. A NULL array means
  -- all farms; duplicate IDs are normalized before the atomic inserts.
  perform fw_private.check_assignment(p_workspace_id,'owner',p_role,p_farm_ids);
  if p_farm_ids is not null then
    select array_agg(distinct f order by f) into assigned_farms from unnest(p_farm_ids) f;
  end if;
  assigned_scope:=case when assigned_farms is null then 'all' else 'farms' end;
  -- No upsert: another operation can never silently change an existing role.
  -- Auth/workspace/farm foreign keys also reject concurrent deletion races.
  insert into public.workspace_members(workspace_id,user_id,role,farm_scope)
    values(p_workspace_id,p_user_id,p_role,assigned_scope);
  insert into public.workspace_member_farms(workspace_id,user_id,farm_id)
    select p_workspace_id,p_user_id,f from unnest(assigned_farms) f;
  -- Existing membership/scope audit triggers retain actor, role and farm scope.
  return jsonb_build_object('user_id',p_user_id,'role',p_role,'farm_scope',assigned_scope,
    'farm_ids',coalesce(assigned_farms,'{}'::uuid[]));
end $function$;

revoke all on function public.fw_add_member_by_id(uuid,uuid,text,uuid[]) from public,anon,authenticated;
grant execute on function public.fw_add_member_by_id(uuid,uuid,text,uuid[]) to authenticated;
