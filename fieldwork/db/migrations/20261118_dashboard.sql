-- REVIEW / STAGING ONLY. Apply AFTER 20261118_members_roles.sql, never schema.sql again.
-- Dashboard/finance APIs. No existing rows are changed or backfilled by this
-- migration. The checked close RPC records only an explicitly requested farm.
-- SECURITY INVOKER is intentional: every contributing SELECT is subject to the
-- caller's table privileges and the members migration's restrictive RLS policies.
-- Separate role branches avoid even querying finance for operational roles or
-- tasks for accountants. The checked membership/farm guards are additional gates.
begin;

do $$ begin
  if to_regprocedure('public.fw_access_context(uuid)') is null or not exists
    (select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='enterprise_id') then
    raise exception 'Install the reviewed members/roles migration before the dashboard migration';
  end if;
end $$;

-- Pure, independently testable KPI arithmetic. Previous zero never yields an
-- invented infinite percentage; negative baselines use their absolute magnitude.
create or replace function fw_private.dashboard_kpi(
  val numeric, prior numeric, unit text, available boolean, sparkline jsonb default '[]'::jsonb
) returns jsonb language sql immutable security invoker set search_path=pg_catalog,public as $$
  select jsonb_build_object('available',available,'value',case when available then val end,
    'previous',case when available then prior end,
    'change',case when available and val is not null and prior is not null then val-prior end,
    'change_pct',case when available and val is not null and prior<>0 then round((val-prior)/abs(prior)*100,2) end,
    'trend',case when not available or val is null or prior is null then 'unavailable'
      when val=prior then 'flat' when prior=0 then 'new' when val>prior then 'up' else 'down' end,
    'unit',unit,'sparkline',case when available then coalesce(sparkline,'[]'::jsonb) else '[]'::jsonb end)
$$;
revoke all on function fw_private.dashboard_kpi(numeric,numeric,text,boolean,jsonb) from public,anon;
grant execute on function fw_private.dashboard_kpi(numeric,numeric,text,boolean,jsonb) to authenticated;

