-- ROLLBACK-ONLY regression suite for manual-membership-proposal.sql.
-- NOT EXECUTED. Fixtures are reserved UUIDs/.invalid addresses, not Auth API calls.
-- Standalone: run only after the proposed function exists in a disposable DB.
-- To rehearse the UNAPPLIED proposal on the current project, root must build ONE
-- fail-fast outer transaction, place the proposal before this suite, strip this
-- BEGIN/final ROLLBACK, then finish the entire batch with ROLLBACK. Do not nest
-- transactions, append COMMIT, or run fixture statements individually.
-- Audit identity sequence gaps/logs can survive rollback; do not reset sequences.
begin;
set local statement_timeout='10s';
set local lock_timeout='2s';
create temporary table fw_manual_test_namespace_anchor(unused boolean);
do $temp_schema_grants$ declare namespace_name text;begin
  select nspname into namespace_name from pg_namespace where oid=pg_my_temp_schema();
  if namespace_name is null then raise exception 'Test temporary namespace was not initialized';end if;
  execute format('grant usage on schema %I to authenticated,anon',namespace_name);
end $temp_schema_grants$;
create function pg_temp.manual_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %',message;end if;end $$;
create function pg_temp.manual_denied(statement text,expected text default '42501') returns void language plpgsql as $$
begin
  begin execute statement;exception when others then
    if sqlstate=expected then return;end if;
    raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;
  end;
  raise exception 'Expected denial %, statement succeeded: %',expected,statement;
