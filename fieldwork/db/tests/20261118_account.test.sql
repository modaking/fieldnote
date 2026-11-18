-- EXECUTABLE SQL TESTS: see README.md for execution results and rehearsal limits.
-- Run as the database owner in disposable Supabase/PostgreSQL staging after
-- schema.sql, 20261118_members_roles.sql and 20261118_account.sql.
-- psql <staging connection> -v ON_ERROR_STOP=1 -f this-file.sql
-- Rollback fixtures only; no real credentials, emails, TOTP secrets or Auth calls.
begin;
-- Initialize the backend's temporary namespace before creating its helpers.
create temporary table fw_account_test_namespace_anchor(unused boolean);
do $temp_schema_grants$ declare namespace_name text; begin
  select nspname into namespace_name from pg_namespace where oid=pg_my_temp_schema();
  if namespace_name is null then raise exception 'Test temporary namespace was not initialized';end if;
  execute format('grant usage on schema %I to authenticated',namespace_name);
end $temp_schema_grants$;
create function pg_temp.account_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %',message;end if;end $$;
create function pg_temp.account_denied(statement text,expected text default '42501') returns void language plpgsql as $$
begin begin execute statement;exception when others then if sqlstate=expected then return;end if;raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;end;raise exception 'Expected denial: %',statement;end $$;
create function pg_temp.account_actor(uid uuid,aal text default 'aal1',sid uuid default null,method text default 'magiclink',age interval default interval '30 seconds',email_override text default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if uid is not null and split_part(uid::text,'-',1)<>'b1000000' then raise exception 'Fixture actor required';end if;
  if sid is null then sid:=case uid when 'b1000000-0000-4000-8000-000000000002' then 'b6000000-0000-4000-8000-000000000001'::uuid
    when 'b1000000-0000-4000-8000-000000000003' then 'b6000000-0000-4000-8000-000000000002'::uuid else uid end;end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal',aal,'session_id',sid,
    'email',coalesce(email_override,(select email from auth.users where id=uid)),'amr',jsonb_build_array(jsonb_build_object('method',method,'timestamp',extract(epoch from statement_timestamp()-age))))::text,true);
end $$;
grant execute on function pg_temp.account_assert(boolean,text),pg_temp.account_denied(text,text),pg_temp.account_actor(uuid,text,uuid,text,interval,text) to authenticated;
select pg_temp.account_assert(to_regprocedure('public.fw_invitation_verification()') is not null and to_regprocedure('public.fw_complete_invite_recovery()') is not null,'no-argument invitation contracts installed');
select pg_temp.account_assert(not has_function_privilege('anon','public.fw_invitation_verification()','execute'),'anonymous cannot query verification status');
select pg_temp.account_assert(not has_function_privilege('authenticated','fw_private.invitation_email_proof(boolean)','execute'),'private proof helper is not a client API');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','account-owner@fieldwork.invalid',now(),'{"full_name":"Account Owner"}','{}'),
 ('b1000000-0000-4000-8000-000000000002','account-member@fieldwork.invalid',now(),'{"full_name":"Account Member"}','{}'),
 ('b1000000-0000-4000-8000-000000000003','account-other@fieldwork.invalid',now(),'{"full_name":"Account Other"}','{}'),
 ('b1000000-0000-4000-8000-000000000004','account-invite@fieldwork.invalid',now(),'{"full_name":"Account Invite","fieldnote_mailbox_verified_at":"2000-01-01T00:00:00Z","fieldnote_mailbox_verified_email":"account-invite@fieldwork.invalid"}','{"preserve":"yes"}'),
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
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',now()-interval '2 minutes',now()),
 ('b1000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000004',now()-interval '2 minutes',now()),
 ('b1000000-0000-4000-8000-000000000005','b1000000-0000-4000-8000-000000000005',now()-interval '2 minutes',now());
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
select pg_temp.account_assert(public.fw_account_export()->'pending_invitations_available'='false'::jsonb,'own export remains available without exposing unverified incoming invitations');
select pg_temp.account_denied($q$select public.fw_account_invites()$q$);
select pg_temp.account_denied($q$select public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000005');
select pg_temp.account_assert(public.fw_invitation_verification()='{"needs_recovery":true,"proof_recent":false}'::jsonb,'unverified email gets only verification status');
select pg_temp.account_denied($q$select public.fw_account_invites()$q$);
select pg_temp.account_denied($q$select public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000002')$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004');
select pg_temp.account_assert(public.fw_invitation_verification()='{"needs_recovery":true,"proof_recent":true}'::jsonb,'implicit confirmation and forged user_metadata do not attest mailbox ownership');
select pg_temp.account_denied($q$select public.fw_account_invites()$q$);
select pg_temp.account_denied($q$select public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_denied($q$select public.fw_accept_invite(repeat('1',64))$q$);
select pg_temp.account_denied($q$select public.fw_decline_account_invite('b7000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'password');
select pg_temp.account_assert(public.fw_invitation_verification()->'proof_recent'='false'::jsonb,'password login is not mailbox proof');
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'otp');
select pg_temp.account_assert(public.fw_invitation_verification()->'proof_recent'='false'::jsonb,'generic OTP may be SMS and is not mailbox proof');
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'mfa/recovery_code');
select pg_temp.account_assert(public.fw_invitation_verification()->'proof_recent'='false'::jsonb,'MFA recovery codes are not email recovery proof');
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery',interval '11 minutes');
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery',interval '-1 minute');
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery',interval '30 seconds','someone-else@fieldwork.invalid');
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1','b6000000-0000-4000-8000-000000000002','recovery');
select pg_temp.account_denied($q$select public.fw_invitation_verification()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery');
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{client_id}','"delegated-client"'::jsonb)::text,true);
select pg_temp.account_denied($q$select public.fw_invitation_verification()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery');
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('timestamp',extract(epoch from statement_timestamp()))))::text,true);
select pg_temp.account_assert(public.fw_invitation_verification()->'proof_recent'='false'::jsonb,'missing AMR method never becomes proof');
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'recovery');
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
reset role;
-- Only a completed Auth password event for this UID after this proof/session
-- counts. No actual password, email delivery or password hash is used here.
insert into auth.audit_log_entries(id,payload,created_at) values
 ('b6000000-0000-4000-8000-000000000003',jsonb_build_object('action','user_updated_password','actor_id','b1000000-0000-4000-8000-000000000003'),statement_timestamp()),
 ('b6000000-0000-4000-8000-000000000004',jsonb_build_object('action','user_updated_password','actor_id','b1000000-0000-4000-8000-000000000004'),statement_timestamp()-interval '1 hour'),
 ('b6000000-0000-4000-8000-000000000005',jsonb_build_object('action','user_modified','actor_id','b1000000-0000-4000-8000-000000000004'),statement_timestamp()),
 ('b6000000-0000-4000-8000-000000000007',jsonb_build_object('action','user_updated_password','actor_id','b1000000-0000-4000-8000-000000000004'),statement_timestamp()-interval '20 seconds');