create or replace function public.fw_dashboard(
  p_workspace_id uuid, p_from date, p_to date, p_farm_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare
  r text; ws jsonb; financial boolean; operational boolean;
  today date := (now() at time zone 'Africa/Nairobi')::date;
  previous_from date; trend_from date; trend_end date; this_month date;
  result jsonb; fin jsonb; ops jsonb; attention jsonb := '[]'::jsonb;
  missing jsonb := fw_private.dashboard_kpi(null,null,'currency',false);
begin
  if p_workspace_id is null or p_from is null or p_to is null or p_to<=p_from or p_to-p_from>3660 then
    raise exception 'Choose a workspace and a nonempty date range of at most 3660 days (end exclusive)' using errcode='22023';
  end if;
  r := public.fw_role(p_workspace_id);
  if auth.uid() is null or r is null then raise exception 'Workspace access is required' using errcode='42501'; end if;
  select jsonb_build_object('id',w.id,'name',w.name,'currency',w.currency,'exponent',c.exponent)
    into ws from public.workspaces w join public.currencies c on c.code=w.currency where w.id=p_workspace_id;
  if ws is null then raise exception 'Workspace access is required' using errcode='42501'; end if;
  if p_farm_id is not null and not exists(select 1 from public.farms f where f.id=p_farm_id and f.workspace_id=p_workspace_id) then
    raise exception 'The selected farm is unavailable for this account' using errcode='42501';
  end if;
  financial := r in ('owner','admin','manager','accountant');
  operational := r in ('owner','admin','manager','worker','viewer');
  -- Whole calendar periods compare with the preceding same number of months;
  -- November must include all of October, rather than starting on October 2.
  -- Arbitrary/custom day ranges retain an immediately preceding equal-day range.
  if extract(day from p_from)=1 and extract(day from p_to)=1 then
    previous_from := (p_from-age(p_to::timestamp,p_from::timestamp))::date;
  else previous_from := p_from-(p_to-p_from); end if;
  trend_end := date_trunc('month',p_to-1)::date;
  trend_from := least(date_trunc('month',p_from)::date,(trend_end-interval '5 months')::date);
  this_month := date_trunc('month',today)::date;
  result := jsonb_build_object('version','20261118-dashboard-v1','workspace',ws,
    'scope',jsonb_build_object('from',p_from,'to_exclusive',p_to,'previous_from',previous_from,
      'previous_to_exclusive',p_from,'farm_id',p_farm_id,'as_of',today,'time_zone','Africa/Nairobi',
      'role',r,'finance',financial,'operations',operational,'trend_from',trend_from,
      'trend_to_exclusive',(trend_end+interval '1 month')::date,
      'farm_filter','Selected farm excludes shared/unassigned records'),
    'kpis',jsonb_build_object('income',missing,'expenses',missing,'net',missing,'recorded_cash',missing,
      'task_completion',fw_private.dashboard_kpi(null,null,'count',false)),
    'tasks',null,'series',jsonb_build_object('monthly','[]'::jsonb,'recorded_cash','[]'::jsonb,'task_completion','[]'::jsonb),
    'expense_categories','[]'::jsonb,'budgets',jsonb_build_object('expenses','[]'::jsonb,'income','[]'::jsonb),
    'farm_comparison','[]'::jsonb,'enterprise_profitability','[]'::jsonb,
    'payroll',null,'top_vendors','[]'::jsonb,'cash_coverage',null,
    'attention','[]'::jsonb,'notes',jsonb_build_array(
      'Money values are integer minor units of the workspace base currency unless an attention item names its original currency.',
      'Monthly trends include complete calendar months and may extend beyond the selected dates; range KPIs use the exact selected dates.',
      'Previous comparisons use the preceding matching calendar-month interval when both bounds are month starts; other ranges use the same number of days immediately before the selected start.',
      'Recorded cash uses saved closing snapshots, not a calculated bank balance. Missing snapshots are unavailable.',
      'Budget comparisons combine category plans within the selected scope; full calendar-month plans are compared with actuals on the selected dates.',
      'Task history contains only each task latest stored completion; it is not a complete historical completion log.',
      'Worker reminders show a configured pay rate and missing monthly posting, not a verified amount owed; weekly/daily due schedules are unavailable.',
      'Attention is current as of the farm calendar date, independently of the selected reporting period.'));

  if financial then
    with
    tx as materialized (
      select t.* from public.transactions t where t.workspace_id=p_workspace_id
        and (p_farm_id is null or t.farm_id=p_farm_id)
        and t.txn_date>=least(previous_from,trend_from)
        and t.txn_date<(trend_end+interval '1 month')::date
    ),
    farms as materialized (
      select f.id,f.name from public.farms f where f.workspace_id=p_workspace_id and (p_farm_id is null or f.id=p_farm_id)
    ),
    months as (select generate_series(trend_from::timestamp,trend_end::timestamp,interval '1 month')::date as month),
    totals as (
      select coalesce(sum(amount_base) filter(where kind='income' and txn_date>=p_from and txn_date<p_to),0) as income,
        coalesce(sum(amount_base) filter(where kind='expense' and txn_date>=p_from and txn_date<p_to),0) as expenses,
        coalesce(sum(amount_base) filter(where kind='income' and txn_date>=previous_from and txn_date<p_from),0) as prior_income,
        coalesce(sum(amount_base) filter(where kind='expense' and txn_date>=previous_from and txn_date<p_from),0) as prior_expenses,
        coalesce(sum(amount_base) filter(where kind='expense' and source_type='worker_pay' and txn_date>=p_from and txn_date<p_to),0) as payroll
      from tx
    ),
    monthly as (
      select m.month,coalesce(sum(t.amount_base) filter(where t.kind='income'),0) as income,
        coalesce(sum(t.amount_base) filter(where t.kind='expense'),0) as expenses
      from months m left join tx t on t.txn_date>=m.month and t.txn_date<(m.month+interval '1 month')::date group by m.month
    ),
    -- Match the existing finance module: SUM visible records for exactly this
    -- calendar month. Do not carry earlier snapshots forward or infer a balance.
    cash_dates as (select month from months union select date_trunc('month',p_from-1)::date),
    cash as (
      select d.month,sum(mc.closing_cash) as value,count(mc.id)::int as recorded_rows,
        count(distinct mc.farm_id)::int as known_farms,(select count(*)::int from farms) as total_farms,
        count(mc.id) filter(where mc.farm_id is null)::int as shared_rows,
        'recorded_month_sum'::text as source,
        count(distinct mc.farm_id)=(select count(*) from farms) and count(distinct mc.farm_id)>0 as complete
      from cash_dates d left join public.month_closings mc on mc.workspace_id=p_workspace_id
        and mc.month=d.month and (p_farm_id is null or mc.farm_id=p_farm_id)
      group by d.month
    ),
    category_actual as (
      select t.category_id,coalesce(c.name,'Uncategorised') as name,sum(t.amount_base) as amount
      from tx t left join public.categories c on c.id=t.category_id and c.workspace_id=p_workspace_id
      where t.kind='expense' and t.txn_date>=p_from and t.txn_date<p_to group by t.category_id,c.name
    ),
    budget_plan as (
      select p_farm_id as farm_id,b.category_id,c.name,c.kind,sum(b.amount) as budget
      from public.budgets b join public.categories c on c.id=b.category_id and c.workspace_id=p_workspace_id
      where b.workspace_id=p_workspace_id and (p_farm_id is null or b.farm_id=p_farm_id)
        and b.month>=date_trunc('month',p_from)::date and b.month<(trend_end+interval '1 month')::date
      group by b.category_id,c.name,c.kind
    ),
    budget_actual as (
      select b.*,coalesce((select sum(t.amount_base) from tx t where t.category_id=b.category_id
        and t.kind=b.kind and t.txn_date>=p_from and t.txn_date<p_to),0) as actual from budget_plan b
    ),
    farm_totals as (
      select f.id,f.name,coalesce(sum(t.amount_base) filter(where t.kind='income'),0) as income,
        coalesce(sum(t.amount_base) filter(where t.kind='expense'),0) as expenses
      from farms f left join tx t on t.farm_id=f.id and t.txn_date>=p_from and t.txn_date<p_to group by f.id,f.name
      union all
      select null::uuid,'Shared / unassigned',coalesce(sum(amount_base) filter(where kind='income'),0),
        coalesce(sum(amount_base) filter(where kind='expense'),0) from tx
      where farm_id is null and txn_date>=p_from and txn_date<p_to having count(*)>0
    ),
    enterprise_totals as (
      select e.id,e.name,e.farm_id,count(t.id) as linked_count,
        sum(t.amount_base) filter(where t.kind='income') as income,sum(t.amount_base) filter(where t.kind='expense') as expenses
      from public.enterprises e left join tx t on t.enterprise_id=e.id and t.txn_date>=p_from and t.txn_date<p_to
      where e.workspace_id=p_workspace_id and (p_farm_id is null or e.farm_id=p_farm_id) group by e.id,e.name,e.farm_id
    ),
    vendor_totals as (
      select t.vendor_id as id,coalesce(v.name,'Unspecified vendor') as name,sum(t.amount_base) as amount,count(*) as count
      from tx t left join public.vendors v on v.id=t.vendor_id and v.workspace_id=p_workspace_id
      where t.kind='expense' and t.txn_date>=p_from and t.txn_date<p_to
      group by t.vendor_id,v.name order by sum(t.amount_base) desc,t.vendor_id limit 8
    )
    select jsonb_build_object(
      'kpis',jsonb_build_object(
        'income',fw_private.dashboard_kpi(z.income,z.prior_income,'currency',true,(select jsonb_agg(jsonb_build_object('month',month,'value',income) order by month) from monthly)),
        'expenses',fw_private.dashboard_kpi(z.expenses,z.prior_expenses,'currency',true,(select jsonb_agg(jsonb_build_object('month',month,'value',expenses) order by month) from monthly)),
        'net',fw_private.dashboard_kpi(z.income-z.expenses,z.prior_income-z.prior_expenses,'currency',true,(select jsonb_agg(jsonb_build_object('month',month,'value',income-expenses) order by month) from monthly)),
        'recorded_cash',fw_private.dashboard_kpi((select value from cash where month=trend_end),
          (select value from cash where month=date_trunc('month',p_from-1)::date),'currency',true,
          (select jsonb_agg(jsonb_build_object('month',month,'value',value) order by month) from cash where month in(select month from months)))),
      'monthly',(select jsonb_agg(jsonb_build_object('month',month,'income',income,'expenses',expenses,'net',income-expenses) order by month) from monthly),
      'recorded_cash',(select jsonb_agg(jsonb_build_object('month',month,'value',value,'recorded_rows',recorded_rows,'known_farms',known_farms,'total_farms',total_farms,'shared_rows',shared_rows,'complete',complete,'source',source) order by month) from cash where month in(select month from months)),
      'cash_coverage',(select jsonb_build_object('month',month,'recorded_rows',recorded_rows,'known_farms',known_farms,'total_farms',total_farms,'shared_rows',shared_rows,'complete',complete,'source',source) from cash where month=trend_end),
      'expense_categories',coalesce((select jsonb_agg(jsonb_build_object('id',category_id,'name',name,'amount',amount,'pct',case when z.expenses<>0 then round(amount/z.expenses*100,2) end) order by amount desc,name) from category_actual),'[]'::jsonb),
      'budgets',jsonb_build_object('expenses',coalesce((select jsonb_agg(jsonb_build_object('farm_id',farm_id,'category_id',category_id,'name',name,'budget',budget,'actual',actual,'remaining',budget-actual,'pct',case when budget<>0 then round(actual/budget*100,2) end) order by name,farm_id) from budget_actual where kind='expense'),'[]'::jsonb),
        'income',coalesce((select jsonb_agg(jsonb_build_object('farm_id',farm_id,'category_id',category_id,'name',name,'budget',budget,'actual',actual,'remaining',budget-actual,'pct',case when budget<>0 then round(actual/budget*100,2) end) order by name,farm_id) from budget_actual where kind='income'),'[]'::jsonb),
        'from',date_trunc('month',p_from)::date,'to_exclusive',(trend_end+interval '1 month')::date,'actual_from',p_from,'actual_to_exclusive',p_to),
      'farm_comparison',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'income',income,'expenses',expenses,'net',income-expenses,'open_tasks',null) order by name) from farm_totals),'[]'::jsonb),
      'enterprise_profitability',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'farm_id',farm_id,'linked_count',linked_count,
        'income',case when linked_count>0 then coalesce(income,0) end,'expenses',case when linked_count>0 then coalesce(expenses,0) end,
        'margin',case when linked_count>0 then coalesce(income,0)-coalesce(expenses,0) end) order by name) from enterprise_totals),'[]'::jsonb),
      'payroll',jsonb_build_object('amount',z.payroll,'expense_total',z.expenses,'pct',case when z.expenses<>0 then round(z.payroll/z.expenses*100,2) end),
      'top_vendors',coalesce((select jsonb_agg(to_jsonb(v) order by amount desc,name) from vendor_totals v),'[]'::jsonb)
    ) into fin from totals z;

    result := result || (fin-'kpis'-'monthly'-'recorded_cash');
    result := jsonb_set(result,'{kpis}',(result->'kpis')||(fin->'kpis'));
    result := jsonb_set(result,'{series}',(result->'series')||jsonb_build_object('monthly',fin->'monthly','recorded_cash',fin->'recorded_cash'));

    -- Current obligations and posting reminders; original-currency amounts must
    -- not be summed with base amounts. No payroll due schedule exists, therefore
    -- monthly source-period checks are described as missing postings, not arrears.
    with items as (
      select 'bill_due'::text as kind,'Bill: '||coalesce(v.name,b.description,'Vendor') as title,
        case when b.due_on<today then 'danger' else 'warning' end as severity,b.due_on as date,
        b.amount-b.paid_amount as amount,b.currency,
        jsonb_build_object('module','vendors','id',b.id,'tab','bills','filters',jsonb_build_object('farm_id',b.farm_id,'vendor_id',b.vendor_id,'status','outstanding')) as action
      from public.vendor_bills b left join public.vendors v on v.id=b.vendor_id and v.workspace_id=p_workspace_id
      where b.workspace_id=p_workspace_id and (p_farm_id is null or b.farm_id=p_farm_id)
        and b.amount>b.paid_amount and b.due_on<=today+14
      union all
      select 'worker_payment_unrecorded','Pay posting missing ('||w.pay_frequency||' rate): '||w.full_name,'info',today,w.pay_amount,w.currency,
        jsonb_build_object('module','workers','id',w.id,'tab','payroll','filters',jsonb_build_object('farm_id',w.farm_id,'worker_id',w.id))
      from public.workers w where w.workspace_id=p_workspace_id and (p_farm_id is null or w.farm_id=p_farm_id)
        and w.active and w.pay_amount>0 and (w.start_date is null or w.start_date<=today) and (w.end_date is null or w.end_date>=today)
        and not exists(select 1 from public.transactions t where t.workspace_id=p_workspace_id and t.farm_id is not distinct from w.farm_id
          and t.kind='expense' and t.source_type='worker_pay' and t.source_id=w.id and t.source_period=this_month)
      union all
      select 'recurring_payment_unrecorded','Not posted: '||rp.name,
        case when period.month+rp.day_of_month-1<today then 'warning' else 'info' end,period.month+rp.day_of_month-1,rp.amount,rp.currency,
        jsonb_build_object('module','finances','id',rp.id,'tab','recurring','filters',jsonb_build_object('farm_id',rp.farm_id,'month',period.month))
      from public.recurring_payments rp cross join (values(this_month),((this_month+interval '1 month')::date)) period(month)
      where rp.workspace_id=p_workspace_id and (p_farm_id is null or rp.farm_id=p_farm_id)
        and rp.active and rp.kind='expense' and period.month+rp.day_of_month-1<=today+14
        and not exists(select 1 from public.transactions t where t.workspace_id=p_workspace_id and t.farm_id is not distinct from rp.farm_id
          and t.kind='expense' and t.source_type='recurring' and t.source_id=rp.id and t.source_period=period.month)
      union all
      select 'grant_deadline','Deadline: '||g.name,case when g.deadline<today then 'danger' else 'warning' end,g.deadline,g.amount,g.currency,
        jsonb_build_object('module','funding','id',g.id,'filters',jsonb_build_object('status',g.status))
      from public.funding_opportunities g where g.workspace_id=p_workspace_id and p_farm_id is null
        and g.status in ('identified','eligible','preparing') and g.deadline between today-30 and today+30
      union all
      select 'expense_budget_near','Budget: '||c.name,case when a.actual>b.amount then 'danger' else 'warning' end,
        (this_month+interval '1 month')::date-1,a.actual,(ws->>'currency')::text,
        jsonb_build_object('module','finances','id',b.id,'tab','budgets','filters',jsonb_build_object('farm_id',b.farm_id,'category_id',b.category_id))
      from public.budgets b join public.categories c on c.id=b.category_id and c.workspace_id=p_workspace_id and c.kind='expense'
      cross join lateral (select coalesce(sum(t.amount_base),0) as actual from public.transactions t where t.workspace_id=p_workspace_id
        and t.farm_id is not distinct from b.farm_id and t.category_id=b.category_id and t.kind='expense'
        and t.txn_date>=this_month and t.txn_date<(this_month+interval '1 month')::date) a
      where b.workspace_id=p_workspace_id and (p_farm_id is null or b.farm_id=p_farm_id) and b.month=this_month and b.amount>0 and a.actual>=b.amount*0.9
    ) select coalesce(jsonb_agg(to_jsonb(i) order by case severity when 'danger' then 0 when 'warning' then 1 else 2 end,date,title),'[]'::jsonb)
      into attention from items i;
  end if;

  if operational then
    with task as materialized (
      select t.*,(t.done_at at time zone 'Africa/Nairobi')::date as completed_on,
        t.status='done' and case t.cadence
          when 'daily' then (t.done_at at time zone 'Africa/Nairobi')::date=today
          when 'monthly' then date_trunc('month',t.done_at at time zone 'Africa/Nairobi')=this_month::timestamp
          else true end as effective_done
      from public.tasks t where t.workspace_id=p_workspace_id and (p_farm_id is null or t.farm_id=p_farm_id)
    ),
    counts as (
      select count(*) as total,count(*) filter(where coalesce(effective_done,false)) as completed,
        count(*) filter(where not coalesce(effective_done,false)) as open,
        count(*) filter(where not coalesce(effective_done,false) and due_date<today) as overdue,
        count(*) filter(where completed_on>=p_from and completed_on<p_to) as period_completed,
        count(*) filter(where completed_on>=previous_from and completed_on<p_from) as previous_completed from task
    ),
    monthly as (
      select m.month,count(t.id) as completed from
        (select generate_series(trend_from::timestamp,trend_end::timestamp,interval '1 month')::date as month) m
      left join task t on t.completed_on>=m.month and t.completed_on<(m.month+interval '1 month')::date group by m.month
    ),
    calendar as (
      select d.date,count(t.id) as completed from (select generate_series(p_from::timestamp,(p_to-1)::timestamp,interval '1 day')::date as date) d
      left join task t on t.completed_on=d.date group by d.date
    ),
    farms as (
      select f.id,f.name,count(t.id) filter(where not coalesce(t.effective_done,false)) as open_tasks
      from public.farms f left join task t on t.farm_id=f.id
      where f.workspace_id=p_workspace_id and (p_farm_id is null or f.id=p_farm_id) group by f.id,f.name
      union all select null::uuid,'Shared / unassigned',count(*) filter(where not coalesce(effective_done,false)) from task where farm_id is null having count(*)>0
    ),
    needs as (
      select 'overdue_task' as kind,t.title,'danger' as severity,t.due_date as date,
        jsonb_build_object('module','daily','id',t.id,'tab','tasks','filters',jsonb_build_object('farm_id',t.farm_id,'status','open','q',t.title)) as action
      from task t where not coalesce(effective_done,false) and t.due_date<today
    )
    select jsonb_build_object('kpi',fw_private.dashboard_kpi(c.period_completed,c.previous_completed,'count',true,
      (select jsonb_agg(jsonb_build_object('month',month,'value',completed) order by month) from monthly)),
      'tasks',jsonb_build_object('completed',c.completed,'open',c.open,'overdue',c.overdue,'total',c.total,
        'pct',case when c.total<>0 then round(c.completed::numeric/c.total*100,2) end,'as_of',today),
      'calendar',(select jsonb_agg(to_jsonb(d) order by date) from calendar d),
      'farms',coalesce((select jsonb_agg(to_jsonb(f) order by name) from farms f),'[]'::jsonb),
      'attention',coalesce((select jsonb_agg(to_jsonb(n) order by date,title) from needs n),'[]'::jsonb)) into ops from counts c;
    result := jsonb_set(result,'{kpis,task_completion}',ops->'kpi');
    result := jsonb_set(result,'{tasks}',ops->'tasks');
    result := jsonb_set(result,'{series,task_completion}',ops->'calendar');
    attention := attention||(ops->'attention');
    if financial then
      select coalesce(jsonb_agg(f.item||jsonb_build_object('open_tasks',coalesce((
        select (t.item->>'open_tasks')::bigint from jsonb_array_elements(ops->'farms') t(item)
        where t.item->'id'=f.item->'id'),0)) order by f.item->>'name'),'[]'::jsonb)
        into fin from jsonb_array_elements(result->'farm_comparison') f(item);
      result := jsonb_set(result,'{farm_comparison}',fin);
    else result := jsonb_set(result,'{farm_comparison}',ops->'farms'); end if;
  end if;
  select coalesce(jsonb_agg(a.item order by case a.item->>'severity' when 'danger' then 0 when 'warning' then 1 else 2 end,a.item->>'date',a.item->>'title'),'[]'::jsonb)
    into attention from jsonb_array_elements(attention) a(item);
  return jsonb_set(result,'{attention}',attention)||jsonb_build_object('attention_count',jsonb_array_length(attention));
