-- ADDITIVE migration for the existing fieldwork/db/schema.sql, PostgreSQL 15+.
-- REVIEW BEFORE APPLYING. This file is provided for staging; it is not run by the app.
-- Existing rows, IDs, balances and the minor-unit money model are preserved.
-- BEHAVIOR CHANGE: workers lose finance/pay/audit access and transaction writes.
-- Owner/admin: workspace and team; only owner can manage owner/admin membership.
-- Manager: operations + finance. Accountant: finance/vendors/pay/financial reports.
-- Worker: tasks/checklist runs/field records. Viewer: operational reads only.
-- Farm-restricted membership excludes shared/null-farm sensitive rows. Shared
-- checklist definitions remain readable; workspace-wide definitions need all-farm
-- write access. Restricted managers cannot create a new, unassigned farm.
-- Invitations are token-hashed, email-bound, verified-email-only and expire in 7 days.
-- No invitation table is exposed to anon/authenticated. Checked RPCs manage it.
-- Receipt files/paths remain intact, but attachment access/changes require
-- all-farm financial access until an independent ownership/provenance map exists.
-- Optional transaction.enterprise_id links new financial rows to enterprises;
-- historical rows remain NULL and are never backfilled or re-attributed here.
-- Its FK checks at transaction end so farm cascades can finish both SET NULL
-- actions; immediate workspace/farm/link guards continue to reject invalid edits.
begin;

create schema if not exists fw_private;
revoke all on schema fw_private from public;
grant usage on schema fw_private to authenticated;

alter table public.workspace_members add column if not exists farm_scope text not null default 'all';
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner','admin','manager','accountant','worker','viewer'));
alter table public.workspace_members drop constraint if exists workspace_members_scope_check;
alter table public.workspace_members add constraint workspace_members_scope_check
  check (farm_scope in ('all','farms') and (role not in ('owner','admin') or farm_scope = 'all'));

alter table public.projects add column if not exists budget bigint;
alter table public.projects drop constraint if exists projects_budget_nonnegative;
alter table public.projects add constraint projects_budget_nonnegative check (budget is null or budget >= 0);
alter table public.transactions add column if not exists enterprise_id uuid references public.enterprises(id) on delete set null deferrable initially deferred;
-- A rerun of the earlier proposal may already have its known FK. Change only
-- that validated enterprise-ID relationship; reject unexpected existing shapes.
do $$ begin
  if not exists(select 1 from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attname='enterprise_id' and not a.attisdropped
    join pg_attribute parent on parent.attrelid=c.confrelid and parent.attname='id' and not parent.attisdropped
    where c.conrelid='public.transactions'::regclass and c.conname='transactions_enterprise_id_fkey'
      and c.contype='f' and c.confrelid='public.enterprises'::regclass and c.conkey=array[a.attnum]
      and c.confkey=array[parent.attnum] and c.confdeltype='n' and c.convalidated) then
    raise exception 'Review the existing transactions enterprise foreign key before applying this proposal';
  end if;
end $$;
alter table public.transactions alter constraint transactions_enterprise_id_fkey deferrable initially deferred;
create index if not exists transactions_enterprise_date on public.transactions(workspace_id,enterprise_id,txn_date);

create table if not exists public.workspace_member_farms (
  workspace_id uuid not null, user_id uuid not null, farm_id uuid not null references public.farms(id) on delete cascade,
  primary key (workspace_id,user_id,farm_id),
  foreign key (workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role text not null check (role in ('owner','admin','manager','accountant','worker','viewer')),
  farm_ids uuid[], token_hash bytea not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id), accepted_at timestamptz,
  check (role not in ('owner','admin') or farm_ids is null)
);
create unique index if not exists workspace_invites_one_pending on public.workspace_invites(workspace_id,email) where status = 'pending';
create index if not exists workspace_member_farms_lookup on public.workspace_member_farms(user_id,workspace_id,farm_id);

-- Bills are an obligations register, not cash transactions. Recording/changing a
-- bill or paid_amount does NOT post a cash transaction or alter closing cash.
create table if not exists public.vendor_bills (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  farm_id uuid references public.farms(id) on delete set null, vendor_id uuid not null references public.vendors(id),
  description text, reference text, issued_on date not null default current_date, due_on date,
  amount bigint not null check (amount >= 0), paid_amount bigint not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  currency text not null default 'KES' references public.currencies(code),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (due_on is null or due_on >= issued_on)
);
create index if not exists vendor_bills_workspace_due on public.vendor_bills(workspace_id,due_on);
alter table public.audit_log add column if not exists farm_id uuid;

