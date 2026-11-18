-- ADDITIVE ACCOUNT MIGRATION. Review in staging after 20261118_members_roles.sql.
-- NOT applied by the app. No existing farm/cash rows are deleted or re-attributed.
-- Adds own profile preferences, own notification preferences, private avatars and
-- checked account/session/invitation RPCs. Session metadata is READ-ONLY auth data.
-- BEHAVIOR: verified opt-in MFA requires aal2 for app data/RPCs; no forced enrollment.
-- BEHAVIOR: account deletion/leave is blocked for ANY workspace owner until transfer.
-- Future account deletion nulls creator/assignee FKs while retaining business rows
-- and historical audit records. Shared business files require ownership transfer.
begin;
do $$ begin
  if to_regprocedure('public.fw_access_context(uuid)') is null then raise exception 'Apply 20261118_members_roles.sql first'; end if;
end $$;

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists language text not null default 'en';
alter table public.profiles add column if not exists time_zone text not null default 'Africa/Nairobi';
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists default_farm_id uuid references public.farms(id) on delete set null;
alter table public.profiles add column if not exists default_period text not null default 'month';
alter table public.profiles drop constraint if exists fw_profile_language;
alter table public.profiles add constraint fw_profile_language check(language in ('en','sw'));
alter table public.profiles drop constraint if exists fw_profile_default_period;
alter table public.profiles add constraint fw_profile_default_period check(default_period in ('month','quarter','half-year','year'));
create table if not exists public.account_notification_preferences(
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app boolean not null default true,email boolean not null default false,
  tasks boolean not null default true,bills boolean not null default true,invitations boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.account_notification_preferences enable row level security;
revoke all on public.account_notification_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.account_notification_preferences to authenticated;
drop policy if exists fw_notifications_self on public.account_notification_preferences;
create policy fw_notifications_self on public.account_notification_preferences for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());

create or replace function fw_private.account_aal_ok() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select auth.uid() is not null and exists(select 1 from auth.users u where u.id=auth.uid())
    and (auth.jwt()->>'aal'='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified'))
$$;
create or replace function fw_private.require_account() returns uuid
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to manage your account' using errcode='42501'; end if;
  if not fw_private.account_aal_ok() then raise exception 'Verify your authenticator to continue' using errcode='42501'; end if;
  return auth.uid();
end $$;
create or replace function public.fw_role(ws uuid) returns text language sql stable security definer set search_path=pg_catalog,public as $$
  select m.role from public.workspace_members m where m.workspace_id=ws and m.user_id=auth.uid() and fw_private.account_aal_ok()
$$;
create or replace function public.fw_is_member(ws uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select fw_private.account_aal_ok() and exists(select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=auth.uid())
$$;

create or replace function fw_private.profile_settings_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from pg_timezone_names where name=new.time_zone) then raise exception 'Choose a valid time zone' using errcode='22023'; end if;
  if new.avatar_path is not null and split_part(new.avatar_path,'/',1)<>new.id::text then raise exception 'This photo belongs to another account' using errcode='42501'; end if;
  if new.default_farm_id is not null and (tg_op='INSERT' or new.default_farm_id is distinct from old.default_farm_id) then
    if not exists(select 1 from public.farms f join public.workspace_members m on m.workspace_id=f.workspace_id and m.user_id=new.id
      where f.id=new.default_farm_id and (m.farm_scope='all' or exists(select 1 from public.workspace_member_farms a where a.workspace_id=m.workspace_id and a.user_id=new.id and a.farm_id=f.id))) then
      raise exception 'Choose a default farm you can access' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists fw_profile_settings_guard on public.profiles;
create trigger fw_profile_settings_guard before insert or update on public.profiles for each row execute function fw_private.profile_settings_guard();

