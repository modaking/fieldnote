-- fieldwork. schema — run in Supabase SQL editor. Idempotent enough for a fresh project.
-- Money: bigint in MINOR units (ISO 4217 exponent, see currencies; KES 100 = KSh 1). Every money row carries its own
--        currency. workspaces.currency is the BASE (reporting) currency; transactions also store fx_rate and a generated
--        amount_base so reports sum in one currency. Budgets and month closings are in the base currency.
-- Roles: owner = full admin (everything, incl. workspace, members, delete). manager = full read/write on operations,
--        no workspace/member admin. worker = read all, write tasks/checklist runs, add+edit transactions.

create extension if not exists pgcrypto;

-- ───────── core ─────────
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, theme_pref text not null default 'system' check (theme_pref in ('light','dark','system')),
  active_workspace uuid, created_at timestamptz default now());

create table currencies (code text primary key check (code ~ '^[A-Z]{3}$'), name text not null, exponent smallint not null default 2);
insert into currencies values ('KES','Kenyan shilling',2),('USD','US dollar',2),('EUR','Euro',2),('GBP','Pound sterling',2),
 ('UGX','Ugandan shilling',0),('TZS','Tanzanian shilling',2),('RWF','Rwandan franc',0),('ETB','Ethiopian birr',2),('ZAR','South African rand',2),
 ('INR','Indian rupee',2),('AED','UAE dirham',2),('CNY','Chinese yuan',2),('JPY','Japanese yen',0);

create table workspaces (
  id uuid primary key default gen_random_uuid(), name text not null,
  currency text not null default 'KES' references currencies, created_by uuid references auth.users, created_at timestamptz default now());

create table workspace_members (
  workspace_id uuid references workspaces on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','manager','worker')), created_at timestamptz default now(),
  primary key (workspace_id, user_id));

-- helpers (security definer avoids RLS recursion on workspace_members)
create function fw_role(ws uuid) returns text language sql stable security definer set search_path = public as
$$ select role from workspace_members where workspace_id = ws and user_id = auth.uid() $$;
create function fw_is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid()) $$;

create table farms (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  name text not null, county text, location_text text,
  lat double precision check (lat between -90 and 90), lng double precision check (lng between -180 and 180),
  plus_code text, boundary jsonb, -- boundary reserved for stage-4+ polygon drawing
  created_at timestamptz default now());

create table fx_rates (   -- manual per-workspace rates: 1 minor unit of `currency` = rate minor units of the base currency
  workspace_id uuid not null references workspaces on delete cascade, currency text not null references currencies,
  rate numeric(18,8) not null check (rate > 0), as_of date not null default current_date, primary key (workspace_id, currency, as_of));

create table categories (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  name text not null, kind text not null check (kind in ('income','expense')), unique (workspace_id, kind, name));

create table vendors (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete set null, name text not null, phone text, email text, kind text, notes text,
  seed_merchant_id uuid, created_at timestamptz default now());

-- global reference list (KEPHIS registered seed merchants): readable by any signed-in user, written by service role only
create table seed_merchants (
  id uuid primary key default gen_random_uuid(), name text not null, county text, phone text, licence_no text, source_url text);

-- ───────── daily operations ─────────
create table tasks (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, title text not null, notes text,
  cadence text not null default 'once' check (cadence in ('daily','monthly','once')),
  due_date date, month date, status text not null default 'open' check (status in ('open','done')),
  assigned_to uuid references auth.users, done_at timestamptz, created_at timestamptz default now());

create table checklists (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  name text not null, created_at timestamptz default now());
create table checklist_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  checklist_id uuid not null references checklists on delete cascade, label text not null, position int not null default 0);
create table checklist_runs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  checklist_id uuid not null references checklists on delete cascade, farm_id uuid references farms on delete cascade,
  run_date date not null default current_date, created_at timestamptz default now());
create table checklist_run_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  run_id uuid not null references checklist_runs on delete cascade, item_id uuid not null references checklist_items on delete cascade,
  done boolean not null default false, done_by uuid references auth.users, done_at timestamptz, unique (run_id, item_id));