end $$;
create function pg_temp.manual_actor(uid uuid,method text default 'password',age interval default interval '30 seconds',aal text default 'aal1',sid uuid default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if uid is not null and split_part(uid::text,'-',1)<>'e1000000' then raise exception 'Fixture actor required';end if;
  perform set_config('request.jwt.claim.sub',coalesce(uid::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role',case when uid is null then 'anon' else 'authenticated' end,
    'aal',aal,'session_id',coalesce(sid,uid),'amr',jsonb_build_array(jsonb_build_object('method',method,'timestamp',extract(epoch from statement_timestamp()-age))))::text,true);
end $$;
grant execute on function pg_temp.manual_assert(boolean,text),pg_temp.manual_denied(text,text),pg_temp.manual_actor(uuid,text,interval,text,uuid) to authenticated,anon;
create temporary table fw_manual_results(label text primary key,payload jsonb);
grant select,insert on fw_manual_results to authenticated;

-- Abort before inserting fixtures if any reserved row already exists.
do $collision_preflight$ begin
  if current_user<>'postgres' then raise exception 'Run the fixture suite as postgres';end if;
  if exists(select 1 from auth.users where id::text like 'e1000000-%')
    or exists(select 1 from auth.identities where id::text like 'e1000000-%' or user_id::text like 'e1000000-%')
    or exists(select 1 from auth.sessions where id::text like 'e1000000-%')
    or exists(select 1 from auth.mfa_factors where id::text like 'e6000000-%')
    or exists(select 1 from public.workspaces where id::text like 'e2000000-%')
    or exists(select 1 from public.farms where id::text like 'e3000000-%')
    or exists(select 1 from public.tasks where id::text like 'e4000000-%')
    or exists(select 1 from public.transactions where id::text like 'e5000000-%') then
    raise exception 'Reserved manual-membership fixture IDs already exist';
  end if;
end $collision_preflight$;
select pg_temp.manual_assert(to_regprocedure('public.fw_add_member_by_id(uuid,uuid,text,uuid[])') is not null,'proposed function must exist');
select pg_temp.manual_assert(not has_function_privilege('anon','public.fw_add_member_by_id(uuid,uuid,text,uuid[])','execute'),'anonymous execution denied');
select pg_temp.manual_assert(not has_table_privilege('authenticated','public.workspace_members','insert'),'direct membership writes stay forbidden');
select pg_temp.manual_assert(not has_table_privilege('authenticated','public.workspace_member_farms','insert'),'direct farm-scope writes stay forbidden');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,is_anonymous)
select id::uuid,email,confirmed,'{}'::jsonb,'{}'::jsonb,anonymous from(values
 ('e1000000-0000-4000-8000-000000000001','manual-owner-a@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000002','manual-owner-b@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000003','manual-admin@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000004','manual-manager@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000005','manual-accountant@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000006','manual-worker@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000007','manual-viewer@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000008','manual-outsider@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-000000000009','manual-new-worker@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-00000000000a','manual-new-manager@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-00000000000b','manual-anonymous@fieldwork.invalid',null,true),
 ('e1000000-0000-4000-8000-00000000000c','manual-new-accountant@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-00000000000d','manual-new-viewer@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-00000000000e','manual-banned@fieldwork.invalid',null,false),
 ('e1000000-0000-4000-8000-00000000000f','manual-mixed-password@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000010','manual-no-identity@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000011','manual-other-provider@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000012','manual-many-identities@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000013','manual-google-false@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000014','manual-google-string@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000015','manual-google-missing@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000016','manual-google-mismatch@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000017','manual-google-empty@fieldwork.invalid',now(),false),
 ('e1000000-0000-4000-8000-000000000018','manual-google-password@fieldwork.invalid',now(),false)
) fixtures(id,email,confirmed,anonymous);
update auth.users set banned_until=statement_timestamp()+interval '1 hour' where id='e1000000-0000-4000-8000-00000000000e';
-- These fake nonempty password values are not usable credential hashes. Only
-- their presence matters; no real password or hash is read, copied or exported.
update auth.users set encrypted_password='not-a-usable-fixture-password-hash' where id='e1000000-0000-4000-8000-00000000000f';
update auth.users set encrypted_password='not-a-usable-fixture-password-hash' where id='e1000000-0000-4000-8000-000000000018';
update auth.users set encrypted_password='' where id='e1000000-0000-4000-8000-00000000000a';
insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
select identity_id::uuid,user_id::uuid,provider_id,provider,data::jsonb,now(),now() from(values
 ('e1000000-0000-4000-8000-000000000109','e1000000-0000-4000-8000-000000000009','manual-google-009','google','{"email":" MANUAL-NEW-WORKER@FIELDWORK.INVALID ","email_verified":true}'),
 ('e1000000-0000-4000-8000-00000000010a','e1000000-0000-4000-8000-00000000000a','manual-google-00a','google','{"email":"manual-new-manager@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-00000000010c','e1000000-0000-4000-8000-00000000000c','manual-google-00c','google','{"email":"manual-new-accountant@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-00000000010d','e1000000-0000-4000-8000-00000000000d','manual-google-00d','google','{"email":"manual-new-viewer@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-00000000010f','e1000000-0000-4000-8000-00000000000f','manual-google-00f','google','{"email":"manual-mixed-password@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-00000000020f','e1000000-0000-4000-8000-00000000000f','e1000000-0000-4000-8000-00000000000f','email','{"email":"manual-mixed-password@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000111','e1000000-0000-4000-8000-000000000011','manual-github-011','github','{"email":"manual-other-provider@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000112','e1000000-0000-4000-8000-000000000012','manual-google-012','google','{"email":"manual-many-identities@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000212','e1000000-0000-4000-8000-000000000012','manual-github-012','github','{"email":"manual-many-identities@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000113','e1000000-0000-4000-8000-000000000013','manual-google-013','google','{"email":"manual-google-false@fieldwork.invalid","email_verified":false}'),
 ('e1000000-0000-4000-8000-000000000114','e1000000-0000-4000-8000-000000000014','manual-google-014','google','{"email":"manual-google-string@fieldwork.invalid","email_verified":"true"}'),
 ('e1000000-0000-4000-8000-000000000115','e1000000-0000-4000-8000-000000000015','manual-google-015','google','{"email":"manual-google-missing@fieldwork.invalid"}'),
 ('e1000000-0000-4000-8000-000000000116','e1000000-0000-4000-8000-000000000016','manual-google-016','google','{"email":"another@fieldwork.invalid","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000117','e1000000-0000-4000-8000-000000000017','manual-google-017','google','{"email":"  ","email_verified":true}'),
 ('e1000000-0000-4000-8000-000000000118','e1000000-0000-4000-8000-000000000018','manual-google-018','google','{"email":"manual-google-password@fieldwork.invalid","email_verified":true}')
) identities(identity_id,user_id,provider_id,provider,data);
insert into auth.sessions(id,user_id,created_at,updated_at)
select id,id,statement_timestamp()-interval '2 minutes',statement_timestamp() from auth.users where id::text like 'e1000000-%';
insert into public.workspaces(id,name,currency,created_by) values
 ('e2000000-0000-4000-8000-000000000001','Manual membership A','KES','e1000000-0000-4000-8000-000000000001'),
 ('e2000000-0000-4000-8000-000000000002','Manual membership B','KES','e1000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','admin'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','manager'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000005','accountant'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000006','worker'),
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000007','viewer');
insert into public.farms(id,workspace_id,name) values
 ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Manual farm A1'),
 ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','Manual farm A2'),
 ('e3000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000002','Manual farm B');
insert into public.tasks(id,workspace_id,farm_id,title) values
 ('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','A1 task'),
 ('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002','A2 task'),
 ('e4000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000003','B task');
insert into public.transactions(id,workspace_id,farm_id,kind,amount,currency,description) values
 ('e5000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','expense',17000,'KES','Unchanged manual fixture cash');

-- None of these signed-in roles can approve membership, even with fresh proof.
do $nonowners$ declare actor uuid;begin
  foreach actor in array array['e1000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000005','e1000000-0000-4000-8000-000000000006',
    'e1000000-0000-4000-8000-000000000007','e1000000-0000-4000-8000-000000000008']::uuid[] loop
    perform pg_temp.manual_actor(actor);
    set local role authenticated;
    perform pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
    reset role;
  end loop;
end $nonowners$;
set local role anon;
select pg_temp.manual_actor(null);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;

set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','password',interval '11 minutes');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','password',interval '-1 minute');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','recovery');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','totp');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims',(auth.jwt()||'{"amr":[]}'::jsonb)::text,true);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims',(auth.jwt()||'{"amr":"not-an-array"}'::jsonb)::text,true);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims',(auth.jwt()||'{"amr":[{"method":"password","timestamp":"invalid"}]}'::jsonb)::text,true);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims',(auth.jwt()||'{"client_id":"delegated-client"}'::jsonb)::text,true);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','password',interval '30 seconds','aal1','e1000000-0000-4000-8000-000000000002');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;
update auth.sessions set not_after=statement_timestamp()-interval '1 minute' where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;
update auth.sessions set not_after=null where id='e1000000-0000-4000-8000-000000000001';
delete from auth.sessions where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',statement_timestamp(),statement_timestamp());