-- Storage defaults to private and is isolated from the existing receipts bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('fw-avatars','fw-avatars',false,1048576,array['image/webp','image/jpeg','image/png']) on conflict(id) do nothing;
create or replace function fw_private.own_avatar_path(object_name text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select fw_private.account_aal_ok() and split_part(object_name,'/',1)=auth.uid()::text
$$;
drop policy if exists fw_avatars_read on storage.objects;
drop policy if exists fw_avatars_insert on storage.objects;
drop policy if exists fw_avatars_update on storage.objects;
drop policy if exists fw_avatars_delete on storage.objects;
create policy fw_avatars_read on storage.objects for select to authenticated using(bucket_id='fw-avatars' and fw_private.own_avatar_path(name));
create policy fw_avatars_insert on storage.objects for insert to authenticated with check(bucket_id='fw-avatars' and fw_private.own_avatar_path(name));
create policy fw_avatars_update on storage.objects for update to authenticated using(bucket_id='fw-avatars' and fw_private.own_avatar_path(name)) with check(bucket_id='fw-avatars' and fw_private.own_avatar_path(name));
create policy fw_avatars_delete on storage.objects for delete to authenticated using(bucket_id='fw-avatars' and fw_private.own_avatar_path(name));
drop policy if exists fw_avatars_guard on storage.objects;
create policy fw_avatars_guard on storage.objects as restrictive for all to authenticated using(bucket_id<>'fw-avatars' or fw_private.own_avatar_path(name)) with check(bucket_id<>'fw-avatars' or fw_private.own_avatar_path(name));

-- Opt-in MFA must protect data, not just display a verification screen. SQL
-- expressions are query constants so the account-factor lookup can be init-planned.
do $$ declare t text; begin
  foreach t in array array['profiles','workspaces','workspace_members','workspace_member_farms','workspace_invites','account_notification_preferences',
    'farms','fx_rates','categories','vendors','tasks','checklists','checklist_items','checklist_runs','checklist_run_items','transactions','budgets','month_closings',
    'recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','vendor_bills','audit_log'] loop
    execute format('drop policy if exists fw_account_mfa_guard on public.%I',t);
    execute format('create policy fw_account_mfa_guard on public.%I as restrictive for all to authenticated using ((select fw_private.account_aal_ok())) with check ((select fw_private.account_aal_ok()))',t);
  end loop;
end $$;
drop policy if exists fw_receipts_mfa_guard on storage.objects;
create policy fw_receipts_mfa_guard on storage.objects as restrictive for all to authenticated using(bucket_id<>'receipts' or (select fw_private.account_aal_ok())) with check(bucket_id<>'receipts' or (select fw_private.account_aal_ok()));

create or replace function public.fw_account_workspaces() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'currency',w.currency,'role',m.role,'farm_scope',m.farm_scope) order by w.name),'[]') into result
    from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=uid;
  return result;
end $$;
create or replace function public.fw_account_context() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); p jsonb; prefs jsonb;
begin
  select to_jsonb(x) into p from public.profiles x where x.id=uid;
  select to_jsonb(x) into prefs from public.account_notification_preferences x where x.user_id=uid;
  return jsonb_build_object('schema_version','20261118-account','profile',p,'notifications',coalesce(prefs,jsonb_build_object('user_id',uid,'in_app',true,'email',false,'tasks',true,'bills',true,'invitations',true)));
end $$;
create or replace function public.fw_account_sessions() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',j->>'id','created_at',j->>'created_at','updated_at',j->>'updated_at',
    'user_agent',j->>'user_agent','ip',j->>'ip','current',(j->>'id')=(auth.jwt()->>'session_id')) order by j->>'created_at' desc),'[]') into rows
    from (select to_jsonb(s) j from auth.sessions s where s.user_id=uid) x;
  return jsonb_build_object('available',true,'sessions',rows);
end $$;
create or replace function public.fw_leave_workspace(p_workspace_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); r text;
begin
  perform 1 from public.workspaces where id=p_workspace_id for update;
  select role into r from public.workspace_members where workspace_id=p_workspace_id and user_id=uid for update;
  if not found then raise exception 'This workspace membership was not found' using errcode='42501'; end if;
  if r='owner' then raise exception 'Transfer your owner role before leaving this workspace' using errcode='23514'; end if;
  delete from public.workspace_members where workspace_id=p_workspace_id and user_id=uid;
  update public.profiles set active_workspace=null where id=uid and active_workspace=p_workspace_id;
end $$;

create or replace function public.fw_account_invites() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); email_address text; result jsonb;
begin
  select lower(email) into email_address from auth.users where id=uid and email_confirmed_at is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'workspace_id',w.id,'workspace_name',w.name,'role',i.role,'farm_ids',i.farm_ids,'expires_at',i.expires_at) order by i.created_at desc),'[]') into result
    from public.workspace_invites i join public.workspaces w on w.id=i.workspace_id where i.email=email_address and i.status='pending' and i.expires_at>now();
  return result;
end $$;
alter table public.workspace_invites drop constraint if exists workspace_invites_status_check;
alter table public.workspace_invites add constraint workspace_invites_status_check check(status in ('pending','accepted','revoked','declined'));
create or replace function fw_private.accept_account_invite(invite_id uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); ws uuid; invitation public.workspace_invites; recipient text; inviter_role text;
begin
  select lower(email) into recipient from auth.users where id=uid and email_confirmed_at is not null;
  select workspace_id into ws from public.workspace_invites where id=invite_id;
  if ws is null then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=ws for update;
  select * into invitation from public.workspace_invites where id=invite_id for update;
  if invitation.email is distinct from recipient then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  if invitation.status='accepted' and invitation.accepted_by=uid and public.fw_is_member(ws) then return ws; end if;
  if invitation.status<>'pending' or invitation.expires_at<=now() or public.fw_is_member(ws) then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  select role into inviter_role from public.workspace_members where workspace_id=ws and user_id=invitation.created_by;
  if inviter_role is null or inviter_role not in ('owner','admin') then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  perform fw_private.check_assignment(ws,inviter_role,invitation.role,invitation.farm_ids);
  insert into public.workspace_members(workspace_id,user_id,role,farm_scope) values(ws,uid,invitation.role,case when invitation.farm_ids is null then 'all' else 'farms' end);
  insert into public.workspace_member_farms(workspace_id,user_id,farm_id) select ws,uid,f from(select distinct unnest(invitation.farm_ids) f)x;
  update public.workspace_invites set status='accepted',accepted_by=uid,accepted_at=now() where id=invite_id;
  return ws;
