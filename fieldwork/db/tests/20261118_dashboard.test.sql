-- ROLLBACK-ONLY STAGING TESTS. NOT EXECUTED BY THE APP.
-- Run as database owner on disposable Supabase/PostgreSQL 15+ AFTER schema.sql,
-- 20261118_members_roles.sql and 20261118_dashboard.sql. No production execution.
-- No pgTAP/dependencies. Reserved UUIDs/emails; ROLLBACK removes all fixtures.
-- See README.md for execution results; static review is not RLS proof.
begin;
-- Initialize the backend's temporary namespace before creating its helpers.
create temporary table fw_dashboard_test_namespace_anchor(unused boolean);
do $temp_schema_grants$ declare namespace_name text; begin
  select nspname into namespace_name from pg_namespace where oid=pg_my_temp_schema();
  if namespace_name is null then raise exception 'Test temporary namespace was not initialized';end if;
  execute format('grant usage on schema %I to authenticated,anon',namespace_name);
end $temp_schema_grants$;
create function pg_temp.dash_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.dash_error(statement text,expected text default '42501') returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate=expected then return; end if;
    raise exception 'Expected %, got %: %',expected,sqlstate,sqlerrm;
  end;
  raise exception 'Expected error %, succeeded: %',expected,statement;
end $$;
create function pg_temp.dash_actor(uid uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if uid is not null and split_part(uid::text,'-',1)<>'d1000000' then raise exception 'Fixture actor required';end if;
  perform set_config('request.jwt.claim.sub',coalesce(uid::text,''),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role',case when uid is null then 'anon' else 'authenticated' end,'aal','aal1','session_id',uid,'email',(select email from auth.users where id=uid))::text,true);
end $$;
grant execute on function pg_temp.dash_assert(boolean,text),pg_temp.dash_error(text,text),pg_temp.dash_actor(uuid) to authenticated,anon;
create temporary table dashboard_outputs(label text primary key,data jsonb);
grant select,insert,update on dashboard_outputs to authenticated;

select pg_temp.dash_assert(to_regprocedure('public.fw_dashboard(uuid,date,date,uuid)') is not null,'dashboard installed');
select pg_temp.dash_assert((select not prosecdef from pg_proc where oid='public.fw_dashboard(uuid,date,date,uuid)'::regprocedure),'dashboard must run as caller, not owner');
select pg_temp.dash_assert(not has_function_privilege('anon','public.fw_dashboard(uuid,date,date,uuid)','execute'),'anonymous execution denied');
select pg_temp.dash_assert((select count(*)=3 and bool_and(not prosecdef) from pg_proc where oid in
  ('public.fw_transaction_totals(uuid,date,date,uuid,jsonb)'::regprocedure,'public.fw_finance_month(uuid,date,uuid)'::regprocedure,'public.fw_close_month(uuid,date,uuid)'::regprocedure)),'all finance RPCs run as caller');
select pg_temp.dash_assert(not has_function_privilege('anon','public.fw_close_month(uuid,date,uuid)','execute'),'anonymous cannot close a month');
select pg_temp.dash_assert((fw_private.dashboard_kpi(10,0,'count',true)->>'change_pct') is null,'previous zero has no percentage');
select pg_temp.dash_assert(fw_private.dashboard_kpi(10,0,'count',true)->>'trend'='new','zero baseline is new');
select pg_temp.dash_assert(fw_private.dashboard_kpi(0,0,'currency',true)->>'trend'='flat','zero-to-zero is flat');
select pg_temp.dash_assert((fw_private.dashboard_kpi(-50,-100,'currency',true)->>'change_pct')::numeric=50,'negative baseline percentage uses absolute denominator');
select pg_temp.dash_assert((fw_private.dashboard_kpi(null,null,'currency',true)->>'value') is null,'unrecorded value remains null');
select pg_temp.dash_assert(fw_private.dashboard_kpi(500,300,'currency',false)->'value'='null'::jsonb,'unavailable KPI redacts value');

insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','dashboard-owner@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000002','dashboard-other@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000003','dashboard-scoped@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000004','dashboard-accountant@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000005','dashboard-worker@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000006','dashboard-viewer@fieldwork.invalid',now(),'{}','{}'),
 ('d1000000-0000-4000-8000-000000000007','dashboard-outsider@fieldwork.invalid',now(),'{}','{}');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select id,id,statement_timestamp()-interval '2 minutes',statement_timestamp() from auth.users
 where id>='d1000000-0000-4000-8000-000000000001' and id<='d1000000-0000-4000-8000-000000000007';
insert into public.workspaces(id,name,currency,created_by) values
 ('d2000000-0000-4000-8000-000000000001','Dashboard sample A','KES','d1000000-0000-4000-8000-000000000001'),
 ('d2000000-0000-4000-8000-000000000002','Dashboard sample B','KES','d1000000-0000-4000-8000-000000000002');
insert into public.workspace_members(workspace_id,user_id,role,farm_scope) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','manager','farms'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000004','accountant','all'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000005','worker','all'),
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000006','viewer','all');
insert into public.farms(id,workspace_id,name) values
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Sample farm A'),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','Hidden farm B'),
 ('d3000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000002','Foreign farm');
insert into public.workspace_member_farms values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000001');
insert into public.categories(id,workspace_id,name,kind) values
 ('d4000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Feed','expense'),
 ('d4000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','Sales','income'),
 ('d4000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001','Current attention expense','expense');
insert into public.vendors(id,workspace_id,farm_id,name) values
 ('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Sample vendor');
insert into public.enterprises(id,workspace_id,farm_id,name,type) values
 ('d6000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Linked dairy','livestock'),
 ('d6000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Unlinked crop','crop');
insert into public.workers(id,workspace_id,farm_id,full_name,role,pay_amount,currency,pay_frequency) values
 ('d7000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Sample worker','field_hand',3000,'KES','monthly');
insert into public.recurring_payments(id,workspace_id,farm_id,name,amount,day_of_month) values
 ('d8000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Sample recurring',900,1);
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,fx_rate,category_id,vendor_id,enterprise_id) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-02','income',100000,'KES',1,'d4000000-0000-4000-8000-000000000002',null,'d6000000-0000-4000-8000-000000000001'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-03','expense',10000,'KES',1,'d4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-04','expense',100,'USD',125,'d4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','d6000000-0000-4000-8000-000000000001'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','2026-11-05','expense',40000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000001',null,'2026-11-05','income',5000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-10-01','income',10000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-10-05','income',50000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-10-06','expense',10000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','2026-12-01','income',900000,'KES',1,null,null,null),
 ('d2000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003','2026-11-05','income',9999999,'KES',1,null,null,null);
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,source_type,source_id) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-06','expense',3000,'KES','worker_pay','d7000000-0000-4000-8000-000000000001');
insert into public.budgets(workspace_id,farm_id,category_id,month,amount) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001','2026-11-01',20000),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000002','2026-11-01',100000);
insert into public.month_closings(workspace_id,farm_id,month,closing_cash) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-10-01',5000),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-01',7000),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','2026-11-01',11000),
 ('d2000000-0000-4000-8000-000000000001',null,'2026-11-01',3000);