-- Auth bans/soft deletion need not revoke an existing session. Even with a
-- fresh signed primary AMR and an active own SID, this owner must be denied.
update auth.users set banned_until=statement_timestamp()+interval '1 hour' where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;
update auth.users set banned_until=null,deleted_at=statement_timestamp() where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
reset role;
update auth.users set deleted_at=null where id='e1000000-0000-4000-8000-000000000001';

-- Validation failures must leave both membership and farm-scope rows absent.
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id(null,'e1000000-0000-4000-8000-000000000009','worker',null)$q$);
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','owner',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','admin',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009',null,null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','worker',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001',null,'worker',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-0000000000ff','worker',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000b','worker',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000e','worker',null)$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','viewer',null)$q$,'23505');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker','{}'::uuid[])$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',array[null]::uuid[])$q$,'22023');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',array['e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000003']::uuid[])$q$,'22023');
select pg_temp.manual_assert((select role='manager' from public.workspace_members where workspace_id='e2000000-0000-4000-8000-000000000001' and user_id='e1000000-0000-4000-8000-000000000004'),'existing membership role unchanged');
select pg_temp.manual_assert(not exists(select 1 from public.workspace_members where user_id='e1000000-0000-4000-8000-000000000009'),'failed approvals create no membership');
select pg_temp.manual_assert(not exists(select 1 from public.workspace_member_farms where user_id='e1000000-0000-4000-8000-000000000009'),'failed approvals create no farm scope');

-- An auto-confirmed password can survive automatic Google linking. Google
-- presence alone, an editable providers hint or string "true" is insufficient.
do $unsafe_credentials$ declare target uuid;begin
  foreach target in array array['e1000000-0000-4000-8000-00000000000f','e1000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000013',
    'e1000000-0000-4000-8000-000000000014','e1000000-0000-4000-8000-000000000015','e1000000-0000-4000-8000-000000000016',
    'e1000000-0000-4000-8000-000000000017','e1000000-0000-4000-8000-000000000018']::uuid[] loop
    perform pg_temp.manual_denied(format('select public.fw_add_member_by_id(%L::uuid,%L::uuid,''worker'',null)','e2000000-0000-4000-8000-000000000001',target));
  end loop;
end $unsafe_credentials$;
select pg_temp.manual_assert(not exists(select 1 from public.workspace_members where user_id between 'e1000000-0000-4000-8000-00000000000f' and 'e1000000-0000-4000-8000-000000000018'),'no credential-conflicted account was approved');

