-- EXECUTABLE STAGING REGRESSION SUITE. NOT RUN BY THE APP.
-- Run as the database owner AFTER schema.sql + 20261118_members_roles.sql on a
-- disposable Supabase/PostgreSQL 15+ staging database with the auth/storage schemas.
-- Example: psql <staging connection> -v ON_ERROR_STOP=1 -f this-file.sql
-- Fixtures use reserved test UUIDs/.invalid emails; the final ROLLBACK removes all.
-- No pgTAP or additional database extension is required beyond the base schema.
-- See README.md for the latest execution results and rehearsal limits.
-- Creating or statically inspecting this file is not RLS verification.
begin;
-- A fresh backend has no pg_temp namespace until its first temporary object.
create temporary table fw_members_test_namespace_anchor(unused boolean);
do $temp_schema_grants$ declare namespace_name text; begin
  select nspname into namespace_name from pg_namespace where oid=pg_my_temp_schema();
  if namespace_name is null then raise exception 'Test temporary namespace was not initialized';end if;
  execute format('grant usage on schema %I to authenticated,anon',namespace_name);
end $temp_schema_grants$;

create function pg_temp.fw_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.fw_expect_error(statement text,expected_state text default '42501') returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected_state then return; end if;
    raise exception 'Expected SQLSTATE %, got %: %',expected_state,sqlstate,sqlerrm;
  end;
  raise exception 'Expected denied/error SQLSTATE %, statement succeeded: %',expected_state,statement;
end $$;
create function pg_temp.fw_actor(uid uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if uid is not null and split_part(uid::text,'-',1)<>'97000000' then raise exception 'Fixture actor required';end if;
  perform set_config('request.jwt.claim.sub',coalesce(uid::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role',case when uid is null then 'anon' else 'authenticated' end,'aal','aal1','session_id',uid,
    'email',(select email from auth.users where id=uid),'amr',jsonb_build_array(jsonb_build_object('method','magiclink','timestamp',extract(epoch from statement_timestamp()-interval '30 seconds'))))::text,true);
end $$;
grant execute on function pg_temp.fw_assert(boolean,text),pg_temp.fw_expect_error(text,text),pg_temp.fw_actor(uuid) to authenticated,anon;
create temporary table fw_test_invites(label text primary key,payload jsonb);
grant select,insert,update on fw_test_invites to authenticated;

select pg_temp.fw_assert(to_regprocedure('public.fw_access_context(uuid)') is not null,'migration must be installed');
select pg_temp.fw_assert((select condeferrable and condeferred and confdeltype='n' from pg_constraint
  where conrelid='public.transactions'::regclass and conname='transactions_enterprise_id_fkey'),'enterprise FK preserves SET NULL and checks after cascades finish');
select pg_temp.fw_assert(not has_table_privilege('anon','public.workspace_invites','select'),'anon cannot enumerate invitation hashes');
select pg_temp.fw_assert(not has_table_privilege('authenticated','public.workspace_invites','select'),'authenticated cannot enumerate invitation hashes');
select pg_temp.fw_assert(not has_table_privilege('authenticated','public.workspace_members','update'),'membership writes are RPC-only');
select pg_temp.fw_assert(not has_table_privilege('authenticated','public.audit_log','insert'),'audit is not client writable');
select pg_temp.fw_assert(not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relname in
    ('profiles','workspaces','workspace_members','workspace_member_farms','workspace_invites','currencies','seed_merchants','farms','fx_rates','categories','vendors','tasks','checklists','checklist_items','checklist_runs','checklist_run_items','transactions','budgets','month_closings','recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','vendor_bills','audit_log')
    and not c.relrowsecurity),'all existing/new app tables retain RLS');

