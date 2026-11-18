-- EXECUTABLE STAGING TESTS: NOT EXECUTED in this workspace.
-- Run as the database owner in disposable Supabase/PostgreSQL staging after
-- schema.sql, 20261118_members_roles.sql and 20261118_account.sql.
-- psql <staging connection> -v ON_ERROR_STOP=1 -f this-file.sql
-- Rollback fixtures only; no real credentials, emails, TOTP secrets or Auth calls.
begin;
create function pg_temp.account_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %',message;end if;end $$;
create function pg_temp.account_denied(statement text,expected text default '42501') returns void language plpgsql as $$
begin begin execute statement;exception when others then if sqlstate=expected then return;end if;raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;end;raise exception 'Expected denial: %',statement;end $$;
create function pg_temp.account_actor(uid uuid,aal text default 'aal1',sid uuid default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub',uid::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal',aal,'session_id',sid)::text,true);end $$;
grant usage on schema pg_temp to authenticated;
grant execute on function pg_temp.account_assert(boolean,text),pg_temp.account_denied(text,text),pg_temp.account_actor(uuid,text,uuid) to authenticated;

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','account-owner@fieldwork.invalid',now(),'{"full_name":"Account Owner"}','{}'),
 ('b1000000-0000-4000-8000-000000000002','account-member@fieldwork.invalid',now(),'{"full_name":"Account Member"}','{}'),
 ('b1000000-0000-4000-8000-000000000003','account-other@fieldwork.invalid',now(),'{"full_name":"Account Other"}','{}'),
 ('b1000000-0000-4000-8000-000000000004','account-invite@fieldwork.invalid',now(),'{"full_name":"Account Invite"}','{}'),
 ('b1000000-0000-4000-8000-000000000005','account-unverified@fieldwork.invalid',null,'{}','{}');
insert into public.workspaces(id,name,currency,created_by) values('b2000000-0000-4000-8000-000000000001','Account fixture','KES','b1000000-0000-4000-8000-000000000001');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','manager');
insert into public.farms(id,workspace_id,name) values('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Account farm');
insert into public.tasks(id,workspace_id,farm_id,title,assigned_to) values('b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','Retained task','b1000000-0000-4000-8000-000000000002');
insert into public.transactions(id,workspace_id,farm_id,kind,amount,currency,created_by,description) values('b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','expense',12345,'KES','b1000000-0000-4000-8000-000000000002','Retained cash');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',now(),now()),
 ('b6000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000003',now(),now());
insert into public.workspace_invites(id,workspace_id,email,role,token_hash,created_by,expires_at) values
 ('b7000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','account-invite@fieldwork.invalid','viewer',fw_private.token_hash(repeat('1',64)),'b1000000-0000-4000-8000-000000000001',now()+interval '1 day'),
 ('b7000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','account-unverified@fieldwork.invalid','viewer',fw_private.token_hash(repeat('2',64)),'b1000000-0000-4000-8000-000000000001',now()+interval '1 day');

set local role authenticated;
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000002','aal1','b6000000-0000-4000-8000-000000000001');
select pg_temp.account_assert(public.fw_account_context()->>'schema_version'='20261118-account','account schema readiness');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_sessions()->'sessions')=1,'only own session is listed');
select pg_temp.account_assert((public.fw_account_sessions()->'sessions'->0->>'current')::boolean,'current session marked');
select pg_temp.account_assert((public.fw_account_delete_status()->>'session_active')::boolean,'actual own session active');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_workspaces())=1,'own workspaces only');
insert into public.account_notification_preferences(user_id,email) values('b1000000-0000-4000-8000-000000000002',false);
select pg_temp.account_denied($q$insert into public.account_notification_preferences(user_id) values('b1000000-0000-4000-8000-000000000003')$q$);
select pg_temp.account_assert((select count(*)=1 from public.profiles),'other profiles are private');
select pg_temp.account_denied($q$update public.profiles set avatar_path='b1000000-0000-4000-8000-000000000003/avatar.webp' where id='b1000000-0000-4000-8000-000000000002'$q$);
select pg_temp.account_denied($q$update public.profiles set time_zone='Invalid/Zone' where id='b1000000-0000-4000-8000-000000000002'$q$,'22023');
update public.profiles set default_farm_id='b3000000-0000-4000-8000-000000000001',default_period='quarter' where id='b1000000-0000-4000-8000-000000000002';
select pg_temp.account_assert(not(public.fw_account_export() ? 'access_token'),'export excludes tokens');
select pg_temp.account_assert(public.fw_account_export()->'identity'->>'id'='b1000000-0000-4000-8000-000000000002','export identity is caller');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_invites())=0,'cannot enumerate another email invitations');
select pg_temp.account_denied($q$select public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000005');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_invites())=0,'unverified email sees no pending invitations');
select pg_temp.account_denied($q$select public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000002')$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_invites())=1,'verified recipient sees own invitation');
select public.fw_decline_account_invite('b7000000-0000-4000-8000-000000000001');
select pg_temp.account_denied($q$select public.fw_accept_invite(repeat('1',64))$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000001');
select pg_temp.account_denied($q$select public.fw_leave_workspace('b2000000-0000-4000-8000-000000000001')$q$,'23514');
reset role;
select pg_temp.account_denied($q$delete from auth.users where id='b1000000-0000-4000-8000-000000000001'$q$,'23514');

-- Factors are fixtures only: no actual enrollment or usable authenticator key.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values
 ('b8000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002','Fixture only','totp','verified','not-a-usable-secret',now(),now());
set local role authenticated;
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000002','aal1','b6000000-0000-4000-8000-000000000001');
select pg_temp.account_assert((select count(*)=0 from public.tasks),'enrolled aal1 cannot read app data');
select pg_temp.account_denied($q$select public.fw_account_export()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000002','aal2','b6000000-0000-4000-8000-000000000001');
select pg_temp.account_assert((select count(*)=1 from public.tasks),'verified aal2 restores permitted app data');
select pg_temp.account_assert(public.fw_account_context()->'profile'->>'id'='b1000000-0000-4000-8000-000000000002','verified own account works');
select public.fw_leave_workspace('b2000000-0000-4000-8000-000000000001');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_workspaces())=0,'member can leave without deleting records');
reset role;
delete from auth.users where id='b1000000-0000-4000-8000-000000000002';
select pg_temp.account_assert((select assigned_to is null from public.tasks where id='b4000000-0000-4000-8000-000000000001'),'task retained and assignee cleared');
select pg_temp.account_assert((select amount=12345 and created_by is null from public.transactions where id='b5000000-0000-4000-8000-000000000001'),'cash minor units retained and creator cleared');
select pg_temp.account_assert(exists(select 1 from public.audit_log where row_id='b5000000-0000-4000-8000-000000000001'),'business audit remains');
set local role authenticated;
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000002','aal2','b6000000-0000-4000-8000-000000000001');
select pg_temp.account_denied($q$select public.fw_account_context()$q$);
reset role;
rollback;