update auth.sessions set created_at=statement_timestamp()-interval '10 seconds' where id='b1000000-0000-4000-8000-000000000004';
set local role authenticated;
-- The matching event above is newer than the proof but older than this session.
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
reset role;
insert into auth.audit_log_entries(id,payload,created_at) values
 ('b6000000-0000-4000-8000-000000000006',jsonb_build_object('action','user_updated_password','actor_id','b1000000-0000-4000-8000-000000000004'),statement_timestamp());
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b6000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000004',statement_timestamp(),statement_timestamp());
set local role authenticated;
select pg_temp.account_denied($q$select public.fw_complete_invite_recovery()$q$);
reset role;
delete from auth.sessions where id='b6000000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.account_assert(public.fw_complete_invite_recovery()='{"needs_recovery":false,"proof_recent":true}'::jsonb,'fresh email recovery plus completed rotation and no other sessions attests mailbox');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_invites())=1,'attested fresh recipient sees own invitation');
select public.fw_decline_account_invite('b7000000-0000-4000-8000-000000000001');
select pg_temp.account_denied($q$select public.fw_accept_invite(repeat('1',64))$q$);
reset role;
select pg_temp.account_assert((select raw_app_meta_data->>'preserve'='yes' and raw_app_meta_data->>'fieldnote_mailbox_verified_email'=email from auth.users where id='b1000000-0000-4000-8000-000000000004'),'completion preserves app metadata and binds its marker to current email');
select pg_temp.account_assert(not has_function_privilege('anon','public.fw_complete_invite_recovery()','execute'),'anonymous cannot attest recovery');
select pg_temp.account_assert(not has_table_privilege('authenticated','auth.users','update'),'clients cannot write trusted app metadata directly');
insert into public.workspace_invites(id,workspace_id,email,role,token_hash,created_by,expires_at) values
 ('b7000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001','account-invite@fieldwork.invalid','viewer',fw_private.token_hash(repeat('3',64)),'b1000000-0000-4000-8000-000000000001',statement_timestamp()+interval '1 day');
set local role authenticated;
select pg_temp.account_assert(public.fw_accept_account_invite('b7000000-0000-4000-8000-000000000003')='b2000000-0000-4000-8000-000000000001'::uuid,'attested UUID acceptance grants only the addressed invitation');
select pg_temp.account_assert(public.fw_accept_invite(repeat('3',64))='b2000000-0000-4000-8000-000000000001'::uuid,'token acceptance safely retries the same attested recipient');
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004','aal1',null,'magiclink',interval '11 minutes');
select pg_temp.account_assert(public.fw_invitation_verification()='{"needs_recovery":false,"proof_recent":false}'::jsonb,'completed recovery persists but old email proof expires');
select pg_temp.account_denied($q$select public.fw_account_invites()$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004');
select pg_temp.account_assert(jsonb_array_length(public.fw_account_invites())=0,'fresh magiclink restores only verified recipient invitation access');
reset role;
update auth.users set email='changed-invite@fieldwork.invalid' where id='b1000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000004');
select pg_temp.account_assert(public.fw_invitation_verification()='{"needs_recovery":true,"proof_recent":true}'::jsonb,'a changed email requires a new recovery marker');
select pg_temp.account_denied($q$select public.fw_account_invites()$q$);
reset role;
delete from auth.sessions where id='b1000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.account_denied($q$select public.fw_access_context('b2000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_denied($q$select public.fw_account_context()$q$);
select pg_temp.account_assert((select count(*)=0 from public.tasks),'revoked signed session cannot read ordinary app rows');
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
select pg_temp.account_denied($q$select public.fw_access_context('b2000000-0000-4000-8000-000000000001')$q$);
select pg_temp.account_actor('b1000000-0000-4000-8000-000000000002','aal2','b6000000-0000-4000-8000-000000000001');
select pg_temp.account_assert((select count(*)=1 from public.tasks),'verified aal2 restores permitted app data');
select pg_temp.account_assert(public.fw_account_context()->'profile'->>'id'='b1000000-0000-4000-8000-000000000002','verified own account works');
select pg_temp.account_assert(public.fw_access_context('b2000000-0000-4000-8000-000000000001')->>'role'='manager','verified aal2 restores access context');
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
-- Validate deferred FKs before the suite can report PASS and roll back.
set constraints all immediate;
rollback;