-- Trusted mailbox markers here are fixtures for the role/scope suite. The
-- Account suite separately proves that clients cannot create these markers.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data)
select id::uuid,email,confirmed,metadata::jsonb,jsonb_build_object('fieldnote_mailbox_verified_at','2000-01-01T00:00:00Z','fieldnote_mailbox_verified_email',email) from (values
 ('97000000-0000-4000-8000-000000000001','owner-a@fieldwork.invalid',now(),'{"full_name":"Test Owner A"}','{}'),
 ('97000000-0000-4000-8000-000000000002','owner-b@fieldwork.invalid',now(),'{"full_name":"Test Owner B"}','{}'),
 ('97000000-0000-4000-8000-000000000003','admin@fieldwork.invalid',now(),'{"full_name":"Test Admin"}','{}'),
 ('97000000-0000-4000-8000-000000000004','manager@fieldwork.invalid',now(),'{"full_name":"Test Manager"}','{}'),
 ('97000000-0000-4000-8000-000000000005','accountant@fieldwork.invalid',now(),'{"full_name":"Test Accountant"}','{}'),
 ('97000000-0000-4000-8000-000000000006','worker@fieldwork.invalid',now(),'{"full_name":"Test Worker"}','{}'),
 ('97000000-0000-4000-8000-000000000007','viewer@fieldwork.invalid',now(),'{"full_name":"Test Viewer"}','{}'),
 ('97000000-0000-4000-8000-000000000008','restricted@fieldwork.invalid',now(),'{"full_name":"Restricted Manager"}','{}'),
 ('97000000-0000-4000-8000-000000000009','recipient@fieldwork.invalid',now(),'{"full_name":"Invite Recipient"}','{}'),
 ('97000000-0000-4000-8000-00000000000a','outsider@fieldwork.invalid',now(),'{"full_name":"Outsider"}','{}'),
 ('97000000-0000-4000-8000-00000000000b','revoked@fieldwork.invalid',now(),'{"full_name":"Revoked Recipient"}','{}'),
 ('97000000-0000-4000-8000-00000000000c','limited-finance@fieldwork.invalid',now(),'{"full_name":"Restricted Accountant"}','{}'),
 ('97000000-0000-4000-8000-00000000000d','expired@fieldwork.invalid',now(),'{"full_name":"Expired Recipient"}','{}'),
 ('97000000-0000-4000-8000-00000000000e','unverified@fieldwork.invalid',null,'{"full_name":"Unverified Recipient"}','{}')) as fixtures(id,email,confirmed,metadata,unused);
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,statement_timestamp()-interval '2 minutes',statement_timestamp() from auth.users
 where id>='97000000-0000-4000-8000-000000000001' and id<='97000000-0000-4000-8000-00000000000e';