create or replace function public.fw_role(ws uuid) returns text language sql stable security definer set search_path = pg_catalog,public as
$$ select m.role from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() $$;
create or replace function public.fw_is_member(ws uuid) returns boolean language sql stable security definer set search_path = pg_catalog,public as
$$ select exists(select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()) $$;

create or replace function fw_private.farm_access(ws uuid, farm uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid()
    and (m.farm_scope = 'all' or (farm is not null and exists(select 1 from public.workspace_member_farms f
      where f.workspace_id = ws and f.user_id = m.user_id and f.farm_id = farm))))
$$;
create or replace function fw_private.all_farms(ws uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.farm_scope = 'all')
$$;
create or replace function fw_private.workspace_bootstrap(ws uuid,creator uuid) returns boolean
language sql stable security definer set search_path = pg_catalog,public as $$
  select creator=auth.uid() and not exists(select 1 from public.workspace_members m where m.workspace_id=ws)
$$;
create or replace function fw_private.can_read(ws uuid, resource text, farm uuid default null) returns boolean
language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare r text := public.fw_role(ws); allowed boolean;
begin
  if r is null then return false; end if;
  allowed := case
    when resource = 'farms' then true
    when resource in ('tasks','checklists','checklist_items','checklist_runs','checklist_run_items','enterprise_records')
      then r in ('owner','admin','manager','worker','viewer')
    when resource = 'enterprises' then r in ('owner','admin','manager','accountant','worker','viewer')
    when resource in ('transactions','budgets','month_closings','recurring_payments','categories','fx_rates','vendors','workers','projects','funding_opportunities','vendor_bills')
      then r in ('owner','admin','manager','accountant')
    else false end;
  if not allowed then return false; end if;
  if resource in ('checklists','checklist_items','categories','fx_rates') then return true; end if;
  return fw_private.farm_access(ws,farm);