-- ───────── money ─────────
create table transactions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete set null, txn_date date not null default current_date,
  kind text not null check (kind in ('income','expense')), amount bigint not null check (amount >= 0),
  currency text not null references currencies, fx_rate numeric(18,8) not null default 1 check (fx_rate > 0),
  amount_base bigint generated always as (round(amount * fx_rate)::bigint) stored,
  category_id uuid references categories on delete set null, vendor_id uuid references vendors on delete set null,
  description text, receipt_path text,                      -- storage path: <workspace_id>/<uuid>.jpg
  source_type text check (source_type in ('worker_pay','recurring','project')), source_id uuid, source_period date,
  created_by uuid references auth.users default auth.uid(), created_at timestamptz default now());
-- auto-posted rows (worker pay, recurring) can never double-post for the same month
create unique index transactions_autopost_uq on transactions (source_type, source_id, source_period) where source_type is not null;
create function fw_txn_defaults() returns trigger language plpgsql as $$
declare base text;
begin
  select currency into base from workspaces where id = new.workspace_id;
  new.currency := coalesce(new.currency, base);
  if new.currency = base then new.fx_rate := 1; end if;            -- base-currency rows never carry a rate
  return new;
end $$;
create trigger txn_defaults before insert or update on transactions for each row execute function fw_txn_defaults();
create index transactions_ws_date on transactions (workspace_id, txn_date desc);

create table budgets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, category_id uuid references categories on delete cascade,
  month date not null, amount bigint not null check (amount >= 0), unique (workspace_id, farm_id, category_id, month));

create table month_closings (   -- closing cash carries forward as next month's opening
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, month date not null, closing_cash bigint not null, unique (workspace_id, farm_id, month));

create table recurring_payments (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, name text not null, amount bigint not null check (amount >= 0),
  currency text not null default 'KES' references currencies,
  kind text not null default 'expense' check (kind in ('income','expense')), category_id uuid references categories on delete set null,
  vendor_id uuid references vendors on delete set null, day_of_month int not null check (day_of_month between 1 and 28), active boolean not null default true);

-- ───────── operations records ─────────
create table projects (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, name text not null, status text not null default 'planned' check (status in ('planned','active','paused','done')),
  cost bigint not null default 0, currency text not null default 'KES' references currencies, start_date date, end_date date, notes text);

create table enterprises (   -- dairy, maize, potatoes…
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete cascade, name text not null, type text not null check (type in ('livestock','crop')), notes text);
create table enterprise_records (  -- structured but flexible: fixed core columns + jsonb for type-specific fields
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  enterprise_id uuid not null references enterprises on delete cascade, record_date date not null default current_date,
  record_type text not null, quantity numeric, unit text, data jsonb not null default '{}', notes text);

create table workers (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  farm_id uuid references farms on delete set null, full_name text not null,
  role text not null check (role in ('farm_manager','herdsman','milker','field_hand','driver','security','casual','other')),
  pay_amount bigint not null default 0, currency text not null default 'KES' references currencies, pay_frequency text not null default 'monthly' check (pay_frequency in ('monthly','weekly','daily')),
  start_date date, end_date date, phone text, active boolean not null default true);

create table funding_opportunities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces on delete cascade,
  name text not null, source text, eligibility_notes text, eligible boolean, owner_id uuid references auth.users,
  deadline date, status text not null default 'identified' check (status in ('identified','eligible','preparing','submitted','awarded','declined')),
  amount bigint, currency text not null default 'KES' references currencies, link text);

-- ───────── audit ─────────
create table audit_log (
  id bigint generated always as identity primary key, workspace_id uuid, table_name text not null, row_id uuid,
  action text not null, actor uuid default auth.uid(), old_data jsonb, new_data jsonb, at timestamptz not null default now());
create index audit_ws_at on audit_log (workspace_id, at desc);