insert into public.workspaces(id,name,currency,created_by) values
 ('98000000-0000-4000-8000-000000000001','RLS test workspace A','KES','97000000-0000-4000-8000-000000000001'),
 ('98000000-0000-4000-8000-000000000002','RLS test workspace B','KES','97000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role,farm_scope) values
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000003','admin','all'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000004','manager','all'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000005','accountant','all'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000006','worker','all'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000007','viewer','all'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000008','manager','farms'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-00000000000c','accountant','farms');
insert into public.farms(id,workspace_id,name) values
 ('99000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','Allowed farm'),
 ('99000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001','Other farm'),
 ('99000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000002','Other tenant farm');
insert into public.workspace_member_farms values
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000008','99000000-0000-4000-8000-000000000001'),
 ('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-00000000000c','99000000-0000-4000-8000-000000000001');
insert into public.vendors(id,workspace_id,farm_id,name) values
 ('9a000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Test vendor A'),
 ('9a000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','Test vendor B');
insert into public.transactions(workspace_id,farm_id,kind,amount,currency,description) values
 ('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','expense',10000,'KES','Farm A1'),
 ('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','expense',20000,'KES','Farm A2'),
 ('98000000-0000-4000-8000-000000000001',null,'expense',30000,'KES','Shared A'),
 ('98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','income',40000,'KES','Tenant B');
insert into public.tasks(workspace_id,farm_id,title) values
 ('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Allowed task'),
 ('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Other task'),
 ('98000000-0000-4000-8000-000000000001',null,'Shared task'),
 ('98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','Other tenant task');
insert into public.projects(id,workspace_id,farm_id,name,cost,budget) values
 ('9c000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Project A',125000,200000),
 ('9c000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','Project B',999000,1000000),
 ('9c000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Other farm project',50000,80000);
insert into public.workers(id,workspace_id,farm_id,full_name,role,pay_amount,phone) values
 ('9b000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Directory A','field_hand',250000,'private-test-contact'),
 ('9b000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','Directory B','field_hand',900000,'other-private-contact'),
 ('9b000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Other farm worker','field_hand',150000,'other-farm-private-contact');
insert into public.recurring_payments(id,workspace_id,farm_id,name,amount,day_of_month) values
 ('9d000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Other farm recurring',10000,1);
insert into public.enterprises(id,workspace_id,farm_id,name,type) values
 ('9e000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Allowed enterprise','crop'),
 ('9e000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Other farm enterprise','crop'),
 ('9e000000-0000-4000-8000-000000000003','98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000003','Other tenant enterprise','crop');
update public.transactions set receipt_path='98000000-0000-4000-8000-000000000001/farm-one-receipt.jpg' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1';
update public.transactions set receipt_path='98000000-0000-4000-8000-000000000001/farm-two-receipt.jpg' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A2';

-- Manager: tenant boundaries, relationship integrity, no member-admin escalation.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000004'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=2 from public.farms),'manager sees only own tenant farms');
select pg_temp.fw_assert((select count(*)=3 from public.transactions),'manager sees own tenant finances including shared rows');
select pg_temp.fw_assert((select count(*)=0 from public.farms where workspace_id='98000000-0000-4000-8000-000000000002'),'explicit other tenant query is empty');
select pg_temp.fw_expect_error($q$insert into public.transactions(workspace_id,farm_id,kind,amount,currency) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000003','expense',100,'KES')$q$,'23503');
select pg_temp.fw_expect_error($q$select public.fw_list_members('98000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fw_expect_error($q$update public.workspace_members set role='owner' where workspace_id='98000000-0000-4000-8000-000000000001' and user_id='97000000-0000-4000-8000-000000000004'$q$);
select pg_temp.fw_expect_error($q$select public.fw_access_context('98000000-0000-4000-8000-000000000002')$q$);
select pg_temp.fw_expect_error($q$insert into public.audit_log(workspace_id,table_name,action) values('98000000-0000-4000-8000-000000000001','transactions','INSERT')$q$);
reset role;

-- Restricted manager: allow listed farm, deny other/shared farm rows and scope escalation.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000008'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=1 from public.farms),'farm scope filters directory');
select pg_temp.fw_assert((select count(*)=1 from public.tasks),'farm scope filters tasks and shared rows');
select pg_temp.fw_assert((select count(*)=1 from public.transactions),'farm scope filters money and shared rows');
select pg_temp.fw_assert((public.fw_access_context('98000000-0000-4000-8000-000000000001')->>'farm_scope')='farms','access context reports scope');
select pg_temp.fw_expect_error($q$insert into public.tasks(workspace_id,farm_id,title) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000002','Forbidden task')$q$);
select pg_temp.fw_expect_error($q$insert into public.categories(workspace_id,name,kind) values('98000000-0000-4000-8000-000000000001','Workspace-wide edit','expense')$q$);
reset role;

-- Worker/viewer: operational access, no finance or underlying pay/cost data.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000006'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=0 from public.transactions),'worker cannot read transactions');
select pg_temp.fw_assert((select count(*)=0 from public.workers),'worker cannot read pay/contact rows');
select pg_temp.fw_assert((select count(*)=0 from public.projects),'worker cannot read cost/budget rows');
select pg_temp.fw_assert((select count(*)=0 from public.audit_log),'worker cannot read financial audit history');
select pg_temp.fw_assert((select count(*)=2 from public.fw_operational_workers('98000000-0000-4000-8000-000000000001')),'redacted directory stays tenant scoped');
select pg_temp.fw_assert(not exists(select 1 from public.fw_operational_workers('98000000-0000-4000-8000-000000000001') r where to_jsonb(r) ?| array['pay_amount','currency','phone']),'directory RPC has no sensitive columns');
select pg_temp.fw_assert(not exists(select 1 from public.fw_operational_projects('98000000-0000-4000-8000-000000000001') r where to_jsonb(r) ?| array['cost','budget','currency']),'project RPC has no financial columns');
select pg_temp.fw_assert((select count(*)=0 from public.fw_operational_workers('98000000-0000-4000-8000-000000000002')),'redacted RPC cannot enumerate another tenant');
insert into public.tasks(workspace_id,farm_id,title) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','Worker created');
select pg_temp.fw_expect_error($q$insert into public.transactions(workspace_id,farm_id,kind,amount,currency) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','expense',100,'KES')$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000007'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=4 from public.tasks),'viewer reads operational tasks');
select pg_temp.fw_expect_error($q$insert into public.tasks(workspace_id,title) values('98000000-0000-4000-8000-000000000001','Viewer write denied')$q$);
select pg_temp.fw_assert((select count(*)=0 from public.vendor_bills),'viewer has no obligations register');
reset role;

-- Accountant: financial operations, no unrelated operations edits; bills never post cash.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000005'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=3 from public.transactions),'accountant reads financial records');
select pg_temp.fw_assert((select count(*)=0 from public.tasks),'accountant does not get operational task access');
insert into public.vendor_bills(workspace_id,farm_id,vendor_id,amount,paid_amount,currency)
 values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',10000,4000,'KES');
select pg_temp.fw_assert((select amount-paid_amount=6000 from public.vendor_bills),'bill outstanding stays in minor units');
select pg_temp.fw_assert((select count(*)=3 from public.transactions),'bill creates no cash transaction');
select pg_temp.fw_expect_error($q$insert into public.vendor_bills(workspace_id,farm_id,vendor_id,amount,paid_amount) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000001',100,200)$q$,'23514');
select pg_temp.fw_expect_error($q$insert into public.vendor_bills(workspace_id,farm_id,vendor_id,amount) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','9a000000-0000-4000-8000-000000000002',100)$q$,'23503');
select pg_temp.fw_expect_error($q$select public.fw_list_invites('98000000-0000-4000-8000-000000000001')$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000c'); set local role authenticated;
select pg_temp.fw_assert((select count(*)=1 from public.transactions),'restricted accountant sees only assigned farm');
select pg_temp.fw_assert((select count(*)=1 from public.vendor_bills),'restricted accountant sees assigned-farm bills');
-- A known object name must not become accessible by attaching it to an allowed row.
select pg_temp.fw_assert(not fw_private.receipt_access('98000000-0000-4000-8000-000000000001/farm-one-receipt.jpg',false),'scoped finance receives no storage objects until provenance exists');
select pg_temp.fw_assert(not fw_private.receipt_access('98000000-0000-4000-8000-000000000001/farm-two-receipt.jpg',true),'known other-farm receipt cannot be mutated');
select pg_temp.fw_expect_error($q$update public.transactions set receipt_path='98000000-0000-4000-8000-000000000001/farm-two-receipt.jpg' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1'$q$);
-- Source/enterprise IDs cannot reserve another farm's unique auto-post key or
-- misattribute its enterprise by placing them on an allowed farm transaction.
select pg_temp.fw_expect_error($q$insert into public.transactions(workspace_id,farm_id,kind,amount,currency,source_type,source_id,source_period) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','expense',100,'KES','worker_pay','9b000000-0000-4000-8000-000000000003','2026-11-01')$q$,'23503');
select pg_temp.fw_expect_error($q$insert into public.transactions(workspace_id,farm_id,kind,amount,currency,source_type,source_id,source_period) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','expense',100,'KES','recurring','9d000000-0000-4000-8000-000000000001','2026-11-01')$q$,'23503');
select pg_temp.fw_expect_error($q$insert into public.transactions(workspace_id,farm_id,kind,amount,currency,source_type,source_id,source_period) values('98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','expense',100,'KES','project','9c000000-0000-4000-8000-000000000003','2026-11-01')$q$,'23503');
select pg_temp.fw_expect_error($q$update public.transactions set enterprise_id='9e000000-0000-4000-8000-000000000002' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1'$q$,'23503');
update public.transactions set enterprise_id='9e000000-0000-4000-8000-000000000001' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1';
select pg_temp.fw_expect_error($q$update public.transactions set farm_id='99000000-0000-4000-8000-000000000002' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1'$q$,'23503');
reset role;

-- Admin cannot escalate into owner/admin access or alter owner privileges.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000003'); set local role authenticated;
select pg_temp.fw_expect_error($q$select public.fw_change_member('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000006','owner',null)$q$);
select pg_temp.fw_expect_error($q$select public.fw_remove_member('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001')$q$);
select pg_temp.fw_expect_error($q$select public.fw_create_invite('98000000-0000-4000-8000-000000000001','admin-invite@fieldwork.invalid','admin',null)$q$);
select pg_temp.fw_expect_error($q$select public.fw_change_member('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000006','worker',array['99000000-0000-4000-8000-000000000003']::uuid[])$q$,'22023');
reset role;

-- Owner: last-owner protection, hashed one-time invitations, no hash enumeration.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000001'); set local role authenticated;
select pg_temp.fw_expect_error($q$update public.transactions set farm_id='99000000-0000-4000-8000-000000000002' where workspace_id='98000000-0000-4000-8000-000000000001' and description='Farm A1'$q$,'23503');
select pg_temp.fw_assert(fw_private.receipt_access('98000000-0000-4000-8000-000000000001/farm-one-receipt.jpg',false),'all-farm financial members retain receipt access');
select pg_temp.fw_expect_error($q$select public.fw_remove_member('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001')$q$,'23514');
select pg_temp.fw_expect_error($q$select public.fw_change_member('98000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','viewer',null)$q$,'23514');
insert into fw_test_invites values
 ('valid',public.fw_create_invite('98000000-0000-4000-8000-000000000001','recipient@fieldwork.invalid','viewer',array['99000000-0000-4000-8000-000000000001']::uuid[])),
 ('revoked',public.fw_create_invite('98000000-0000-4000-8000-000000000001','revoked@fieldwork.invalid','worker',null)),
 ('expired',public.fw_create_invite('98000000-0000-4000-8000-000000000001','expired@fieldwork.invalid','worker',null)),
 ('unverified',public.fw_create_invite('98000000-0000-4000-8000-000000000001','unverified@fieldwork.invalid','viewer',null));
select public.fw_revoke_invite('98000000-0000-4000-8000-000000000001',(select (payload->>'id')::uuid from fw_test_invites where label='revoked'));
select pg_temp.fw_assert(not exists(select 1 from public.fw_list_invites('98000000-0000-4000-8000-000000000001') i where to_jsonb(i) ?| array['token','token_hash']),'invitation list never returns tokens/hashes');
select pg_temp.fw_expect_error('select token_hash from public.workspace_invites');
reset role;
update public.workspace_invites set expires_at=now()-interval '1 minute' where id=(select (payload->>'id')::uuid from fw_test_invites where label='expired');
select pg_temp.fw_assert((select octet_length(token_hash)=32 from public.workspace_invites where id=(select (payload->>'id')::uuid from fw_test_invites where label='valid')),'stored invitation token is SHA-256, not plaintext');

select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000a'); set local role authenticated;
select pg_temp.fw_expect_error($q$select public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='valid'))$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000b'); set local role authenticated;
select pg_temp.fw_expect_error($q$select public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='revoked'))$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000d'); set local role authenticated;
select pg_temp.fw_expect_error($q$select public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='expired'))$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000e'); set local role authenticated;
select pg_temp.fw_expect_error($q$select public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='unverified'))$q$);
reset role;
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000009'); set local role authenticated;
select pg_temp.fw_assert(public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='valid'))='98000000-0000-4000-8000-000000000001'::uuid,'correct verified email can accept');
select pg_temp.fw_assert(public.fw_accept_invite((select payload->>'token' from fw_test_invites where label='valid'))='98000000-0000-4000-8000-000000000001'::uuid,'same accepted recipient can safely retry without extra membership');
select pg_temp.fw_assert((public.fw_access_context('98000000-0000-4000-8000-000000000001')->>'role')='viewer','acceptance uses server invitation role');
select pg_temp.fw_assert((select count(*)=1 from public.farms),'accepted invitation retains its farm restriction');
select pg_temp.fw_assert((select count(*)=0 from public.transactions),'accepted viewer has no financial access');
reset role;

-- Onboarding still inserts/returns a workspace and atomically creates its owner.
select pg_temp.fw_actor('97000000-0000-4000-8000-00000000000a'); set local role authenticated;
with created as (insert into public.workspaces(id,name,currency,created_by) values('98000000-0000-4000-8000-000000000003','New workspace bootstrap','KES','97000000-0000-4000-8000-00000000000a') returning id)
select pg_temp.fw_assert((select count(*)=1 from created),'workspace INSERT RETURNING remains available for onboarding');
select pg_temp.fw_assert(public.fw_role('98000000-0000-4000-8000-000000000003')='owner','creator becomes owner');
reset role;

-- Existing farm deletion behavior must retain historical cash rows even when
-- their enterprise/source is removed by a parent cascade.
select pg_temp.fw_actor('97000000-0000-4000-8000-000000000001'); set local role authenticated;
insert into public.farms(id,workspace_id,name) values('99000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000001','Deletion preservation test');
insert into public.projects(id,workspace_id,farm_id,name) values('9c000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004','Historical source');
insert into public.enterprises(id,workspace_id,farm_id,name,type) values('9e000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004','Historical enterprise','crop');
insert into public.transactions(id,workspace_id,farm_id,enterprise_id,kind,amount,currency,source_type,source_id,source_period)
 values('9f000000-0000-4000-8000-000000000004','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000004','expense',12300,'KES','project','9c000000-0000-4000-8000-000000000004','2026-11-01');
delete from public.farms where id='99000000-0000-4000-8000-000000000004';
select pg_temp.fw_assert((select farm_id is null and enterprise_id is null and amount=12300 from public.transactions where id='9f000000-0000-4000-8000-000000000004'),'farm deletion preserves original cash history and minor amount');
reset role;

-- Anonymous access remains denied, including checked invitation RPCs.
select pg_temp.fw_actor(null); set local role anon;
select pg_temp.fw_expect_error('select * from public.transactions');
select pg_temp.fw_expect_error('select * from public.workspace_invites');
select pg_temp.fw_expect_error($q$select public.fw_accept_invite(repeat('a',64))$q$);
reset role;

-- A rollback alone would never validate deferred checks. Force every queued FK
-- before a PASS result or fixture rollback can be reported.
set constraints all immediate;
select 'All fieldwork role/tenant/invitation assertions passed; fixtures rolled back below.' as result;
rollback;