insert into public.vendor_bills(workspace_id,farm_id,vendor_id,issued_on,due_on,amount,paid_amount,currency) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',(now() at time zone 'Africa/Nairobi')::date-10,(now() at time zone 'Africa/Nairobi')::date-1,10000,4000,'USD');
insert into public.funding_opportunities(workspace_id,name,deadline,status) values
 ('d2000000-0000-4000-8000-000000000001','Upcoming grant',(now() at time zone 'Africa/Nairobi')::date+3,'eligible'),
 ('d2000000-0000-4000-8000-000000000001','Already awarded',(now() at time zone 'Africa/Nairobi')::date+2,'awarded');
insert into public.tasks(workspace_id,farm_id,title,cadence,status,done_at,due_date) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Daily today','daily','done',now(),null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Daily stale','daily','done',now()-interval '1 day',(now() at time zone 'Africa/Nairobi')::date-1),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Monthly current','monthly','done',date_trunc('month',now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi',null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Monthly stale','monthly','done',(date_trunc('month',now() at time zone 'Africa/Nairobi')-interval '1 month') at time zone 'Africa/Nairobi',(now() at time zone 'Africa/Nairobi')::date-30),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Once done','once','done',null,null),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Once open','once','open',null,(now() at time zone 'Africa/Nairobi')::date-1),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','Hidden farm task','once','open',null,null),
 ('d2000000-0000-4000-8000-000000000001',null,'Shared task','once','open',null,null);