create function fw_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (workspace_id, table_name, row_id, action, old_data, new_data)
  values ((r->>'workspace_id')::uuid, tg_table_name, (r->>'id')::uuid, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['farms','categories','vendors','tasks','checklists','checklist_items','transactions','budgets','month_closings',
    'recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities','workspace_members'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function fw_audit()', 'audit_'||t, t);
  end loop; end $$;

-- base currency can't change once money exists (amount_base would silently go stale)
create function fw_lock_base() returns trigger language plpgsql as $$
begin
  if new.currency <> old.currency and exists (select 1 from transactions where workspace_id = new.id) then
    raise exception 'Base currency cannot change after transactions exist';
  end if; return new;
end $$;
create trigger ws_lock_base before update on workspaces for each row execute function fw_lock_base();

-- ───────── Row-level security ─────────
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table seed_merchants enable row level security;
alter table currencies enable row level security;
alter table fx_rates enable row level security;
alter table audit_log enable row level security;

create policy profiles_self on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy ws_select on workspaces for select using (fw_is_member(id) or created_by = auth.uid());
create policy ws_insert on workspaces for insert with check (created_by = auth.uid());
create policy ws_update on workspaces for update using (fw_role(id) = 'owner');
create policy ws_delete on workspaces for delete using (fw_role(id) = 'owner');
create policy wm_select on workspace_members for select using (fw_is_member(workspace_id));
create policy wm_manage on workspace_members for all using (fw_role(workspace_id) = 'owner') with check (fw_role(workspace_id) = 'owner');
create policy currencies_read on currencies for select using (auth.uid() is not null);
create policy fx_select on fx_rates for select using (fw_is_member(workspace_id));
create policy fx_write on fx_rates for all using (fw_role(workspace_id) in ('owner','manager')) with check (fw_role(workspace_id) in ('owner','manager'));
create policy seed_read on seed_merchants for select using (auth.uid() is not null);
create policy audit_read on audit_log for select using (fw_role(workspace_id) in ('owner','manager'));
-- no insert/update/delete policies on audit_log: only the security-definer trigger writes it

-- creator becomes owner automatically
create function fw_new_workspace() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into workspace_members (workspace_id, user_id, role) values (new.id, new.created_by, 'owner'); return new; end $$;
create trigger ws_creator_owner after insert on workspaces for each row execute function fw_new_workspace();

create function fw_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name'); return new; end $$;
create trigger on_auth_user after insert on auth.users for each row execute function fw_new_user();

-- Per-table write policy. Everyone in the workspace reads. Write roles differ by table group.
--  owner + manager: everything except the worker-writable tables below
--  owner + manager + worker: tasks, checklist_runs(+items), transactions (insert/update; delete is owner/manager only)
do $$
declare t text; wr text[];
begin
  foreach t in array array['farms','categories','vendors','tasks','checklists','checklist_items','checklist_runs','checklist_run_items',
    'transactions','budgets','month_closings','recurring_payments','projects','enterprises','enterprise_records','workers','funding_opportunities'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (fw_is_member(workspace_id))', t||'_sel', t);

    wr := case
      when t in ('tasks','checklist_runs','checklist_run_items','transactions') then array['owner','manager','worker']
      else array['owner','manager'] end;
    execute format('create policy %I on %I for insert with check (fw_role(workspace_id) = any(%L))', t||'_ins', t, wr);
    execute format('create policy %I on %I for update using (fw_role(workspace_id) = any(%L)) with check (fw_role(workspace_id) = any(%L))', t||'_upd', t, wr, wr);
    execute format('create policy %I on %I for delete using (fw_role(workspace_id) = any(%L))', t||'_del', t,
      array['owner','manager']);
  end loop;
end $$;

-- ───────── Storage: private receipts bucket, path = <workspace_id>/<file> ─────────
insert into storage.buckets (id, name, public) values ('receipts','receipts', false) on conflict do nothing;
create policy receipts_read on storage.objects for select using
  (bucket_id = 'receipts' and fw_is_member(((storage.foldername(name))[1])::uuid));
create policy receipts_write on storage.objects for insert with check
  (bucket_id = 'receipts' and fw_role(((storage.foldername(name))[1])::uuid) in ('owner','manager','worker'));
create policy receipts_delete on storage.objects for delete using
  (bucket_id = 'receipts' and fw_role(((storage.foldername(name))[1])::uuid) in ('owner','manager'));