end $$;
create or replace function fw_private.can_write(ws uuid, resource text, farm uuid, action text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare r text := public.fw_role(ws); allowed boolean;
begin
  if r is null then return false; end if;
  allowed := case
    when resource in ('transactions','budgets','month_closings','recurring_payments','categories','fx_rates','vendors','workers','vendor_bills')
      then r in ('owner','admin','manager','accountant')
    when resource in ('tasks','checklist_runs','checklist_run_items','enterprise_records')
      then r in ('owner','admin','manager') or (r = 'worker' and action in ('insert','update'))
    when resource in ('farms','checklists','checklist_items','projects','enterprises','funding_opportunities')
      then r in ('owner','admin','manager')
    else false end;
  if not allowed then return false; end if;
  return fw_private.farm_access(ws,farm);
end $$;

-- Relationships in the original schema are single-ID foreign keys. Enforce
-- workspace matching for NEW/CHANGED links without validating/deleting old data.
create or replace function fw_private.enforce_links() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
declare j jsonb := to_jsonb(new); oldj jsonb; col text; target text; linked_ws uuid; linked_id uuid; linked_farm uuid; farm_cleanup boolean := false;
begin
  if tg_op = 'UPDATE' then
    oldj := to_jsonb(old);
    if old.workspace_id is distinct from new.workspace_id then raise exception 'Records cannot move between workspaces' using errcode='42501'; end if;
    -- Preserve the original farm FK's ON DELETE SET NULL behavior for historical
    -- cash records. A normal client edit cannot qualify while the old farm exists.
    farm_cleanup := tg_table_name='transactions' and j->>'farm_id' is null and oldj->>'farm_id' is not null
      and not exists(select 1 from public.farms where id=(oldj->>'farm_id')::uuid);
  end if;
  -- A client-editable receipt_path is not proof of file ownership. Until receipt
  -- provenance is modeled independently, scoped members cannot attach/repoint it.
  if tg_table_name = 'transactions' and ((tg_op = 'INSERT' and j->>'receipt_path' is not null)
    or (tg_op = 'UPDATE' and j->'receipt_path' is distinct from oldj->'receipt_path')) then
    if auth.uid() is not null and (public.fw_role(new.workspace_id) not in ('owner','admin','manager','accountant') or not fw_private.all_farms(new.workspace_id)) then
      raise exception 'Receipt attachments require all-farm financial access' using errcode='42501';
    end if;
    if j->>'receipt_path' is not null and split_part(j->>'receipt_path','/',1) <> new.workspace_id::text then
      raise exception 'Receipt files must belong to this workspace' using errcode='23503';
    end if;
  end if;
  foreach col in array array['farm_id','category_id','vendor_id','enterprise_id','checklist_id','run_id','item_id','source_id'] loop
    if not (j ? col) or j->>col is null then continue; end if;
    if tg_op = 'UPDATE' and j->col is not distinct from oldj->col and
      (col <> 'source_id' or j->'source_type' is not distinct from oldj->'source_type') and
      (col not in ('source_id','enterprise_id') or j->'farm_id' is not distinct from oldj->'farm_id' or farm_cleanup) then continue; end if;
    target := case col when 'farm_id' then 'farms' when 'category_id' then 'categories' when 'vendor_id' then 'vendors'
      when 'enterprise_id' then 'enterprises' when 'checklist_id' then 'checklists' when 'run_id' then 'checklist_runs'
      when 'item_id' then 'checklist_items' when 'source_id' then case j->>'source_type'
        when 'worker_pay' then 'workers' when 'recurring' then 'recurring_payments' when 'project' then 'projects' end end;
    if target is null then continue; end if;
    linked_id := (j->>col)::uuid;
    execute format('select workspace_id from public.%I where id = $1',target) into linked_ws using linked_id;
    if linked_ws is distinct from new.workspace_id then raise exception 'Linked records must belong to the same workspace' using errcode='23503'; end if;
    if tg_table_name = 'transactions' and col in ('source_id','enterprise_id') then
      execute format('select farm_id from public.%I where id = $1',target) into linked_farm using linked_id;
      -- Prevent a farm-A transaction from claiming a farm-B worker/project/
      -- recurring source (and occupying its unique monthly auto-post key).
      -- A shared source/enterprise may be allocated only by all-farm members.
      if (linked_farm is not null and linked_farm is distinct from new.farm_id)
        or (linked_farm is null and auth.uid() is not null and not fw_private.all_farms(new.workspace_id))
        or (auth.uid() is not null and not fw_private.farm_access(new.workspace_id,linked_farm)) then
        raise exception 'The linked source or enterprise must belong to an allowed matching farm' using errcode='23503';
      end if;
    end if;
  end loop;
  if tg_table_name = 'checklist_run_items' and (tg_op = 'INSERT' or j->'run_id' is distinct from oldj->'run_id' or j->'item_id' is distinct from oldj->'item_id') then
    if not exists(select 1 from public.checklist_runs r join public.checklist_items i on i.checklist_id = r.checklist_id where r.id = new.run_id and i.id = new.item_id) then
      raise exception 'This item does not belong to this checklist run' using errcode='23503';
    end if;
  end if;
  if tg_table_name = 'vendor_bills' then new.updated_at := now(); end if;
  return new;
end $$;

create or replace function fw_private.member_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id <> old.workspace_id or new.user_id <> old.user_id) then
    raise exception 'Replace a membership through the member actions, not by changing its identity' using errcode='42501';
  end if;
  if (tg_op = 'DELETE' and old.role = 'owner') or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    -- Serialize concurrent removals/demotions. Workspace deletion cascades are allowed.
    perform 1 from public.workspaces where id = old.workspace_id for update;
    if found and not exists(select 1 from public.workspace_members where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id) then
      raise exception 'Keep at least one owner. Add another owner before removing or changing this owner.' using errcode='23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists fw_members_guard on public.workspace_members;
create trigger fw_members_guard before update or delete on public.workspace_members for each row execute function fw_private.member_guard();

create or replace function fw_private.scope_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  if not exists(select 1 from public.farms where id = new.farm_id and workspace_id = new.workspace_id) then
    raise exception 'The selected farm belongs to another workspace' using errcode='23503';
  end if;
  return new;
end $$;
drop trigger if exists fw_scope_guard on public.workspace_member_farms;
create trigger fw_scope_guard before insert or update on public.workspace_member_farms for each row execute function fw_private.scope_guard();

-- Resolve audit farm context while related records are still available. Existing
-- audit entries remain intact; scoped users conservatively cannot read entries
-- without farm context. Workspace-wide readers retain their existing history.
create or replace function fw_private.audit_farm(t text,j jsonb) returns uuid
language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare farm uuid;
begin
  if t = 'farms' then return (j->>'id')::uuid; end if;
  if j ? 'farm_id' then return (j->>'farm_id')::uuid; end if;
  if t = 'enterprise_records' then select e.farm_id into farm from public.enterprises e where e.id = (j->>'enterprise_id')::uuid;
  elsif t = 'checklist_run_items' then select r.farm_id into farm from public.checklist_runs r where r.id = (j->>'run_id')::uuid;
  end if;
  return farm;