end $$;
create or replace function public.fw_accept_account_invite(p_invite_id uuid) returns uuid
language sql security definer set search_path=pg_catalog,public as $$select fw_private.accept_account_invite(p_invite_id)$$;
create or replace function public.fw_accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid;
begin
  perform fw_private.require_account();
  if p_token is null or p_token!~'^[0-9a-fA-F]{64}$' then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  select id into target from public.workspace_invites where token_hash=fw_private.token_hash(p_token);
  return fw_private.accept_account_invite(target);
end $$;
create or replace function public.fw_decline_account_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); recipient text;
begin
  select lower(email) into recipient from auth.users where id=uid and email_confirmed_at is not null;
  update public.workspace_invites set status='declined' where id=p_invite_id and email=recipient and status='pending';
  if not found then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
end $$;

create or replace function public.fw_account_export() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); identity_data jsonb; data jsonb;
begin
  select jsonb_build_object('id',id,'email',email,'email_confirmed_at',email_confirmed_at,'phone',phone,'phone_confirmed_at',phone_confirmed_at,'created_at',created_at,'last_sign_in_at',last_sign_in_at,'user_metadata',raw_user_meta_data)
    into identity_data from auth.users where id=uid;
  data:=public.fw_account_context();
  return jsonb_build_object('exported_at',now(),'scope','Your account, preferences and memberships. Shared farm records remain available through authorized module reports. Passwords, tokens, MFA secrets and other members are excluded.',
    'identity',identity_data,'profile',data->'profile','notification_preferences',data->'notifications','memberships',public.fw_account_workspaces(),'pending_invitations',public.fw_account_invites());
end $$;
create or replace function public.fw_account_delete_status() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare uid uuid:=fw_private.require_account(); owned jsonb; files bigint; avatars jsonb; active boolean;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)),'[]') into owned from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.user_id=uid and m.role='owner';
  select count(*) into files from storage.objects o where coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=uid::text and o.bucket_id<>'fw-avatars';
  select coalesce(jsonb_agg(o.name),'[]') into avatars from storage.objects o where o.bucket_id='fw-avatars' and split_part(o.name,'/',1)=uid::text;
  select exists(select 1 from auth.sessions s where s.user_id=uid and (to_jsonb(s)->>'id')=(auth.jwt()->>'session_id')
    and (to_jsonb(s)->>'not_after' is null or (to_jsonb(s)->>'not_after')::timestamptz>now())) into active;
  return jsonb_build_object('schema_version','20261118-account','owned_workspaces',owned,'business_files',files,'avatar_paths',avatars,'session_active',active);
end $$;

-- Preserve shared business history when a NON-owner account is actually deleted.
-- Identify the baseline single-column auth FK through the catalog, not an assumed
-- generated constraint name. New constraints change only future delete behavior.
alter table public.workspace_invites alter column created_by drop not null;
do $$ declare item text[]; existing record; relation regclass; attribute smallint; begin
  foreach item slice 1 in array array[
    ['workspaces','created_by'],['tasks','assigned_to'],['checklist_run_items','done_by'],['transactions','created_by'],
    ['funding_opportunities','owner_id'],['workspace_invites','created_by'],['workspace_invites','accepted_by']
  ] loop
    relation:=format('public.%I',item[1])::regclass;
    select attnum into attribute from pg_attribute where attrelid=relation and attname=item[2] and not attisdropped;
    for existing in select conname from pg_constraint where conrelid=relation and confrelid='auth.users'::regclass and contype='f' and conkey=array[attribute] loop
      execute format('alter table %s drop constraint %I',relation,existing.conname);
    end loop;
    execute format('alter table %s add constraint %I foreign key(%I) references auth.users(id) on delete set null',relation,'fw_account_'||item[1]||'_'||item[2],item[2]);
  end loop;
end $$;
create or replace function fw_private.account_delete_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- Member role changes also lock workspace rows. Serialize those changes with
  -- deletion so a concurrent promotion cannot slip past the ownership check.
  perform 1 from public.workspaces w where exists(select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=old.id) order by w.id for update;
  if exists(select 1 from public.workspace_members where user_id=old.id and role='owner') then
    raise exception 'Transfer ownership of every workspace before deleting this account' using errcode='23514';
  end if;
  update public.workspace_invites set status='revoked' where created_by=old.id and status='pending';
  return old;
end $$;
drop trigger if exists fw_account_delete_guard on auth.users;
create trigger fw_account_delete_guard before delete on auth.users for each row execute function fw_private.account_delete_guard();

revoke all on function fw_private.account_aal_ok(),fw_private.require_account(),fw_private.profile_settings_guard(),fw_private.own_avatar_path(text),fw_private.accept_account_invite(uuid),fw_private.account_delete_guard() from public,anon,authenticated;
grant execute on function fw_private.account_aal_ok(),fw_private.own_avatar_path(text) to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in('fw_account_workspaces','fw_account_context','fw_account_sessions','fw_leave_workspace','fw_account_invites','fw_accept_account_invite','fw_accept_invite','fw_decline_account_invite','fw_account_export','fw_account_delete_status') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
commit;