end $$;

-- Complete database totals, independent of any REST/list pagination cap.
create or replace function public.fw_transaction_totals(
  p_workspace_id uuid,p_from date,p_to date,p_farm_id uuid default null,p_filters jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare r text; filters jsonb:=coalesce(p_filters,'{}'::jsonb); k text; query_text text; result jsonb;
begin
  r:=public.fw_role(p_workspace_id);
  if auth.uid() is null or r is null or r not in ('owner','admin','manager','accountant') then raise exception 'Financial access is required' using errcode='42501';end if;
  if p_workspace_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) then raise exception 'Choose a finite date range' using errcode='22023';end if;
  if p_to<=p_from or p_to-p_from>3660 then raise exception 'Choose a nonempty date range of at most 3660 days (end exclusive)' using errcode='22023';end if;
  if not exists(select 1 from public.workspaces where id=p_workspace_id) then raise exception 'Workspace access is required' using errcode='42501';end if;
  if p_farm_id is not null and not exists(select 1 from public.farms where id=p_farm_id and workspace_id=p_workspace_id) then raise exception 'The selected farm is unavailable' using errcode='42501';end if;
  if jsonb_typeof(filters)<>'object' or exists(select 1 from jsonb_object_keys(filters) x(key) where key<>all(array['kind','category_id','vendor_id','enterprise_id','source_type','source_id','id','q'])) then raise exception 'Choose supported transaction filters' using errcode='22023';end if;
  foreach k in array array['category_id','vendor_id','enterprise_id','source_id','id'] loop
    if filters?k and filters->k<>'null'::jsonb and (jsonb_typeof(filters->k)<>'string' or (filters->>k)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Choose valid transaction filter IDs' using errcode='22023';end if;
  end loop;
  if filters?'kind' and (jsonb_typeof(filters->'kind')<>'string' or filters->>'kind' not in ('income','expense')) then raise exception 'Choose income or expense' using errcode='22023';end if;
  if filters?'source_type' and filters->'source_type'<>'null'::jsonb and (jsonb_typeof(filters->'source_type')<>'string' or filters->>'source_type' not in ('worker_pay','recurring','project')) then raise exception 'Choose a valid transaction source' using errcode='22023';end if;
  if filters?'q' and jsonb_typeof(filters->'q') not in ('string','null') then raise exception 'Enter a text search' using errcode='22023';end if;
  query_text:=lower(coalesce(filters->>'q',''));
  select jsonb_build_object('schema_version','20261118-finance','income',coalesce(sum(t.amount_base) filter(where t.kind='income'),0),
    'expenses',coalesce(sum(t.amount_base) filter(where t.kind='expense'),0),
    'net',coalesce(sum(case when t.kind='income' then t.amount_base else -t.amount_base end),0),'count',count(*)) into result
  from public.transactions t
  left join public.categories c on c.id=t.category_id and c.workspace_id=p_workspace_id
  left join public.vendors v on v.id=t.vendor_id and v.workspace_id=p_workspace_id
  left join public.farms f on f.id=t.farm_id and f.workspace_id=p_workspace_id
  left join public.enterprises e on e.id=t.enterprise_id and e.workspace_id=p_workspace_id and (p_farm_id is null or e.farm_id=p_farm_id)
  where t.workspace_id=p_workspace_id and t.txn_date>=p_from and t.txn_date<p_to and (p_farm_id is null or t.farm_id=p_farm_id)
    and (not(filters?'kind') or t.kind=filters->>'kind')
    and (not(filters?'category_id') or t.category_id is not distinct from (filters->>'category_id')::uuid)
    and (not(filters?'vendor_id') or t.vendor_id is not distinct from (filters->>'vendor_id')::uuid)
    and (not(filters?'enterprise_id') or t.enterprise_id is not distinct from (filters->>'enterprise_id')::uuid)
    and (not(filters?'source_id') or t.source_id is not distinct from (filters->>'source_id')::uuid)
    and (not(filters?'id') or t.id is not distinct from (filters->>'id')::uuid)
    and (not(filters?'source_type') or t.source_type is not distinct from filters->>'source_type')
    and (query_text='' or position(query_text in lower(coalesce(t.description,'')))>0
      or position(query_text in lower(coalesce(c.name||' ('||c.kind||')','')))>0 or position(query_text in lower(coalesce(v.name,'')))>0
      or position(query_text in lower(coalesce(f.name,'')))>0 or position(query_text in lower(coalesce(e.name,'')))>0);
  return result;
end $$;

create or replace function public.fw_finance_month(p_workspace_id uuid,p_month date,p_farm_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare next_month date; prior_month date; totals jsonb; category_rows jsonb; section_rows jsonb; base text; opening numeric; opening_count bigint; saved numeric;
begin
  if p_month is null or not isfinite(p_month) then raise exception 'Choose a finite month start' using errcode='22023';end if;
  if extract(day from p_month)<>1 then raise exception 'Choose the first day of the month' using errcode='22023';end if;
  next_month:=(p_month+interval '1 month')::date;prior_month:=(p_month-interval '1 month')::date;
  -- This performs the role/MFA, workspace, selected-farm and date checks before
  -- any other financial query. All following reads remain SECURITY INVOKER.
  totals:=public.fw_transaction_totals(p_workspace_id,p_month,next_month,p_farm_id);
  select currency into base from public.workspaces where id=p_workspace_id;
  select coalesce(sum(closing_cash),0),count(*) into opening,opening_count from public.month_closings
    where workspace_id=p_workspace_id and month=prior_month and (p_farm_id is null or farm_id=p_farm_id);
  select sum(closing_cash) into saved from public.month_closings
    where workspace_id=p_workspace_id and month=p_month and (p_farm_id is null or farm_id=p_farm_id);
  with cats as materialized(select id,name,kind from public.categories where workspace_id=p_workspace_id),
  actual as (select category_id,kind,sum(amount_base) as amount from public.transactions
    where workspace_id=p_workspace_id and txn_date>=p_month and txn_date<next_month and (p_farm_id is null or farm_id=p_farm_id) group by category_id,kind),
  plans as (select b.category_id,coalesce(c.kind,'unknown') as kind,sum(b.amount) as amount from public.budgets b left join cats c on c.id=b.category_id
    where b.workspace_id=p_workspace_id and b.month=p_month and (p_farm_id is null or b.farm_id=p_farm_id) group by b.category_id,c.kind),
  keys as (select id,kind from cats union select category_id,kind from actual union select category_id,kind from plans),
  lines as (select k.id,k.kind,case when k.id is null then 'Uncategorised' else coalesce(c.name,'Unknown category') end as name,
    coalesce(p.amount,0) as budget,coalesce(a.amount,0) as actual,
    c.id is not null and k.kind=c.kind and p_farm_id is not null and fw_private.can_write(p_workspace_id,'budgets',p_farm_id,'insert') as can_budget
    from keys k left join cats c on c.id=k.id left join actual a on a.category_id is not distinct from k.id and a.kind=k.kind
    left join plans p on p.category_id is not distinct from k.id and p.kind=k.kind)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'budget',budget,'actual',actual,'can_budget',can_budget,
      'variance',case kind when 'expense' then budget-actual when 'income' then actual-budget end,
      'pct',case when budget<>0 then round(actual/budget*100,2) end,'over_budget',kind='expense' and budget>0 and actual>budget) order by kind,name,id),'[]'::jsonb),
    jsonb_build_object('income',jsonb_build_object('budget',coalesce(sum(budget) filter(where kind='income'),0),'actual',coalesce(sum(actual) filter(where kind='income'),0)),
      'expense',jsonb_build_object('budget',coalesce(sum(budget) filter(where kind='expense'),0),'actual',coalesce(sum(actual) filter(where kind='expense'),0)),
      'unknown',jsonb_build_object('budget',coalesce(sum(budget) filter(where kind='unknown'),0),'actual',coalesce(sum(actual) filter(where kind='unknown'),0)))
    into category_rows,section_rows from lines;
  return jsonb_build_object('schema_version','20261118-finance','period',jsonb_build_object('from',p_month,'to',next_month),'currency',base,
    'totals',jsonb_build_object('income',totals->'income','expenses',totals->'expenses','net',totals->'net','opening',opening,
      'calculated_closing',opening+(totals->>'net')::numeric,'saved_closing',saved,'opening_recorded',opening_count>0),
    'categories',category_rows,'sections',section_rows);