end $$;
create or replace function public.fw_audit() returns trigger language plpgsql security definer set search_path = pg_catalog,public as $$
declare j jsonb := to_jsonb(coalesce(new,old)); ws uuid;
begin
  ws := case when tg_table_name = 'workspaces' then (j->>'id')::uuid else (j->>'workspace_id')::uuid end;
  insert into public.audit_log(workspace_id,farm_id,table_name,row_id,action,actor,old_data,new_data)
  values(ws,fw_private.audit_farm(tg_table_name,j),tg_table_name,(j->>'id')::uuid,tg_op,auth.uid(),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new,old);
end $$;
create or replace function fw_private.audit_access(ws uuid,t text,farm uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare r text := public.fw_role(ws);
begin
  if r not in ('owner','admin','manager','accountant') or r is null then return false; end if;
  if t in ('workspaces','workspace_members','workspace_member_farms','workspace_invites') then return r in ('owner','admin'); end if;
  return fw_private.can_read(ws,t,farm);
end $$;

-- Member management is RPC-only. Locking the parent workspace gives membership,
-- invite creation/acceptance and last-owner changes a consistent lock order.
create or replace function fw_private.require_admin(ws uuid) returns text
language plpgsql security definer set search_path = pg_catalog,public as $$
declare r text;
begin
  if auth.uid() is null then raise exception 'Sign in to manage this workspace' using errcode='42501'; end if;
  perform 1 from public.workspaces where id = ws for update;
  r := public.fw_role(ws);
  if r is null or r not in ('owner','admin') then raise exception 'Only an owner or administrator can manage members' using errcode='42501'; end if;
  return r;
end $$;
create or replace function fw_private.check_assignment(ws uuid,actor_role text,next_role text,farm_ids uuid[],old_role text default null) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
begin
  if next_role is null or next_role not in ('owner','admin','manager','accountant','worker','viewer') then raise exception 'Choose a valid role' using errcode='22023'; end if;
  if actor_role <> 'owner' and (next_role in ('owner','admin') or old_role in ('owner','admin')) then
    raise exception 'Only an owner can manage owners or administrators' using errcode='42501';
  end if;
  if farm_ids is not null then
    if next_role in ('owner','admin') then raise exception 'Owners and administrators require all-farm access' using errcode='22023'; end if;
    if cardinality(farm_ids) = 0 or exists(select 1 from unnest(farm_ids) f where f is null or not exists(select 1 from public.farms x where x.id = f and x.workspace_id = ws)) then
      raise exception 'Choose farms from this workspace, or choose All farms' using errcode='22023';
    end if;
  end if;
end $$;

-- Qualify pgcrypto functions using the extension's actual installed schema.
do $$ declare crypto_schema text; begin
  select n.nspname into crypto_schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';
  if crypto_schema is null then raise exception 'pgcrypto is required (installed by the base schema)'; end if;
  execute format('create or replace function fw_private.token_hash(t text) returns bytea language sql immutable set search_path=pg_catalog as %L',format('select %I.digest(t,''sha256'')',crypto_schema));
  execute format('create or replace function fw_private.new_token() returns text language sql volatile set search_path=pg_catalog as %L',format('select encode(%I.gen_random_bytes(32),''hex'')',crypto_schema));
end $$;

create or replace function public.fw_create_invite(p_workspace_id uuid,p_email text,p_role text,p_farm_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog,public as $$
declare actor_role text; invite_id uuid; invite_token text; target_email text := lower(btrim(p_email)); expiry timestamptz := now()+interval '7 days';
begin
  actor_role := fw_private.require_admin(p_workspace_id);
  perform fw_private.check_assignment(p_workspace_id,actor_role,p_role,p_farm_ids);
  if target_email is null or position('@' in target_email) <= 1 or length(target_email) > 320 then raise exception 'Enter a valid email address' using errcode='22023'; end if;
  if exists(select 1 from auth.users u join public.workspace_members m on m.user_id=u.id where m.workspace_id=p_workspace_id and lower(u.email)=target_email) then
    raise exception 'This person is already a member' using errcode='23505';
  end if;
  if actor_role <> 'owner' and exists(select 1 from public.workspace_invites where workspace_id=p_workspace_id and email=target_email and status='pending' and role in ('owner','admin')) then
    raise exception 'Only an owner can replace an owner or administrator invitation' using errcode='42501';
  end if;
  update public.workspace_invites set status='revoked' where workspace_id=p_workspace_id and email=target_email and status='pending';
  invite_token := fw_private.new_token();
  insert into public.workspace_invites(workspace_id,email,role,farm_ids,token_hash,created_by,expires_at)
  values(p_workspace_id,target_email,p_role,p_farm_ids,fw_private.token_hash(invite_token),auth.uid(),expiry) returning id into invite_id;
  return jsonb_build_object('id',invite_id,'token',invite_token,'expires_at',expiry,'email',target_email,'role',p_role);
end $$;

create or replace function public.fw_accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = pg_catalog,public as $$
declare invitation public.workspace_invites; ws uuid; recipient_email text; inviter_role text;
begin
  if auth.uid() is null or p_token is null or length(p_token) <> 64 then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  select lower(u.email) into recipient_email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  select i.workspace_id into ws from public.workspace_invites i where i.token_hash=fw_private.token_hash(p_token);
  if ws is null then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  perform 1 from public.workspaces where id=ws for update;
  select * into invitation from public.workspace_invites i where i.token_hash=fw_private.token_hash(p_token) for update;
  if invitation.email is distinct from recipient_email then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  if invitation.status='accepted' and invitation.accepted_by=auth.uid() and public.fw_is_member(ws) then return ws; end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  select m.role into inviter_role from public.workspace_members m where m.workspace_id=ws and m.user_id=invitation.created_by;
  if inviter_role is null or inviter_role not in ('owner','admin') then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  perform fw_private.check_assignment(ws,inviter_role,invitation.role,invitation.farm_ids);
  if public.fw_is_member(ws) then raise exception 'This invitation is invalid or has expired' using errcode='42501'; end if;
  insert into public.workspace_members(workspace_id,user_id,role,farm_scope) values(ws,auth.uid(),invitation.role,case when invitation.farm_ids is null then 'all' else 'farms' end);
  insert into public.workspace_member_farms(workspace_id,user_id,farm_id) select ws,auth.uid(),f from (select distinct unnest(invitation.farm_ids) f) x;
  update public.workspace_invites set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=invitation.id;
  return ws;
end $$;

create or replace function public.fw_revoke_invite(p_workspace_id uuid,p_invite_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
declare r text; invitation public.workspace_invites;
begin
  r := fw_private.require_admin(p_workspace_id);
  select * into invitation from public.workspace_invites where workspace_id=p_workspace_id and id=p_invite_id for update;
  if not found then raise exception 'Invitation not found' using errcode='22023'; end if;
  perform fw_private.check_assignment(p_workspace_id,r,invitation.role,null,invitation.role);
  update public.workspace_invites set status='revoked' where id=invitation.id and status='pending';
end $$;

create or replace function public.fw_change_member(p_workspace_id uuid,p_user_id uuid,p_role text,p_farm_ids uuid[] default null) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
declare r text; old_role text;
begin
  r := fw_private.require_admin(p_workspace_id);
  select role into old_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception 'Member not found' using errcode='22023'; end if;
  perform fw_private.check_assignment(p_workspace_id,r,p_role,p_farm_ids,old_role);
  update public.workspace_members set role=p_role,farm_scope=case when p_farm_ids is null then 'all' else 'farms' end where workspace_id=p_workspace_id and user_id=p_user_id;
  delete from public.workspace_member_farms where workspace_id=p_workspace_id and user_id=p_user_id;
  insert into public.workspace_member_farms(workspace_id,user_id,farm_id) select p_workspace_id,p_user_id,f from (select distinct unnest(p_farm_ids) f) x;
end $$;

create or replace function public.fw_remove_member(p_workspace_id uuid,p_user_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog,public as $$
declare r text; old_role text;
begin
  r := fw_private.require_admin(p_workspace_id);
  select role into old_role from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id for update;
  if not found then raise exception 'Member not found' using errcode='22023'; end if;
  perform fw_private.check_assignment(p_workspace_id,r,old_role,null,old_role);
  delete from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
end $$;

create or replace function public.fw_list_members(p_workspace_id uuid)
returns table(user_id uuid,full_name text,email text,role text,farm_scope text,farm_ids uuid[],created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog,public as $$
begin
  if public.fw_role(p_workspace_id) is null or public.fw_role(p_workspace_id) not in ('owner','admin') then raise exception 'Only an owner or administrator can view members' using errcode='42501'; end if;
  return query select m.user_id,p.full_name,u.email::text,m.role,m.farm_scope,
    coalesce((select array_agg(f.farm_id order by f.farm_id) from public.workspace_member_farms f where f.workspace_id=m.workspace_id and f.user_id=m.user_id),'{}'::uuid[]),m.created_at
    from public.workspace_members m join auth.users u on u.id=m.user_id left join public.profiles p on p.id=m.user_id
    where m.workspace_id=p_workspace_id order by m.created_at,m.user_id;
end $$;
create or replace function public.fw_access_context(p_workspace_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog,public as $$
declare m public.workspace_members; ids uuid[];
begin
  select * into m from public.workspace_members where workspace_id=p_workspace_id and user_id=auth.uid();
  if not found then raise exception 'You are not a member of this workspace' using errcode='42501'; end if;
  select coalesce(array_agg(f.farm_id order by f.farm_id),'{}'::uuid[]) into ids from public.workspace_member_farms f
    where f.workspace_id=p_workspace_id and f.user_id=auth.uid();
  return jsonb_build_object('schema_version','20261118','role',m.role,'farm_scope',m.farm_scope,'farm_ids',ids);
end $$;
create or replace function public.fw_list_invites(p_workspace_id uuid)
returns table(id uuid,email text,role text,farm_ids uuid[],status text,created_at timestamptz,expires_at timestamptz,accepted_at timestamptz,created_by uuid)
language plpgsql stable security definer set search_path = pg_catalog,public as $$
begin
  if public.fw_role(p_workspace_id) is null or public.fw_role(p_workspace_id) not in ('owner','admin') then raise exception 'Only an owner or administrator can view invitations' using errcode='42501'; end if;
  return query select i.id,i.email,i.role,i.farm_ids,i.status,i.created_at,i.expires_at,i.accepted_at,i.created_by from public.workspace_invites i
    where i.workspace_id=p_workspace_id order by i.created_at desc;
end $$;

-- Explicitly redacted surfaces: worker/viewer do not receive SELECT on the
-- underlying pay/cost rows through RLS, nor does a client-provided role choose columns.
create or replace function public.fw_operational_projects(p_workspace_id uuid)
returns table(id uuid,workspace_id uuid,farm_id uuid,name text,status text,start_date date,end_date date,notes text)
language sql stable security definer set search_path = pg_catalog,public as $$
  select p.id,p.workspace_id,p.farm_id,p.name,p.status,p.start_date,p.end_date,p.notes from public.projects p
  where p.workspace_id=p_workspace_id and public.fw_is_member(p_workspace_id) and fw_private.farm_access(p_workspace_id,p.farm_id)
$$;
create or replace function public.fw_operational_workers(p_workspace_id uuid)
returns table(id uuid,workspace_id uuid,farm_id uuid,full_name text,role text,start_date date,end_date date,active boolean)
language sql stable security definer set search_path = pg_catalog,public as $$
  select w.id,w.workspace_id,w.farm_id,w.full_name,w.role,w.start_date,w.end_date,w.active from public.workers w
  where w.workspace_id=p_workspace_id and public.fw_is_member(p_workspace_id) and fw_private.farm_access(p_workspace_id,w.farm_id)
$$;

-- Replace the known baseline policies. Restrictive guards also bound any custom
-- permissive policies that might already exist; an old broad policy cannot bypass
-- the new role or farm checks. No table is made public.
do $$ declare t text; farm_expr text; resource text; p text; begin
  foreach t in array array['farms','fx_rates','categories','vendors','tasks','checklists','checklist_items','checklist_runs','checklist_run_items',
    'transactions','budgets','month_closings','recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','vendor_bills'] loop
    execute format('alter table public.%I enable row level security',t);
    foreach p in array array[t||'_sel',t||'_ins',t||'_upd',t||'_del','fx_select','fx_write','fw_access','fw_select_guard','fw_insert_guard','fw_update_guard','fw_delete_guard'] loop
      execute format('drop policy if exists %I on public.%I',p,t);
    end loop;
    farm_expr := case
      when t = 'farms' then 'id'
      when t = 'enterprise_records' then '(select e.farm_id from public.enterprises e where e.id=enterprise_records.enterprise_id and e.workspace_id=enterprise_records.workspace_id)'
      when t = 'checklist_run_items' then '(select r.farm_id from public.checklist_runs r where r.id=checklist_run_items.run_id and r.workspace_id=checklist_run_items.workspace_id)'
      when t in ('fx_rates','categories','checklists','checklist_items','funding_opportunities') then 'null::uuid'
      else 'farm_id' end;
    execute format('create policy fw_access on public.%I as permissive for all to authenticated using (true) with check (true)',t);
    execute format('create policy fw_select_guard on public.%I as restrictive for select to authenticated using (fw_private.can_read(workspace_id,%L,%s))',t,t,farm_expr);
    execute format('create policy fw_insert_guard on public.%I as restrictive for insert to authenticated with check (fw_private.can_write(workspace_id,%L,%s,''insert''))',t,t,farm_expr);
    execute format('create policy fw_update_guard on public.%I as restrictive for update to authenticated using (fw_private.can_write(workspace_id,%L,%s,''update'')) with check (fw_private.can_write(workspace_id,%L,%s,''update''))',t,t,farm_expr,t,farm_expr);
    execute format('create policy fw_delete_guard on public.%I as restrictive for delete to authenticated using (fw_private.can_write(workspace_id,%L,%s,''delete''))',t,t,farm_expr);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('drop trigger if exists fw_links_guard on public.%I',t);
    execute format('create trigger fw_links_guard before insert or update on public.%I for each row execute function fw_private.enforce_links()',t);
  end loop;
end $$;

drop policy if exists wm_manage on public.workspace_members;
drop policy if exists wm_select on public.workspace_members;
drop policy if exists fw_members_select on public.workspace_members;
drop policy if exists fw_members_guard on public.workspace_members;
create policy fw_members_select on public.workspace_members for select to authenticated using (user_id=auth.uid() or public.fw_role(workspace_id) in ('owner','admin'));
create policy fw_members_guard on public.workspace_members as restrictive for all to authenticated using (user_id=auth.uid() or public.fw_role(workspace_id) in ('owner','admin')) with check (false);
revoke all on public.workspace_members from anon,authenticated;
grant select on public.workspace_members to authenticated;
alter table public.workspace_member_farms enable row level security;
drop policy if exists fw_scope_select on public.workspace_member_farms;
create policy fw_scope_select on public.workspace_member_farms for select to authenticated using (user_id=auth.uid() or public.fw_role(workspace_id) in ('owner','admin'));
revoke all on public.workspace_member_farms from anon,authenticated;
grant select on public.workspace_member_farms to authenticated;
alter table public.workspace_invites enable row level security;
revoke all on public.workspace_invites from anon,authenticated;

drop policy if exists ws_select on public.workspaces;
drop policy if exists ws_insert on public.workspaces;
drop policy if exists ws_update on public.workspaces;
drop policy if exists ws_delete on public.workspaces;
create policy ws_select on public.workspaces for select to authenticated using (public.fw_is_member(id) or fw_private.workspace_bootstrap(id,created_by));
create policy ws_insert on public.workspaces for insert to authenticated with check (created_by=auth.uid());
create policy ws_update on public.workspaces for update to authenticated using (public.fw_role(id) in ('owner','admin')) with check (public.fw_role(id) in ('owner','admin'));
create policy ws_delete on public.workspaces for delete to authenticated using (public.fw_role(id)='owner');
drop policy if exists fw_workspace_select_guard on public.workspaces;
drop policy if exists fw_workspace_insert_guard on public.workspaces;
drop policy if exists fw_workspace_update_guard on public.workspaces;
drop policy if exists fw_workspace_delete_guard on public.workspaces;
create policy fw_workspace_select_guard on public.workspaces as restrictive for select to authenticated using (public.fw_is_member(id) or fw_private.workspace_bootstrap(id,created_by));
create policy fw_workspace_insert_guard on public.workspaces as restrictive for insert to authenticated with check (created_by=auth.uid());
create policy fw_workspace_update_guard on public.workspaces as restrictive for update to authenticated using (public.fw_role(id) in ('owner','admin')) with check (public.fw_role(id) in ('owner','admin'));
create policy fw_workspace_delete_guard on public.workspaces as restrictive for delete to authenticated using (public.fw_role(id)='owner');

-- Audit is never directly writable; membership/invite audit rows are admin-only.
drop policy if exists audit_read on public.audit_log;
drop policy if exists fw_audit_read on public.audit_log;
drop policy if exists fw_audit_read_guard on public.audit_log;
create policy fw_audit_read on public.audit_log for select to authenticated using (fw_private.audit_access(workspace_id,table_name,farm_id));
create policy fw_audit_read_guard on public.audit_log as restrictive for select to authenticated using (fw_private.audit_access(workspace_id,table_name,farm_id));
revoke all on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;

-- Global published reference tables remain signed-in read-only. Profile editing
-- remains self-only, including when other permissive policies are present.
revoke all on public.currencies,public.seed_merchants from anon,authenticated;
grant select on public.currencies,public.seed_merchants to authenticated;
drop policy if exists fw_profiles_guard on public.profiles;
create policy fw_profiles_guard on public.profiles as restrictive for all to authenticated using (id=auth.uid()) with check (id=auth.uid());
revoke all on public.profiles,public.workspaces from anon;
grant select,insert,update,delete on public.profiles,public.workspaces to authenticated;

do $$ declare t text; begin
  foreach t in array array['workspaces','workspace_member_farms','workspace_invites','vendor_bills','checklist_runs','checklist_run_items'] loop
    execute format('drop trigger if exists audit_%s on public.%I',t,t);
    execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function public.fw_audit()',t,t);
  end loop;
end $$;

-- Receipt files retain the existing workspace-prefixed paths. A transaction's
-- editable receipt_path is NOT trusted provenance: until a separate attachment
-- ownership map is designed, ALL storage access requires all-farm financial
-- access. Existing files and paths are preserved; scoped users receive no files.
create or replace function fw_private.receipt_access(object_name text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ws uuid; r text;
begin
  begin ws := split_part(object_name,'/',1)::uuid; exception when invalid_text_representation then return false; end;
  r := public.fw_role(ws);
  if r is null or r not in ('owner','admin','manager','accountant') then return false; end if;
  return fw_private.all_farms(ws);
end $$;
drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_write on storage.objects;
drop policy if exists receipts_delete on storage.objects;
drop policy if exists receipts_update on storage.objects;
drop policy if exists fw_receipts_select_guard on storage.objects;
drop policy if exists fw_receipts_insert_guard on storage.objects;
drop policy if exists fw_receipts_update_guard on storage.objects;
drop policy if exists fw_receipts_delete_guard on storage.objects;
create policy receipts_read on storage.objects for select to authenticated using (bucket_id='receipts' and fw_private.receipt_access(name,false));
create policy receipts_write on storage.objects for insert to authenticated with check (bucket_id='receipts' and fw_private.receipt_access(name,true));
create policy receipts_delete on storage.objects for delete to authenticated using (bucket_id='receipts' and fw_private.receipt_access(name,true));
create policy receipts_update on storage.objects for update to authenticated using (bucket_id='receipts' and fw_private.receipt_access(name,true)) with check (bucket_id='receipts' and fw_private.receipt_access(name,true));
create policy fw_receipts_select_guard on storage.objects as restrictive for select to authenticated using (bucket_id<>'receipts' or fw_private.receipt_access(name,false));
create policy fw_receipts_insert_guard on storage.objects as restrictive for insert to authenticated with check (bucket_id<>'receipts' or fw_private.receipt_access(name,true));
create policy fw_receipts_update_guard on storage.objects as restrictive for update to authenticated using (bucket_id<>'receipts' or fw_private.receipt_access(name,true)) with check (bucket_id<>'receipts' or fw_private.receipt_access(name,true));
create policy fw_receipts_delete_guard on storage.objects as restrictive for delete to authenticated using (bucket_id<>'receipts' or fw_private.receipt_access(name,true));

-- Private helpers may be used by authenticated RLS expressions, but cannot mutate
-- membership. Never grant require_admin/check_assignment/token helpers as RPCs.
revoke all on all functions in schema fw_private from public,anon,authenticated;
grant execute on function fw_private.farm_access(uuid,uuid),fw_private.all_farms(uuid),fw_private.workspace_bootstrap(uuid,uuid),fw_private.can_read(uuid,text,uuid),
  fw_private.can_write(uuid,text,uuid,text),fw_private.audit_access(uuid,text,uuid),fw_private.receipt_access(text,boolean) to authenticated;
revoke all on function public.fw_role(uuid),public.fw_is_member(uuid) from public,anon;
grant execute on function public.fw_role(uuid),public.fw_is_member(uuid) to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('fw_create_invite','fw_accept_invite','fw_revoke_invite','fw_change_member','fw_remove_member','fw_list_members','fw_access_context','fw_list_invites','fw_operational_projects','fw_operational_workers') loop
    execute format('revoke all on function %s from public,anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;

commit;