-- The caller's JWT email is deliberately unrelated: only signed account/session,
-- current ownership, exact recipient UUID and chosen scope authorize this path.
select set_config('request.jwt.claims',(auth.jwt()||'{"email":"unrelated@fieldwork.invalid"}'::jsonb)::text,true);
insert into fw_manual_results values('worker',public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','worker',array['e3000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001']::uuid[]));
select pg_temp.manual_assert((select payload='{"user_id":"e1000000-0000-4000-8000-000000000009","role":"worker","farm_scope":"farms","farm_ids":["e3000000-0000-4000-8000-000000000001"]}'::jsonb from fw_manual_results where label='worker'),'exact contract normalizes duplicate farms and exposes no email/profile');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000009','manager',null)$q$,'23505');
insert into fw_manual_results values('manager',public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000a','manager',null));
insert into fw_manual_results values('accountant',public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000c','accountant',null));
reset role;

-- Enrolled MFA must be satisfied even for a fresh primary owner sign-in.
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at) values
 ('e6000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Manual fixture only','totp','verified','not-a-usable-secret',now(),now());
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001');
select pg_temp.manual_denied($q$select public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000d','viewer',null)$q$);
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000001','oauth',interval '30 seconds','aal2');
insert into fw_manual_results values('viewer',public.fw_add_member_by_id('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-00000000000d','viewer',null));
select pg_temp.manual_assert((select payload->>'farm_scope'='all' and payload->'farm_ids'='[]'::jsonb from fw_manual_results where label='viewer'),'all-farm contract is explicit');
reset role;

-- Effective access is still the installed RLS model, not approval-time claims.
set local role authenticated;
select pg_temp.manual_actor('e1000000-0000-4000-8000-000000000009');
select pg_temp.manual_assert((select count(*)=1 from public.farms),'new scoped worker sees only the allowed farm');
select pg_temp.manual_assert((select count(*)=1 from public.tasks),'new scoped worker sees only the allowed farm task');
select pg_temp.manual_assert((select count(*)=0 from public.transactions),'new worker receives no money rows');
select pg_temp.manual_actor('e1000000-0000-4000-8000-00000000000c');
select pg_temp.manual_assert((select count(*)=1 from public.transactions),'new accountant gets permitted financial rows');
select pg_temp.manual_assert((select count(*)=0 from public.tasks),'new accountant does not gain operational task access');
select pg_temp.manual_actor('e1000000-0000-4000-8000-00000000000d');
select pg_temp.manual_denied($q$insert into public.tasks(workspace_id,farm_id,title) values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Forbidden viewer task')$q$);
reset role;
select pg_temp.manual_assert((select count(*)=4 from public.workspace_members where workspace_id='e2000000-0000-4000-8000-000000000001' and user_id in('e1000000-0000-4000-8000-000000000009','e1000000-0000-4000-8000-00000000000a','e1000000-0000-4000-8000-00000000000c','e1000000-0000-4000-8000-00000000000d')),'exactly four approved memberships');
select pg_temp.manual_assert((select count(*)=1 from public.workspace_member_farms where workspace_id='e2000000-0000-4000-8000-000000000001' and user_id='e1000000-0000-4000-8000-000000000009'),'scope inserted once');
select pg_temp.manual_assert((select email_confirmed_at is null and raw_app_meta_data='{}'::jsonb from auth.users where id='e1000000-0000-4000-8000-000000000009'),'manual approval does not confirm email or forge mailbox metadata');
select pg_temp.manual_assert(exists(select 1 from public.audit_log where workspace_id='e2000000-0000-4000-8000-000000000001' and table_name='workspace_members' and action='INSERT' and actor='e1000000-0000-4000-8000-000000000001' and new_data->>'user_id'='e1000000-0000-4000-8000-000000000009' and new_data->>'role'='worker'),'membership audit records owner and approved role');
select pg_temp.manual_assert(exists(select 1 from public.audit_log where workspace_id='e2000000-0000-4000-8000-000000000001' and table_name='workspace_member_farms' and action='INSERT' and actor='e1000000-0000-4000-8000-000000000001' and new_data->>'user_id'='e1000000-0000-4000-8000-000000000009' and farm_id='e3000000-0000-4000-8000-000000000001'),'scope audit records owner and allowed farm');
select pg_temp.manual_assert((select count(*)=2 from public.workspace_members where workspace_id in('e2000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002') and role='owner'),'original owners remain');
select pg_temp.manual_assert((select count(*)=3 from public.tasks where id::text like 'e4000000-%'),'fixture task history retained');
select pg_temp.manual_assert((select amount=17000 and currency='KES' from public.transactions where id='e5000000-0000-4000-8000-000000000001'),'cash minor units retained');
set constraints all immediate;
select 'Manual membership authorization, scope, audit and preservation assertions passed; fixtures roll back below.' as result;
rollback;
