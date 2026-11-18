-- CURRENT-PROJECT READ-ONLY PROBE. Prepared for nwuyizxxtfrncigorfji.
-- NOT executed by the app or by creating this file. Inspect the target first.
-- Last verified 18 November 2026 on this current project: 44 protected-table
-- anonymous/nonmember checks passed; final ROLLBACK and separate role/UID cleanup
-- checks passed. This does NOT mean the three migration/fixture suites were run.
-- Run this complete batch on ONE connection. It creates no objects, inserts no
-- users/sessions/files, changes no policies/grants, and does not call sequences.
-- DO blocks are anonymous read-only assertions, not stored/temp functions.
-- Only transaction-local role/claim/result settings change; ROLLBACK clears them.
-- A SELECT privilege denial counts as secure denial, not as a successful scan.
-- Any visible protected row, fixture-ID collision, unsafe role, or unexpected
-- query error raises an error. The runner MUST stop on the first error and issue
-- ROLLBACK/close the connection if it stops before the final ROLLBACK below.
-- The final pass marker is valid only if the complete batch had no earlier error.
-- No owner/manager/worker access matrix, real Auth JWT, HTTP/storage operation,
-- migration, account deletion, or fixture-based tenant isolation is tested here.
begin transaction read only;
set local lock_timeout='1s';
set local statement_timeout='5s';
set local idle_in_transaction_session_timeout='15s';

-- Fail before impersonation if the deliberately unassigned identity exists.
-- The same check includes profiles/memberships to catch unexpected orphan data.
do $$ begin
  if exists(select 1 from auth.users where id='00000000-0000-4000-8000-00000000f17d')
    or exists(select 1 from public.profiles where id='00000000-0000-4000-8000-00000000f17d')
    or exists(select 1 from public.workspace_members where user_id='00000000-0000-4000-8000-00000000f17d') then
    raise exception 'Read-only probe failed: reserved_identity_collision count=1';
  end if;
  if (select count(*) from pg_roles where rolname in ('anon','authenticated'))<>2 then
    raise exception 'Read-only probe failed: expected_roles count<>2';
  end if;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'Read-only probe failed: test_role_bypasses_rls count>0';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_roles r on r.rolname in ('anon','authenticated')
    where n.nspname='public' and c.relkind in ('r','p') and pg_has_role(r.oid,c.relowner,'USAGE')) then
    raise exception 'Read-only probe failed: test_role_inherits_table_ownership count>0';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity and c.relname=any(array[
      'profiles','currencies','workspaces','workspace_members','farms','fx_rates','categories','vendors','seed_merchants',
      'tasks','checklists','checklist_items','checklist_runs','checklist_run_items','transactions','budgets','month_closings',
      'recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','audit_log']))<>24 then
    raise exception 'Read-only probe failed: expected_existing_rls_tables count<>24';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid in(to_regprocedure('public.fw_role(uuid)'),to_regprocedure('public.fw_is_member(uuid)'))
      and p.prosecdef and pg_get_functiondef(p.oid) ilike '%workspace_members%'
      and pg_get_functiondef(p.oid) ilike '%auth.uid()%')<>2 then
    raise exception 'Read-only probe failed: expected_membership_identity_helpers count<>2';
  end if;
  if exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid in(to_regprocedure('public.fw_role(uuid)'),to_regprocedure('public.fw_is_member(uuid)'))
      and r.rolname in ('anon','authenticated')) then
    raise exception 'Read-only probe failed: untrusted_membership_helper_owner count>0';
  end if;
end $$;

-- Capture only existing workspace UUIDs inside a local setting so the following
-- role tests can exercise the actual helpers without returning any UUID/name.
-- The initial SQL-editor role must see all workspaces for this helper coverage.
select 'workspace_context_captured' as probe,
  jsonb_array_length(set_config('fw_readonly_probe.workspaces',coalesce(jsonb_agg(id),'[]'::jsonb)::text,true)::jsonb) as count
from public.workspaces;
select 'public_policy_count' as probe,count(*) as count from pg_policies where schemaname='public';
set local fw_readonly_probe.results='[]';