end $$;

create or replace function public.fw_close_month(p_workspace_id uuid,p_month date,p_farm_id uuid)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog,public as $$
declare result jsonb; closing_value bigint;
begin
  if p_farm_id is null then raise exception 'Choose one farm before closing its month' using errcode='22023';end if;
  -- The month RPC checks read access and dates before any amount is computed.
  result:=public.fw_finance_month(p_workspace_id,p_month,p_farm_id);
  if not fw_private.can_write(p_workspace_id,'month_closings',p_farm_id,'insert') or not fw_private.can_write(p_workspace_id,'month_closings',p_farm_id,'update') then
    raise exception 'Permission to record this farm closing is required' using errcode='42501';end if;
  closing_value:=(result#>>'{totals,calculated_closing}')::bigint;
  insert into public.month_closings(workspace_id,farm_id,month,closing_cash) values(p_workspace_id,p_farm_id,p_month,closing_value)
    on conflict(workspace_id,farm_id,month) do update set closing_cash=excluded.closing_cash;
  return public.fw_finance_month(p_workspace_id,p_month,p_farm_id);
end $$;
revoke all on function public.fw_transaction_totals(uuid,date,date,uuid,jsonb),public.fw_finance_month(uuid,date,uuid),public.fw_close_month(uuid,date,uuid) from public,anon;
grant execute on function public.fw_transaction_totals(uuid,date,date,uuid,jsonb),public.fw_finance_month(uuid,date,uuid),public.fw_close_month(uuid,date,uuid) to authenticated;

revoke all on function public.fw_dashboard(uuid,date,date,uuid) from public,anon;
grant execute on function public.fw_dashboard(uuid,date,date,uuid) to authenticated;
comment on function public.fw_dashboard(uuid,date,date,uuid) is
  'Read-only v20261118 dashboard. End date exclusive; RLS/security invoker; minor-unit base money; latest-only task history; saved cash snapshots.';

-- Support the workspace/date and exact-month snapshot access paths. These
-- contain no denormalized aggregates and do not modify historical amounts.
create index if not exists month_closings_dashboard on public.month_closings(workspace_id,month,farm_id);
create index if not exists tasks_dashboard_due on public.tasks(workspace_id,farm_id,due_date);
create index if not exists budgets_dashboard_month on public.budgets(workspace_id,month,farm_id,category_id);
commit;