-- Owner: exact half-open dates, base minor-unit conversion, complete JSON contract.
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000001'); set local role authenticated;
insert into dashboard_outputs values('owner',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert(data->>'version'='20261118-dashboard-v1','versioned contract') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{kpis,income,value}')::numeric=105000,'income excludes end-date and other tenant') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{kpis,expenses,value}')::numeric=65500,'expenses use amount_base: 100 USD minor *125, not raw currency sum') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{kpis,net,value}')::numeric=39500,'net computed in Postgres') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(data#>>'{scope,previous_from}'='2026-10-01' and (data#>>'{kpis,income,previous}')::numeric=60000 and (data#>>'{kpis,income,change_pct}')::numeric=75,'whole November compares with whole October, including October 1 income') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((select (v->>'income')::numeric=(data#>>'{kpis,income,previous}')::numeric from jsonb_array_elements(data#>'{series,monthly}') v where v->>'month'='2026-10-01'),'previous month KPI agrees with its full monthly trend point') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{kpis,recorded_cash,value}')::numeric=21000 and (data#>>'{kpis,recorded_cash,previous}')::numeric=5000,'cash matches exact-month visible sum, including shared rows') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{cash_coverage,recorded_rows}')::int=3 and (data#>>'{cash_coverage,shared_rows}')::int=1,'cash coverage discloses shared/per-farm records') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(jsonb_array_length(data#>'{series,monthly}')=6 and (data#>>'{series,monthly,5,net}')::numeric=39500,'six monthly SQL trend points with zero fill') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{payroll,amount}')::numeric=3000,'payroll is posted cash, not guessed obligations') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((select (v->>'amount')::numeric=22500 from jsonb_array_elements(data->'top_vendors') v where v->>'id'='d5000000-0000-4000-8000-000000000001'),'vendor spend aggregates base amounts') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{budgets,expenses,0,actual}')::numeric=22500 and (data#>>'{budgets,income,0,actual}')::numeric=100000,'expense budgets and income targets remain separate') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((select (v->>'margin')::numeric=87500 from jsonb_array_elements(data->'enterprise_profitability') v where v->>'name'='Linked dairy'),'enterprise margin uses only explicit links') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((select v->'margin'='null'::jsonb from jsonb_array_elements(data->'enterprise_profitability') v where v->>'name'='Unlinked crop'),'unlinked enterprise has no invented zero profit') from dashboard_outputs where label='owner';
select pg_temp.dash_assert((data#>>'{tasks,total}')::int=8 and (data#>>'{tasks,completed}')::int=3 and (data#>>'{tasks,overdue}')::int=3 and (data#>>'{tasks,pct}')::numeric=37.5,'current task donut respects daily/monthly cadence and legacy once completion') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(jsonb_array_length(data#>'{series,task_completion}')=30,'calendar has all selected days') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='bill_due' and (v->>'amount')::numeric=6000 and v->>'currency'='USD' and v#>>'{action,filters,vendor_id}'='d5000000-0000-4000-8000-000000000001'),'bill balance remains original currency with drill filters') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='worker_payment_unrecorded') and exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='recurring_payment_unrecorded'),'missing postings shown with honest reminder labels') from dashboard_outputs where label='owner';
select pg_temp.dash_assert(not exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'title' like '%Already awarded%'),'awarded grant not presented as pending deadline') from dashboard_outputs where label='owner';
insert into dashboard_outputs values('empty',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-09-01','2026-10-01'));
select pg_temp.dash_assert(data#>'{kpis,recorded_cash,value}'='null'::jsonb and (data#>>'{kpis,income,value}')::numeric=0,'missing cash is null; empty transaction income is zero') from dashboard_outputs where label='empty';
insert into dashboard_outputs values('farm',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','d3000000-0000-4000-8000-000000000001'));
select pg_temp.dash_assert((data#>>'{kpis,expenses,value}')::numeric=25500 and (data#>>'{kpis,income,value}')::numeric=100000 and (data#>>'{kpis,recorded_cash,value}')::numeric=7000,'selected farm excludes other/shared rows consistently') from dashboard_outputs where label='farm';
select pg_temp.dash_assert(not exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='grant_deadline'),'farm selection does not allocate workspace grants to an invented farm') from dashboard_outputs where label='farm';
insert into dashboard_outputs values('custom',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-02','2026-12-01'));
select pg_temp.dash_assert(data#>>'{scope,previous_from}'='2026-10-04' and (data#>>'{kpis,income,previous}')::numeric=50000,'custom 29-day interval keeps equal-day comparison and excludes October 1') from dashboard_outputs where label='custom';
insert into dashboard_outputs values('leap',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2024-02-01','2024-03-01'));
select pg_temp.dash_assert(data#>>'{scope,previous_from}'='2024-01-01','leap February compares with January, not a 29-day fragment') from dashboard_outputs where label='leap';
insert into dashboard_outputs values('quarter',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-09-01','2026-12-01'));
select pg_temp.dash_assert(data#>>'{scope,previous_from}'='2026-06-01','three-month window compares with the preceding three calendar months') from dashboard_outputs where label='quarter';
select pg_temp.dash_error($q$select public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-11-01')$q$,'22023');
select pg_temp.dash_error($q$select public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','d3000000-0000-4000-8000-000000000003')$q$);
reset role;

-- Farm-restricted member sees neither shared data nor other-farm aggregates.
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000003'); set local role authenticated;
insert into dashboard_outputs values('restricted',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert((data#>>'{kpis,expenses,value}')::numeric=25500 and (data#>>'{kpis,income,value}')::numeric=100000 and jsonb_array_length(data->'farm_comparison')=1,'RLS filters before aggregates') from dashboard_outputs where label='restricted';
select pg_temp.dash_assert(position('Hidden farm' in data::text)=0 and position('Shared / unassigned' in data::text)=0,'no other/shared names via attention or chart') from dashboard_outputs where label='restricted';
select pg_temp.dash_error($q$select public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','d3000000-0000-4000-8000-000000000002')$q$);
reset role;

-- Strong branch tests: revoke SELECT temporarily. Forbidden table queries would
-- raise permission denied even if RLS would otherwise hide every row.
revoke select on public.tasks from authenticated;
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000004'); set local role authenticated;
insert into dashboard_outputs values('accountant',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert(data#>'{kpis,task_completion,available}'='false'::jsonb and data->'tasks'='null'::jsonb and data#>'{series,task_completion}'='[]'::jsonb,'accountant never queries tasks or fabricates operational zero') from dashboard_outputs where label='accountant';
reset role;
grant select on public.tasks to authenticated;
revoke select on public.transactions,public.budgets,public.month_closings,public.vendor_bills,public.workers,public.recurring_payments,public.funding_opportunities from authenticated;
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000005'); set local role authenticated;
insert into dashboard_outputs values('worker',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert(data#>'{kpis,income,available}'='false'::jsonb and data#>'{kpis,income,value}'='null'::jsonb and data->'payroll'='null'::jsonb and data->'top_vendors'='[]'::jsonb,'worker receives no financial query or figures') from dashboard_outputs where label='worker';
select pg_temp.dash_error($q$select public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')$q$);
select pg_temp.dash_error($q$select public.fw_finance_month('d2000000-0000-4000-8000-000000000001','2026-11-01')$q$);
select pg_temp.dash_error($q$select public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000001')$q$);
select pg_temp.dash_assert(not exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'<>'overdue_task'),'worker attention is operational only') from dashboard_outputs where label='worker';
reset role;
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000006'); set local role authenticated;
insert into dashboard_outputs values('viewer',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert(data#>'{kpis,task_completion,available}'='true'::jsonb and data->'expense_categories'='[]'::jsonb,'viewer gets operational charts only') from dashboard_outputs where label='viewer';
reset role;
grant select on public.transactions,public.budgets,public.month_closings,public.vendor_bills,public.workers,public.recurring_payments,public.funding_opportunities to authenticated;

select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000007'); set local role authenticated;
select pg_temp.dash_error($q$select public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')$q$);
reset role;
select pg_temp.dash_actor(null); set local role anon;
select pg_temp.dash_error($q$select public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')$q$);
reset role;

-- Current-month expense threshold (90%), and posting removes reminders without
-- changing any bill's separately recorded outstanding balance.
select pg_temp.dash_actor(null);
insert into public.budgets(workspace_id,farm_id,category_id,month,amount) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000003',date_trunc('month',now() at time zone 'Africa/Nairobi')::date,10000);
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,category_id) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(now() at time zone 'Africa/Nairobi')::date,'expense',9000,'KES','d4000000-0000-4000-8000-000000000003');
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,source_type,source_id,source_period) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(now() at time zone 'Africa/Nairobi')::date,'expense',3000,'KES','worker_pay','d7000000-0000-4000-8000-000000000001',date_trunc('month',now() at time zone 'Africa/Nairobi')::date),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(now() at time zone 'Africa/Nairobi')::date,'expense',900,'KES','recurring','d8000000-0000-4000-8000-000000000001',date_trunc('month',now() at time zone 'Africa/Nairobi')::date);
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000001'); set local role authenticated;
insert into dashboard_outputs values('posted',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
select pg_temp.dash_assert(not exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='worker_payment_unrecorded' or
  (v->>'kind'='recurring_payment_unrecorded' and (v#>>'{action,filters,month}')::date=date_trunc('month',now() at time zone 'Africa/Nairobi')::date)),
  'recorded current source periods suppress this month posting reminders; next month may be upcoming') from dashboard_outputs where label='posted';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'attention') v where v->>'kind'='expense_budget_near' and v->>'title'='Budget: Current attention expense'),'90 percent current expense budget triggers attention') from dashboard_outputs where label='posted';
select pg_temp.dash_assert((select amount-paid_amount=6000 from public.vendor_bills where workspace_id='d2000000-0000-4000-8000-000000000001'),'posting transactions never pays a bill automatically');
reset role;

-- Unplanned categories, uncategorised money, and legacy category-kind mismatch
-- remain represented. No rows are hidden to make a budget presentation balance.
select pg_temp.dash_actor(null);
insert into public.categories(id,workspace_id,name,kind) values('d4000000-0000-4000-8000-000000000004','d2000000-0000-4000-8000-000000000001','Unplanned sale','income');
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,category_id,description) values
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-07','income',5,'KES','d4000000-0000-4000-8000-000000000004','Small unplanned sale'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-07','expense',7,'KES',null,'Uncategorised item'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-07','expense',11,'KES','d4000000-0000-4000-8000-000000000002','Category type differs'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','2026-11-07','expense',13,'KES',null,'Literal 100%_ marker');
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000001');set local role authenticated;
insert into dashboard_outputs values
 ('finance_month',public.fw_finance_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000001')),
 ('finance_dashboard',public.fw_dashboard('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','d3000000-0000-4000-8000-000000000001')),
 ('finance_totals',public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01','d3000000-0000-4000-8000-000000000001'));
select pg_temp.dash_assert(m.data#>'{totals,income}'=d.data#>'{kpis,income,value}' and m.data#>'{totals,expenses}'=d.data#>'{kpis,expenses,value}'
  and t.data->'net'=m.data#>'{totals,net}','finance RPCs and dashboard use identical full-scope base totals') from dashboard_outputs m,dashboard_outputs d,dashboard_outputs t where m.label='finance_month' and d.label='finance_dashboard' and t.label='finance_totals';
select pg_temp.dash_assert((data#>>'{totals,opening}')::numeric=5000 and (data#>>'{totals,opening_recorded}')::boolean,'opening is exact previous saved month') from dashboard_outputs where label='finance_month';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'categories') c where c->>'name'='Unplanned sale' and c->>'kind'='income' and (c->>'actual')::numeric=5 and (c->>'budget')::numeric=0),'unplanned income category remains visible') from dashboard_outputs where label='finance_month';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'categories') c where c->'id'='null'::jsonb and c->>'kind'='expense' and (c->>'actual')::numeric>=20 and not(c->>'can_budget')::boolean),'uncategorised spending remains visible and cannot have a category budget') from dashboard_outputs where label='finance_month';
select pg_temp.dash_assert(exists(select 1 from jsonb_array_elements(data->'categories') c where c->>'id'='d4000000-0000-4000-8000-000000000002' and c->>'kind'='expense' and (c->>'actual')::numeric=11 and not(c->>'can_budget')::boolean),'legacy category-kind mismatch is retained read-only') from dashboard_outputs where label='finance_month';
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"q":"100%_"}')->>'expenses')::numeric=13,'search treats percent/underscore literally');
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"q":"SALES (income)"}')->>'expenses')::numeric=11,'search includes exact displayed category label case-insensitively');
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"q":"Linked dairy"}')->>'net')::numeric=87500,'search includes accessible enterprise names');
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"category_id":"d4000000-0000-4000-8000-000000000004","kind":"income"}')->>'income')::numeric=5,'typed filters compose with complete totals');
select pg_temp.dash_error($q$select public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"id":"bad"}')$q$,'22023');
select pg_temp.dash_error($q$select public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01',null,'{"unsafe":true}')$q$,'22023');
select pg_temp.dash_error($q$select public.fw_finance_month('d2000000-0000-4000-8000-000000000001','2026-11-02')$q$,'22023');
select pg_temp.dash_error($q$select public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01',null)$q$,'22023');
select pg_temp.dash_error($q$select public.fw_finance_month('d2000000-0000-4000-8000-000000000002','2026-11-01')$q$);
insert into dashboard_outputs values('no_opening',public.fw_finance_month('d2000000-0000-4000-8000-000000000001','2026-09-01','d3000000-0000-4000-8000-000000000001'));
select pg_temp.dash_assert((data#>>'{totals,opening}')::numeric=0 and data#>'{totals,opening_recorded}'='false'::jsonb and data#>'{totals,saved_closing}'='null'::jsonb,'legacy zero opening is explicitly distinguished from a saved balance') from dashboard_outputs where label='no_opening';
insert into dashboard_outputs values('closed',public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000001'));
select pg_temp.dash_assert(data#>'{totals,saved_closing}'=data#>'{totals,calculated_closing}','server close recomputes and saves the refreshed database balance') from dashboard_outputs where label='closed';
select public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000001');
select pg_temp.dash_assert((select count(*)=1 from public.month_closings where workspace_id='d2000000-0000-4000-8000-000000000001' and farm_id='d3000000-0000-4000-8000-000000000001' and month='2026-11-01'),'retrying close updates one existing snapshot');
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000003');
select pg_temp.dash_error($q$select public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000002')$q$);
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')->>'income')::numeric=100005,'restricted aggregate excludes other/shared farms');
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000001');
insert into dashboard_outputs values('before_cap',public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01'));
reset role;select pg_temp.dash_actor(null);
insert into public.transactions(workspace_id,farm_id,txn_date,kind,amount,currency,description)
 select 'd2000000-0000-4000-8000-000000000001'::uuid,'d3000000-0000-4000-8000-000000000001'::uuid,'2026-11-08'::date,'expense',1,'KES','Cap fixture '||n from generate_series(1,1005) n;
select pg_temp.dash_actor('d1000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.dash_assert((public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')->>'expenses')::numeric=(data->>'expenses')::numeric+1005
 and (public.fw_transaction_totals('d2000000-0000-4000-8000-000000000001','2026-11-01','2026-12-01')->>'count')::bigint=(data->>'count')::bigint+1005,'aggregate includes every row beyond the REST 1000-row cap') from dashboard_outputs where label='before_cap';
select public.fw_close_month('d2000000-0000-4000-8000-000000000001','2026-11-01','d3000000-0000-4000-8000-000000000001');
select pg_temp.dash_assert((select closing_cash=(select 5000+sum(case kind when 'income' then amount_base else -amount_base end) from public.transactions where workspace_id='d2000000-0000-4000-8000-000000000001' and farm_id='d3000000-0000-4000-8000-000000000001' and txn_date>='2026-11-01' and txn_date<'2026-12-01') from public.month_closings where workspace_id='d2000000-0000-4000-8000-000000000001' and farm_id='d3000000-0000-4000-8000-000000000001' and month='2026-11-01'),'atomic close includes every bulk fixture row');
reset role;
-- Validate deferred FKs before the suite can report PASS and roll back.
set constraints all immediate;
rollback;