set local request.jwt.claim.sub='';
set local request.jwt.claim.role='anon';
set local request.jwt.claims='{"role":"anon"}';
set local role anon;
do $$ declare t text; n bigint; rows jsonb:=current_setting('fw_readonly_probe.results')::jsonb; begin
  if auth.uid() is not null then raise exception 'Read-only probe failed: anon_identity_present count=1';end if;
  foreach t in array array['profiles','workspaces','workspace_members','farms','fx_rates','categories','vendors',
    'tasks','checklists','checklist_items','checklist_runs','checklist_run_items','transactions','budgets','month_closings',
    'recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','audit_log'] loop
    begin
      execute format('select count(*) from public.%I',t) into n;
      if n<>0 then raise exception 'Read-only probe failed: anon:% visible_rows=%',t,n;end if;
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:'||t||':rls_zero_rows','count',n));
    exception when insufficient_privilege then
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:'||t||':select_denied','count',0));
    end;
  end loop;
  -- These two global reference tables may legitimately be readable. Their rows
  -- are counted for visibility only and are NOT treated as tenant data leaks.
  foreach t in array array['currencies','seed_merchants'] loop
    begin
      execute format('select count(*) from public.%I',t) into n;
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:global_reference:'||t,'count',n));
    exception when insufficient_privilege then
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:global_reference:'||t||':select_denied','count',0));
    end;
  end loop;
  begin
    select count(*) into n from jsonb_array_elements_text(current_setting('fw_readonly_probe.workspaces')::jsonb) w(id)
      where public.fw_role(w.id::uuid) is not null or public.fw_is_member(w.id::uuid);
    if n<>0 then raise exception 'Read-only probe failed: anon:membership_helpers_grant_access count=%',n;end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:membership_helpers_grant_access','count',n));
  exception when insufficient_privilege then
    rows:=rows||jsonb_build_array(jsonb_build_object('probe','anon:membership_helpers:execute_denied','count',0));
  end;
  perform set_config('fw_readonly_probe.results',rows::text,true);
end $$;
reset role;

set local request.jwt.claim.sub='00000000-0000-4000-8000-00000000f17d';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claims='{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000f17d","aal":"aal1"}';
set local role authenticated;
do $$ declare t text; n bigint; rows jsonb:=current_setting('fw_readonly_probe.results')::jsonb; begin
  if auth.uid() is distinct from '00000000-0000-4000-8000-00000000f17d'::uuid then
    raise exception 'Read-only probe failed: reserved_identity_not_applied count=1';
  end if;
  foreach t in array array['profiles','workspaces','workspace_members','farms','fx_rates','categories','vendors',
    'tasks','checklists','checklist_items','checklist_runs','checklist_run_items','transactions','budgets','month_closings',
    'recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','audit_log'] loop
    begin
      execute format('select count(*) from public.%I',t) into n;
      if n<>0 then raise exception 'Read-only probe failed: authenticated_nonmember:% visible_rows=%',t,n;end if;
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:'||t||':rls_zero_rows','count',n));
    exception when insufficient_privilege then
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:'||t||':select_denied','count',0));
    end;
  end loop;
  foreach t in array array['currencies','seed_merchants'] loop
    begin
      execute format('select count(*) from public.%I',t) into n;
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:global_reference:'||t,'count',n));
    exception when insufficient_privilege then
      rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:global_reference:'||t||':select_denied','count',0));
    end;
  end loop;
  begin
    select count(*) into n from jsonb_array_elements_text(current_setting('fw_readonly_probe.workspaces')::jsonb) w(id)
      where public.fw_role(w.id::uuid) is not null or public.fw_is_member(w.id::uuid);
    if n<>0 then raise exception 'Read-only probe failed: authenticated_nonmember:membership_helpers_grant_access count=%',n;end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:membership_helpers_grant_access','count',n));
  exception when insufficient_privilege then
    rows:=rows||jsonb_build_array(jsonb_build_object('probe','authenticated_nonmember:membership_helpers:execute_denied','count',0));
  end;
  perform set_config('fw_readonly_probe.results',rows::text,true);
end $$;
reset role;

-- Counts contain no profile, financial, file, token or user-identifying values.
select r.probe,r.count from jsonb_to_recordset(current_setting('fw_readonly_probe.results')::jsonb) r(probe text,count bigint) order by r.probe;
rollback;
select 'PASS: baseline read-only anonymous/nonmember assertions; no migrations or fixtures applied' as probe,44 as protected_table_checks;
