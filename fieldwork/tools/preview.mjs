// Local, in-memory sample backend for usability checks. Never connects to Supabase.
// Run: node tools/preview.mjs [port]   Sample login: owner@fieldwork.test / sample123
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { canReadModule, canWriteModule, canManageMember, canManageMembers, has } from '../js/permissions.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4175);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid local port.');
const roles = ['owner', 'admin', 'manager', 'accountant', 'worker', 'viewer'];
const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()), month = `${date.slice(0, 7)}-01`;
const addDays=(day,n)=>{const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+n);return value.toISOString().slice(0,10);};
const addMonths=(day,n)=>{const value=new Date(day+'T12:00:00Z');value.setUTCMonth(value.getUTCMonth()+n);return value.toISOString().slice(0,10);};
const at = `${date}T09:00:00Z`;
const tables = Object.fromEntries(['profiles','workspace_members','farms','categories','vendors','tasks','checklists','checklist_items',
  'checklist_runs','checklist_run_items','transactions','budgets','month_closings','recurring_payments','projects','enterprises',
  'enterprise_records','workers','funding_opportunities','fx_rates','seed_merchants','audit_log','workspace_invites','account_notification_preferences'].map((name) => [name, []]));
tables.workspaces = [{ id: 'workspace-a', name: 'ENKISHON sample workspace', currency: 'KES' }, { id: 'workspace-b', name: 'Second sample workspace', currency: 'USD' }];
tables.currencies = [{ code: 'KES', name: 'Kenyan shilling', exponent: 2 }, { code: 'USD', name: 'US dollar', exponent: 2 }, { code: 'UGX', name: 'Ugandan shilling', exponent: 0 }];
for (const role of roles) {
  tables.profiles.push({ id: `preview-${role}`, full_name: `Sample ${role}`, active_workspace: 'workspace-a', theme_pref: 'system',language:'en',time_zone:'Africa/Nairobi',default_period:'month',phone:null,avatar_path:null,default_farm_id:null });
  for (const ws of tables.workspaces) tables.workspace_members.push({ user_id: `preview-${role}`, workspace_id: ws.id, role, farm_scope: ['worker','viewer'].includes(role) ? 'farms' : 'all', farm_ids: ['worker','viewer'].includes(role) ? [ws.id === 'workspace-a' ? 'farm-a' : 'farm-other'] : [], created_at: at });
}
tables.farms = [{ id: 'farm-a', workspace_id: 'workspace-a', name: 'Ol Kalou sample farm', county: 'Nyandarua', location_text: 'Sample farm near Ol Kalou', created_at: at },
  { id: 'farm-b', workspace_id: 'workspace-a', name: 'Mashuru sample farm', county: 'Kajiado', location_text: 'Sample farm near Mashuru', created_at: at },
  { id: 'farm-other', workspace_id: 'workspace-b', name: 'Other workspace sample farm', created_at: at }];
for (const ws of tables.workspaces) for (const [key, name, kind] of [['seed','Seed','expense'],['feed','Feed','expense'],['labour','Labour','expense'],['sales','Crop sales','income']]) {
  tables.categories.push({ id: `${ws.id}-${key}`, workspace_id: ws.id, name, kind });
}
tables.tasks = [{ id: 'task-a', workspace_id: 'workspace-a', farm_id: 'farm-a', title: 'Inspect the water tank', cadence: 'once', status: 'open', due_date: date, created_at: at },
  { id: 'task-b', workspace_id: 'workspace-a', farm_id: null, title: 'Review today’s farm notes', cadence: 'daily', status: 'open', created_at: at },
  { id: 'task-other', workspace_id: 'workspace-b', farm_id: 'farm-other', title: 'Other workspace task', cadence: 'once', status: 'open', created_at: at }];
tables.transactions = [{ id: 'txn-a', workspace_id: 'workspace-a', farm_id: 'farm-a', kind: 'income', txn_date: date, amount: 1000000, currency: 'KES', fx_rate: 1, amount_base: 1000000, category_id: 'workspace-a-sales', description: 'Sample crop sale', created_at: at },
  { id: 'txn-b', workspace_id: 'workspace-a', farm_id: 'farm-b', kind: 'expense', txn_date: date, amount: 250000, currency: 'KES', fx_rate: 1, amount_base: 250000, category_id: 'workspace-a-feed', description: 'Sample feed purchase', created_at: at },
  { id: 'txn-other', workspace_id: 'workspace-b', farm_id: 'farm-other', kind: 'income', txn_date: date, amount: 123400, currency: 'USD', fx_rate: 1, amount_base: 123400, category_id: 'workspace-b-sales', description: 'Other workspace sale', created_at: at }];
tables.fx_rates = [{ workspace_id: 'workspace-a', currency: 'USD', rate: 129, as_of: date }, { workspace_id: 'workspace-a', currency: 'UGX', rate: 3.5, as_of: date }, { workspace_id: 'workspace-b', currency: 'KES', rate: 0.00775, as_of: date }];
tables.vendors = [{ id: 'vendor-a', workspace_id: 'workspace-a', farm_id: 'farm-a', name: 'Sample farm inputs supplier', kind: 'Feed and seed', created_at: at }];
tables.projects = [{ id: 'project-a', workspace_id: 'workspace-a', farm_id: 'farm-a', name: 'Sample water tank', status: 'active', currency: 'KES', budget: 5000000, cost: 3250000, start_date: date, end_date: null, notes: 'Invented project for local layout checks.' }];
tables.workers = [{ id: 'worker-a', workspace_id: 'workspace-a', farm_id: 'farm-a', full_name: 'Sample farm assistant', role: 'field_hand', pay_amount: 450000, currency: 'KES', pay_frequency: 'monthly', start_date: date, active: true }];
tables.enterprises = [{ id: 'enterprise-a', workspace_id: 'workspace-a', farm_id: 'farm-a', name: 'Sample vegetables', type: 'crop', notes: 'Synthetic field records only.' }];
tables.transactions.find((row)=>row.id==='txn-a').enterprise_id='enterprise-a';
tables.vendor_bills = [{ id: 'bill-a', workspace_id: 'workspace-a', farm_id: 'farm-a', vendor_id: 'vendor-a', description: 'Sample feed invoice', reference: 'SAMPLE-001', issued_on: date, due_on: date, amount: 180000, paid_amount: 50000, currency: 'KES', created_at: at, updated_at: at }];
tables.checklists = [{ id: 'checklist-a', workspace_id: 'workspace-a', name: 'Sample daily opening', created_at: at }];
tables.checklist_items = [{ id: 'item-a', workspace_id: 'workspace-a', checklist_id: 'checklist-a', label: 'Check water supply', position: 0 }, { id: 'item-b', workspace_id: 'workspace-a', checklist_id: 'checklist-a', label: 'Inspect the fence', position: 1 }];

// Dashboard examples are invented records, not fetched or copied farm data.
// Keep these in the shared sample tables so modules and the simulated RPC agree.
tables.vendors.push({id:'vendor-b',workspace_id:'workspace-a',farm_id:'farm-b',name:'Sample Mashuru feed supplier',kind:'Feed',created_at:at});
Object.assign(tables.transactions.find(r=>r.id==='txn-b'),{vendor_id:'vendor-b'});
Object.assign(tables.tasks.find(r=>r.id==='task-a'),{due_date:addDays(date,-1)});
tables.tasks.push(...[
  {id:'task-c',farm_id:'farm-a',title:'Check livestock water',cadence:'daily',status:'done',done_at:at},
  {id:'task-d',farm_id:'farm-a',title:'Inspect field irrigation',cadence:'daily',status:'done',done_at:addDays(date,-1)+'T09:00:00Z',due_date:addDays(date,-1)},
  {id:'task-e',farm_id:'farm-b',title:'Review monthly feed stock',cadence:'monthly',status:'done',done_at:month+'T09:00:00Z'},
  {id:'task-f',farm_id:'farm-b',title:'Review farm maintenance',cadence:'once',status:'done',done_at:addDays(date,-3)+'T09:00:00Z'},
].map(r=>({workspace_id:'workspace-a',created_at:at,...r})));
tables.workers.push({id:'worker-b',workspace_id:'workspace-a',farm_id:'farm-b',full_name:'Sample livestock assistant',role:'herdsman',pay_amount:300000,currency:'KES',pay_frequency:'monthly',start_date:addMonths(month,-4),active:true});
tables.transactions.push(
  {id:'txn-seed',workspace_id:'workspace-a',farm_id:'farm-a',kind:'expense',txn_date:date,amount:240000,currency:'KES',fx_rate:1,amount_base:240000,category_id:'workspace-a-seed',vendor_id:'vendor-a',enterprise_id:'enterprise-a',description:'Sample vegetable seed purchase',created_at:at},
  {id:'txn-pay',workspace_id:'workspace-a',farm_id:'farm-a',kind:'expense',txn_date:date,amount:450000,currency:'KES',fx_rate:1,amount_base:450000,category_id:'workspace-a-labour',source_type:'worker_pay',source_id:'worker-a',source_period:month,description:'Sample recorded worker pay',created_at:at});
tables.budgets.push(
  {id:'budget-seed',workspace_id:'workspace-a',farm_id:'farm-a',category_id:'workspace-a-seed',month,amount:260000},
  {id:'budget-feed',workspace_id:'workspace-a',farm_id:'farm-b',category_id:'workspace-a-feed',month,amount:300000},
  {id:'budget-sales',workspace_id:'workspace-a',farm_id:'farm-a',category_id:'workspace-a-sales',month,amount:1200000});
tables.recurring_payments.push({id:'recurring-a',workspace_id:'workspace-a',farm_id:'farm-a',name:'Sample equipment lease',amount:80000,currency:'KES',kind:'expense',category_id:'workspace-a-feed',day_of_month:1,active:true});
tables.funding_opportunities.push({id:'funding-a',workspace_id:'workspace-a',name:'Sample farm improvement grant',source:'Invented example',deadline:addDays(date,7),status:'preparing',amount:3000000,currency:'KES'});
for(let i=5;i>=0;i--){const m=addMonths(month,-i);
  tables.month_closings.push(...['farm-a','farm-b'].map((farm,j)=>({id:`cash-${i}-${j}`,workspace_id:'workspace-a',farm_id:farm,month:m,closing_cash:700000+(5-i)*90000+j*100000})));
  if(i)for(const [farm,kind,amount,category]of[['farm-a','income',650000+(5-i)*120000,'sales'],['farm-a','expense',200000+(5-i)*26000,'seed'],['farm-b','expense',210000+(5-i)*15000,'feed']])tables.transactions.push({id:`historic-${i}-${farm}-${kind}`,workspace_id:'workspace-a',farm_id:farm,kind,txn_date:addDays(m,11),amount,currency:'KES',fx_rate:1,amount_base:amount,category_id:`workspace-a-${category}`,description:'Invented monthly trend record',created_at:at});
}
const identities=new Map(roles.map(role=>[role,{email:`${role}@fieldwork.test`,factors:[],identities:[{id:`identity-${role}`,provider:'email',created_at:at}]}]));

const user = (role) => ({ id: `preview-${role}`, ...identities.get(role),email_confirmed_at:at,created_at:at,last_sign_in_at:at,user_metadata:{full_name:tables.profiles.find(p=>p.id===`preview-${role}`)?.full_name||`Sample ${role}`} });
const token = (req) => {const bearer=req.headers.authorization?.replace(/^Bearer /,'');const legacy=roles.find(role=>bearer===`preview-${role}`);if(legacy)return legacy;try{if(!bearer.endsWith('.LOCAL_SAMPLE_ONLY'))return;const claims=JSON.parse(Buffer.from(bearer.split('.')[1],'base64url'));return roles.find(role=>claims.sub===`preview-${role}`);}catch{return;}};
const authSession=(role,aal='aal1')=>({access_token:Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:`preview-${role}`,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,session_id:`preview-session-${role}`,aal,amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}]})).toString('base64url')+'.LOCAL_SAMPLE_ONLY',refresh_token:`preview-refresh-${role}`,expires_in:3600,user:user(role)});
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const failure = (res, code, message) => json(res, code, { message });
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Sample request too large.'); }
  return text ? JSON.parse(text) : {};
}
function split(value) {
  const parts = []; let start = 0, depth = 0;
  for (let i = 0; i < value.length; i++) { if (value[i] === '(') depth++; if (value[i] === ')') depth--; if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; } }
  return [...parts, value.slice(start)];
}
function condition(row, key, expression) {
  const value = row[key], dot = expression.indexOf('.'), op = expression.slice(0, dot), expected = expression.slice(dot + 1);
  if (op === 'not') return !condition(row, key, expected);
  if (op === 'is') return expected === 'null' ? value == null : String(value) === expected;
  if (op === 'in') return split(expected.replace(/^\(|\)$/g, '')).map((s) => s.replace(/^"|"$/g, '')).includes(String(value));
  if (op === 'eq') return String(value) === expected;
  if (op === 'neq') return String(value) !== expected;
  const a = typeof value === 'number' ? value : String(value ?? ''), b = typeof value === 'number' ? Number(expected) : expected;
  return op === 'gte' ? a >= b : op === 'gt' ? a > b : op === 'lte' ? a <= b : op === 'lt' ? a < b : false;
}
function matches(row, params) {
  return [...params].every(([key, value]) => {
    if (['select','order','limit','offset','on_conflict'].includes(key)) return true;
    if (key === 'or') return split(value.replace(/^\(|\)$/g, '')).some((part) => { const dot = part.indexOf('.'); return condition(row, part.slice(0, dot), part.slice(dot + 1)); });
    return condition(row, key, value);
  });
}
function related(name, row) {
  if (name === 'workspace_members') return { ...row, workspaces: tables.workspaces.find((ws) => ws.id === row.workspace_id) };
  if (name === 'checklists') return { ...row, checklist_items: tables.checklist_items.filter((item) => item.checklist_id === row.id) };
  if (name === 'checklist_runs') return { ...row, checklist_run_items: tables.checklist_run_items.filter((item) => item.run_id === row.id) };
  return row;
}
function normalize(name, row) {
  const result = { ...row };
  if (name === 'tasks') { result.status ??= 'open'; result.cadence ??= 'once'; }
  if (name === 'transactions') {
    result.currency ??= tables.workspaces.find((ws) => ws.id === row.workspace_id)?.currency || 'KES';
    result.fx_rate = result.currency === tables.workspaces.find((ws) => ws.id === row.workspace_id)?.currency ? 1 : Number(result.fx_rate || 1);
    result.amount_base = Math.round(Number(result.amount) * result.fx_rate);
  }
  if (name === 'workers') result.active ??= true;
  return result;
}
const membership = (identity, workspace) => tables.workspace_members.find((m) => m.user_id === user(identity).id && m.workspace_id === workspace);
const farmAllowed = (member, farm) => Boolean(member && (member.farm_scope !== 'farms' || (farm && member.farm_ids?.includes(farm))));
const moduleFor = (name) => ({ tasks:'daily',checklists:'daily',checklist_items:'daily',checklist_runs:'daily',checklist_run_items:'daily',categories:'finances',transactions:'finances',budgets:'finances',month_closings:'finances',recurring_payments:'finances',fx_rates:'finances',vendor_bills:'finances',projects:'infrastructure',enterprises:'livestock',enterprise_records:'livestock',funding_opportunities:'funding',audit_log:'audit' })[name] || name;
const farmFor = (name, row) => name === 'farms' ? row.id : name === 'enterprise_records' ? tables.enterprises.find((e) => e.id === row.enterprise_id)?.farm_id : name === 'checklist_run_items' ? tables.checklist_runs.find((r) => r.id === row.run_id)?.farm_id : row.farm_id;
function canRead(identity, name, row) {
  if (['currencies','seed_merchants'].includes(name)) return true;
  if (name === 'profiles') return row.id === user(identity).id;
  if (name === 'account_notification_preferences') return row.user_id === user(identity).id;
  if (name === 'workspaces') return Boolean(membership(identity, row.id));
  const member = membership(identity, row.workspace_id); if (!member) return false;
  if (name === 'workspace_members') return true;
  if (name === 'enterprises' && has(member.role,'finance.read')) return farmAllowed(member,row.farm_id);
  if (['workers','projects'].includes(name) && !has(member.role,'finance.read')) return false;
  if (!canReadModule(member.role,moduleFor(name))) return false;
  return ['categories','fx_rates','checklists','checklist_items'].includes(name) || farmAllowed(member,farmFor(name,row));
}
function canWrite(identity, name, row, method) {
  if (name === 'profiles') return row.id === user(identity).id;
  if (name === 'account_notification_preferences') return row.user_id === user(identity).id;
  if (['currencies','seed_merchants','workspace_members','workspace_invites','audit_log'].includes(name)) return false;
  if (name === 'workspaces') return method === 'POST' || membership(identity,row.id)?.role === 'owner';
  const member = membership(identity,row.workspace_id); if (!member || !canWriteModule(member.role,moduleFor(name))) return false;
  if (member.role === 'worker' && (!['tasks','checklist_runs','checklist_run_items','enterprise_records'].includes(name) || method === 'DELETE')) return false;
  if (['categories','fx_rates','checklists','checklist_items'].includes(name)) return member.farm_scope !== 'farms' && member.role !== 'worker';
  if (name === 'farms' && method === 'POST' && member.farm_scope === 'farms') return false;
  return farmAllowed(member,farmFor(name,row));
}

// This is a LOCAL EXAMPLE of the proposed SQL response, not a production
// accounting engine or proof of RLS. Exported solely for preview contract tests.
export function sampleDashboard(identity,{p_workspace_id:ws,p_from:from,p_to:to,p_farm_id:farm=null}){
  const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day||'')&&!Number.isNaN(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
  if(!validDay(from)||!validDay(to)||to<=from||(Date.parse(to)-Date.parse(from))/86400000>3660)throw new Error('Choose a valid sample date range (end exclusive, at most 3660 days).');
  const actor=membership(identity,ws),workspace=tables.workspaces.find(w=>w.id===ws);
  if(!actor||!workspace)throw Object.assign(new Error('Sample workspace unavailable.'),{status:403});
  const farms=tables.farms.filter(f=>f.workspace_id===ws&&farmAllowed(actor,f.id)&&(!farm||f.id===farm));
  if(farm&&!farms.length)throw Object.assign(new Error('The selected sample farm is unavailable.'),{status:403});
  const finance=has(actor.role,'finance.read'),operations=has(actor.role,'operations.read');
  const rows=name=>tables[name].filter(r=>r.workspace_id===ws&&farmAllowed(actor,r.farm_id)&&(!farm||r.farm_id===farm));
  const selected=(r,a=from,b=to)=>r.txn_date>=a&&r.txn_date<b;
  const total=(array,get=r=>r.amount_base)=>array.reduce((n,r)=>n+Number(get(r)||0),0);
  const calendarMonths=(Number(to.slice(0,4))-Number(from.slice(0,4)))*12+Number(to.slice(5,7))-Number(from.slice(5,7));
  const previousFrom=from.endsWith('-01')&&to.endsWith('-01')?addMonths(from,-calendarMonths):addDays(from,-Math.round((Date.parse(to)-Date.parse(from))/86400000)),lastMonth=addDays(to,-1).slice(0,7)+'-01';
  const trendFrom=[from.slice(0,7)+'-01',addMonths(lastMonth,-5)].sort()[0],months=[];
  for(let m=trendFrom;m<=lastMonth;m=addMonths(m,1))months.push(m);
  const kpi=(value,previous,unit,available,sparkline=[])=>({available,value:available?value:null,previous:available?previous:null,
    change:available&&value!=null&&previous!=null?value-previous:null,
    change_pct:available&&value!=null&&previous?Math.round((value-previous)/Math.abs(previous)*10000)/100:null,
    trend:!available||value==null||previous==null?'unavailable':value===previous?'flat':previous===0?'new':value>previous?'up':'down',unit,sparkline:available?sparkline:[]});
  const unavailable=kpi(null,null,'currency',false),attention=[];
  const result={version:'20261118-dashboard-v1',workspace:{id:ws,name:workspace.name,currency:workspace.currency,exponent:tables.currencies.find(c=>c.code===workspace.currency)?.exponent??2},
    scope:{from,to_exclusive:to,previous_from:previousFrom,previous_to_exclusive:from,farm_id:farm,as_of:date,time_zone:'Africa/Nairobi',role:actor.role,finance,operations,trend_from:trendFrom,trend_to_exclusive:addMonths(lastMonth,1),farm_filter:'Selected farm excludes shared/unassigned records'},
    kpis:{income:unavailable,expenses:unavailable,net:unavailable,recorded_cash:unavailable,task_completion:kpi(null,null,'count',false)},tasks:null,
    series:{monthly:[],recorded_cash:[],task_completion:[]},expense_categories:[],budgets:{expenses:[],income:[]},farm_comparison:[],enterprise_profitability:[],payroll:null,top_vendors:[],cash_coverage:null,attention,
    notes:['LOCAL SIMULATION: these invented figures demonstrate the proposed database response; they are not live farm data or an RLS test.',
      'Money values are integer minor units. Original-currency obligations are labeled separately.',
      'Monthly trends use complete calendar months. KPIs use the exact selected dates.',
      'Recorded cash sums saved snapshots in that exact month. Missing months remain unavailable.',
      'Task history includes each task latest stored completion only. Current task progress uses the farm calendar.',
      'Budgets cover whole months; attention items refer to today, independently of the selected period.',
      'Worker reminders show configured pay rates and missing monthly postings, not verified debt.']};
  const action=(module,id,filters={},tab)=>({module,...(id?{id}:{}),...(tab?{tab}:{}),filters});
  if(finance){
    const tx=rows('transactions'),current=tx.filter(r=>selected(r)),prior=tx.filter(r=>selected(r,previousFrom,from));
    const byKind=(items,kind)=>total(items.filter(r=>r.kind===kind)),income=byKind(current,'income'),expenses=byKind(current,'expense'),pi=byKind(prior,'income'),pe=byKind(prior,'expense');
    result.series.monthly=months.map(m=>{const items=tx.filter(r=>selected(r,m,addMonths(m,1))),i=byKind(items,'income'),e=byKind(items,'expense');return{month:m,income:i,expenses:e,net:i-e};});
    for(const key of ['income','expenses','net'])result.kpis[key]=kpi(key==='income'?income:key==='expenses'?expenses:income-expenses,key==='income'?pi:key==='expenses'?pe:pi-pe,'currency',true,result.series.monthly.map(r=>({month:r.month,value:r[key]})));
    const cash=m=>{const items=rows('month_closings').filter(r=>r.month===m),known=new Set(items.map(r=>r.farm_id).filter(Boolean)).size;return{month:m,value:items.length?total(items,r=>r.closing_cash):null,recorded_rows:items.length,known_farms:known,total_farms:farms.length,shared_rows:items.filter(r=>!r.farm_id).length,complete:known===farms.length&&known>0,source:'recorded_month_sum'};};
    result.series.recorded_cash=months.map(cash);result.cash_coverage=cash(lastMonth);delete result.cash_coverage.value;
    result.kpis.recorded_cash=kpi(cash(lastMonth).value,cash(addDays(from,-1).slice(0,7)+'-01').value,'currency',true,result.series.recorded_cash.map(r=>({month:r.month,value:r.value})));
    const categories=new Map();for(const t of current.filter(r=>r.kind==='expense')){const id=t.category_id??null;categories.set(id,(categories.get(id)||0)+t.amount_base);}
    result.expense_categories=[...categories].map(([id,amount])=>({id,name:tables.categories.find(c=>c.id===id&&c.workspace_id===ws)?.name||'Uncategorised',amount,pct:expenses?Math.round(amount/expenses*10000)/100:null})).sort((a,b)=>b.amount-a.amount);
    const plans=new Map();for(const b of rows('budgets').filter(b=>b.month>=from.slice(0,7)+'-01'&&b.month<addMonths(lastMonth,1)))plans.set(b.category_id,(plans.get(b.category_id)||0)+b.amount);
    result.budgets={expenses:[],income:[],from:from.slice(0,7)+'-01',to_exclusive:addMonths(lastMonth,1),actual_from:from,actual_to_exclusive:to};
    for(const[id,budget]of plans){const c=tables.categories.find(c=>c.workspace_id===ws&&c.id===id);if(!c)continue;const actual=total(current.filter(t=>t.kind===c.kind&&t.category_id===id));result.budgets[c.kind==='income'?'income':'expenses'].push({farm_id:farm,category_id:id,name:c.name,budget,actual,remaining:budget-actual,pct:budget?Math.round(actual/budget*10000)/100:null});}
    result.farm_comparison=farms.map(f=>{const items=current.filter(t=>t.farm_id===f.id),i=byKind(items,'income'),e=byKind(items,'expense');return{id:f.id,name:f.name,income:i,expenses:e,net:i-e,open_tasks:null};});
    if(current.some(t=>!t.farm_id)){const items=current.filter(t=>!t.farm_id),i=byKind(items,'income'),e=byKind(items,'expense');result.farm_comparison.push({id:null,name:'Shared / unassigned',income:i,expenses:e,net:i-e,open_tasks:null});}
    result.enterprise_profitability=rows('enterprises').map(e=>{const items=current.filter(t=>t.enterprise_id===e.id),i=byKind(items,'income'),exp=byKind(items,'expense');return{id:e.id,name:e.name,farm_id:e.farm_id,linked_count:items.length,income:items.length?i:null,expenses:items.length?exp:null,margin:items.length?i-exp:null};});
    const pay=total(current.filter(t=>t.kind==='expense'&&t.source_type==='worker_pay'));result.payroll={amount:pay,expense_total:expenses,pct:expenses?Math.round(pay/expenses*10000)/100:null};
    const vendors=new Map();for(const t of current.filter(t=>t.kind==='expense')){const id=t.vendor_id??null,v=vendors.get(id)||{id,name:rows('vendors').find(v=>v.id===id)?.name||'Unspecified vendor',amount:0,count:0};v.amount+=t.amount_base;v.count++;vendors.set(id,v);}result.top_vendors=[...vendors.values()].sort((a,b)=>b.amount-a.amount).slice(0,8);
    for(const b of rows('vendor_bills').filter(b=>b.amount>b.paid_amount&&b.due_on&&b.due_on<=addDays(date,14)))attention.push({kind:'bill_due',title:'Bill: '+(rows('vendors').find(v=>v.id===b.vendor_id)?.name||b.description||'Vendor'),severity:b.due_on<date?'danger':'warning',date:b.due_on,amount:b.amount-b.paid_amount,currency:b.currency,action:action('vendors',b.id,{farm_id:b.farm_id,vendor_id:b.vendor_id,status:'outstanding'},'bills')});
    for(const w of rows('workers').filter(w=>w.active&&w.pay_amount>0&&(!w.start_date||w.start_date<=date)&&(!w.end_date||w.end_date>=date)))if(!tx.some(t=>t.source_type==='worker_pay'&&t.source_id===w.id&&t.source_period===month&&t.kind==='expense'&&t.farm_id===w.farm_id))attention.push({kind:'worker_payment_unrecorded',title:`Pay posting missing (${w.pay_frequency} rate): ${w.full_name}`,severity:'info',date,amount:w.pay_amount,currency:w.currency,action:action('workers',w.id,{farm_id:w.farm_id,worker_id:w.id},'payroll')});
    for(const rp of rows('recurring_payments').filter(r=>r.active&&r.kind==='expense'))for(const m of [month,addMonths(month,1)]){const due=addDays(m,rp.day_of_month-1);if(due<=addDays(date,14)&&!tx.some(t=>t.source_type==='recurring'&&t.source_id===rp.id&&t.source_period===m&&t.kind==='expense'&&t.farm_id===rp.farm_id))attention.push({kind:'recurring_payment_unrecorded',title:'Not posted: '+rp.name,severity:due<date?'warning':'info',date:due,amount:rp.amount,currency:rp.currency,action:action('finances',rp.id,{farm_id:rp.farm_id,month:m},'recurring')});}
    if(!farm)for(const g of rows('funding_opportunities').filter(g=>['identified','eligible','preparing'].includes(g.status)&&g.deadline>=addDays(date,-30)&&g.deadline<=addDays(date,30)))attention.push({kind:'grant_deadline',title:'Deadline: '+g.name,severity:g.deadline<date?'danger':'warning',date:g.deadline,amount:g.amount??null,currency:g.currency,action:action('funding',g.id,{status:g.status})});
    for(const b of rows('budgets').filter(b=>b.month===month&&b.amount>0)){const c=tables.categories.find(c=>c.id===b.category_id&&c.workspace_id===ws),actual=total(tx.filter(t=>t.kind==='expense'&&t.category_id===b.category_id&&t.farm_id===b.farm_id&&selected(t,month,addMonths(month,1))));if(c?.kind==='expense'&&actual>=b.amount*.9)attention.push({kind:'expense_budget_near',title:'Budget: '+c.name,severity:actual>b.amount?'danger':'warning',date:addDays(addMonths(month,1),-1),amount:actual,currency:workspace.currency,action:action('finances',b.id,{farm_id:b.farm_id,category_id:b.category_id},'budgets')});}
  }
  if(operations){
    const tasks=rows('tasks').map(t=>{const completed=t.done_at?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t.done_at)):null;return{...t,completed,effective_done:t.status==='done'&&(t.cadence==='daily'?completed===date:t.cadence==='monthly'?completed?.slice(0,7)===date.slice(0,7):true)};}),completed=tasks.filter(t=>t.effective_done).length;
    result.tasks={completed,open:tasks.length-completed,overdue:tasks.filter(t=>!t.effective_done&&t.due_date&&t.due_date<date).length,total:tasks.length,pct:tasks.length?Math.round(completed/tasks.length*10000)/100:null,as_of:date};
    const completions=(a,b)=>tasks.filter(t=>t.completed>=a&&t.completed<b).length;
    result.kpis.task_completion=kpi(completions(from,to),completions(previousFrom,from),'count',true,months.map(m=>({month:m,value:completions(m,addMonths(m,1))})));
    for(let day=from;day<to;day=addDays(day,1))result.series.task_completion.push({date:day,completed:completions(day,addDays(day,1))});
    const taskFarms=farms.map(f=>({id:f.id,name:f.name,open_tasks:tasks.filter(t=>t.farm_id===f.id&&!t.effective_done).length}));if(tasks.some(t=>!t.farm_id))taskFarms.push({id:null,name:'Shared / unassigned',open_tasks:tasks.filter(t=>!t.farm_id&&!t.effective_done).length});
    if(finance)for(const f of result.farm_comparison)f.open_tasks=taskFarms.find(t=>t.id===f.id)?.open_tasks??0;else result.farm_comparison=taskFarms;
    for(const t of tasks.filter(t=>!t.effective_done&&t.due_date&&t.due_date<date))attention.push({kind:'overdue_task',title:t.title,severity:'danger',date:t.due_date,action:action('daily',t.id,{farm_id:t.farm_id,status:'open',q:t.title},'tasks')});
  }
  attention.sort((a,b)=>(['danger','warning','info'].indexOf(a.severity)-['danger','warning','info'].indexOf(b.severity))||a.date.localeCompare(b.date)||a.title.localeCompare(b.title));result.attention_count=attention.length;return result;
}

// Simulated finance responses for invented LOCAL SAMPLE records only. The real
// calculation/authorization is the SECURITY INVOKER SQL, not these JS helpers.
export function sampleTransactionTotals(identity,{p_workspace_id:ws,p_from:from,p_to:to,p_farm_id:farm=null,p_filters:filters={}}){
  const actor=membership(identity,ws),validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day||'')&&!Number.isNaN(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
  if(!actor||!has(actor.role,'finance.read'))throw Object.assign(new Error('Sample financial access is required.'),{status:403});
  if(!validDay(from)||!validDay(to)||to<=from||(Date.parse(to)-Date.parse(from))/86400000>3660)throw new Error('Choose a valid sample date range.');
  if(farm&&!tables.farms.some(row=>row.id===farm&&row.workspace_id===ws&&canRead(identity,'farms',row)))throw Object.assign(new Error('Sample farm unavailable.'),{status:403});
  filters??={};const allowed=['kind','category_id','vendor_id','enterprise_id','source_type','source_id','id','q'];
  if(typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(k=>!allowed.includes(k)))throw new Error('Choose supported sample filters.');
  if('kind'in filters&&!['income','expense'].includes(filters.kind)||'source_type'in filters&&filters.source_type!==null&&!['worker_pay','recurring','project'].includes(filters.source_type))throw new Error('Choose a valid sample transaction type.');
  if('q'in filters&&filters.q!==null&&typeof filters.q!=='string')throw new Error('Enter a text search.');
  const query=String(filters.q??'').toLowerCase(),reference=(table,id)=>tables[table].find(row=>row.id===id&&row.workspace_id===ws&&canRead(identity,table,row));
  const rows=tables.transactions.filter(row=>row.workspace_id===ws&&canRead(identity,'transactions',row)&&(!farm||row.farm_id===farm)&&row.txn_date>=from&&row.txn_date<to
    &&Object.entries(filters).every(([key,value])=>key==='q'||(row[key]??null)===value)).filter(row=>{
    if(!query)return true;const category=reference('categories',row.category_id),vendor=reference('vendors',row.vendor_id),f=reference('farms',row.farm_id),enterprise=reference('enterprises',row.enterprise_id);
    return[row.description||'',category?`${category.name} (${category.kind})`:'',vendor?.name||'',f?.name||'',enterprise&&(!farm||enterprise.farm_id===farm)?enterprise.name:''].some(value=>value.toLowerCase().includes(query));
  });
  const income=rows.filter(r=>r.kind==='income').reduce((sum,r)=>sum+r.amount_base,0),expenses=rows.filter(r=>r.kind==='expense').reduce((sum,r)=>sum+r.amount_base,0);
  return{schema_version:'20261118-finance',income,expenses,net:income-expenses,count:rows.length};
}
export function sampleFinanceMonth(identity,{p_workspace_id:ws,p_month:period,p_farm_id:farm=null}){
  if(!/^\d{4}-\d{2}-01$/.test(period||''))throw new Error('Choose the first day of the sample month.');
  const to=addMonths(period,1),prior=addMonths(period,-1),totals=sampleTransactionTotals(identity,{p_workspace_id:ws,p_from:period,p_to:to,p_farm_id:farm});
  const visible=name=>tables[name].filter(row=>row.workspace_id===ws&&canRead(identity,name,row)&&(!farm||row.farm_id===farm));
  const cash=visible('month_closings'),previous=cash.filter(row=>row.month===prior),current=cash.filter(row=>row.month===period),opening=previous.reduce((sum,row)=>sum+row.closing_cash,0);
  const cats=tables.categories.filter(row=>row.workspace_id===ws&&canRead(identity,'categories',row)),lines=new Map(),key=(id,kind)=>`${id??'null'}|${kind}`;
  const line=(id,kind)=>{const k=key(id,kind),c=cats.find(c=>c.id===id);if(!lines.has(k))lines.set(k,{id:id??null,kind,name:id==null?'Uncategorised':c?.name||'Unknown category',budget:0,actual:0,can_budget:Boolean(c&&c.kind===kind&&farm&&canWrite(identity,'budgets',{workspace_id:ws,farm_id:farm},'POST'))});return lines.get(k);};
  for(const c of cats)line(c.id,c.kind);for(const row of visible('transactions').filter(row=>row.txn_date>=period&&row.txn_date<to))line(row.category_id,row.kind).actual+=row.amount_base;
  for(const row of visible('budgets').filter(row=>row.month===period))line(row.category_id,cats.find(c=>c.id===row.category_id)?.kind||'unknown').budget+=row.amount;
  const categories=[...lines.values()].map(row=>({...row,variance:row.kind==='expense'?row.budget-row.actual:row.kind==='income'?row.actual-row.budget:null,pct:row.budget?Math.round(row.actual/row.budget*10000)/100:null,over_budget:row.kind==='expense'&&row.budget>0&&row.actual>row.budget}));
  const sections=Object.fromEntries(['income','expense','unknown'].map(kind=>[kind,{budget:categories.filter(row=>row.kind===kind).reduce((sum,row)=>sum+row.budget,0),actual:categories.filter(row=>row.kind===kind).reduce((sum,row)=>sum+row.actual,0)}]));
  return{schema_version:'20261118-finance',period:{from:period,to},currency:tables.workspaces.find(w=>w.id===ws).currency,totals:{income:totals.income,expenses:totals.expenses,net:totals.net,opening,calculated_closing:opening+totals.net,saved_closing:current.length?current.reduce((sum,row)=>sum+row.closing_cash,0):null,opening_recorded:previous.length>0},categories,sections};
}
async function rpc(req,res,name,identity) {
  const data=await body(req), ws=data.p_workspace_id, actor=membership(identity,ws), fail=(message)=>failure(res,403,message);
  const tableResult=rows=>{
    const params=new URL(req.url,'http://127.0.0.1').searchParams,fields=(params.get('order')||'').split(',').filter(Boolean).map(part=>part.split('.'));
    rows.sort((a,b)=>{for(const[key,direction]of fields){const x=a[key],y=b[key];if(x===y)continue;return(x==null?1:y==null?-1:x<y?-1:1)*(direction==='desc'?-1:1);}return 0;});
    const offset=Number(params.get('offset')||0),limit=Number(params.get('limit')||1000);return json(res,200,rows.slice(offset,offset+limit));
  };
  const uid=user(identity).id,profile=tables.profiles.find(p=>p.id===uid),notifications=tables.account_notification_preferences.find(p=>p.user_id===uid)||{user_id:uid,in_app:true,email:false,tasks:true,bills:true,invitations:true};
  const myWorkspaces=()=>tables.workspace_members.filter(m=>m.user_id===uid).map(m=>({...tables.workspaces.find(w=>w.id===m.workspace_id),role:m.role,farm_scope:m.farm_scope}));
  const myInvites=()=>tables.workspace_invites.filter(i=>i.email===user(identity).email&&i.status==='pending'&&new Date(i.expires_at)>new Date());
  if(name==='fw_invitation_verification')return json(res,200,{needs_recovery:true,proof_recent:false});
  if(name==='fw_complete_invite_recovery')return fail('Email recovery is disconnected in this LOCAL SAMPLE. No real mailbox or recovery proof can be verified.');
  if(name==='fw_account_context')return json(res,200,{schema_version:'20261118-account',profile,notifications});
  if(name==='fw_account_workspaces')return json(res,200,myWorkspaces());
  if(name==='fw_account_sessions')return json(res,200,{available:true,sessions:[{id:`preview-session-${identity}`,created_at:at,updated_at:new Date().toISOString(),user_agent:'Local sample browser (simulated)',ip:'127.0.0.1',current:true}]});
  if(name==='fw_account_invites')return json(res,200,myInvites().map(i=>({id:i.id,workspace_id:i.workspace_id,workspace_name:tables.workspaces.find(w=>w.id===i.workspace_id)?.name||'Sample workspace',role:i.role,farm_ids:i.farm_ids,expires_at:i.expires_at})));
  if(name==='fw_account_delete_status')return json(res,200,{schema_version:'20261118-account',owned_workspaces:myWorkspaces().filter(w=>w.role==='owner').map(w=>({id:w.id,name:w.name})),business_files:0,avatar_paths:[],session_active:true});
  if(name==='fw_account_export')return json(res,200,{exported_at:new Date().toISOString(),scope:'LOCAL SAMPLE account data only. No real account or farm records.',identity:{id:uid,email:user(identity).email,email_confirmed_at:at,created_at:at},profile,notification_preferences:notifications,memberships:myWorkspaces(),pending_invitations:myInvites().map(({token,...i})=>i)});
  if(name==='fw_decline_account_invite'){const i=myInvites().find(i=>i.id===data.p_invite_id);if(!i)return fail('This sample invitation is unavailable.');i.status='declined';return json(res,200,null);}
  if(name==='fw_leave_workspace'){if(!actor)return fail('Sample membership unavailable.');if(actor.role==='owner')return fail('Transfer your owner role before leaving this sample workspace.');tables.workspace_members=tables.workspace_members.filter(m=>m!==actor);if(profile.active_workspace===ws)profile.active_workspace=null;return json(res,200,null);}
  if(name==='fw_accept_account_invite'){const i=myInvites().find(i=>i.id===data.p_invite_id);if(!i||membership(identity,i.workspace_id))return fail('This sample invitation is unavailable.');tables.workspace_members.push({workspace_id:i.workspace_id,user_id:uid,role:i.role,farm_scope:i.farm_ids==null?'all':'farms',farm_ids:i.farm_ids||[],created_at:at});i.status='accepted';return json(res,200,i.workspace_id);}
  if (name === 'fw_accept_invite') {
    const invitation=tables.workspace_invites.find((i)=>i.token===data.p_token && i.status==='pending' && i.email.toLowerCase()===user(identity).email.toLowerCase() && new Date(i.expires_at)>new Date());
    if(!invitation)return fail('This sample invitation is unavailable for this signed-in account.');
    if(!membership(identity,invitation.workspace_id))tables.workspace_members.push({user_id:user(identity).id,workspace_id:invitation.workspace_id,role:invitation.role,farm_scope:invitation.farm_ids==null?'all':'farms',farm_ids:invitation.farm_ids||[],created_at:new Date().toISOString()});
    invitation.status='accepted';invitation.accepted_at=new Date().toISOString();return json(res,200,invitation.workspace_id);
  }
  if(!actor)return fail('Sample workspace unavailable.');
  if(name==='fw_dashboard'){try{return json(res,200,sampleDashboard(identity,data));}catch(error){return failure(res,error.status||400,error.message);}}
  if(['fw_transaction_totals','fw_finance_month','fw_close_month'].includes(name)){
    try{
      if(name==='fw_transaction_totals')return json(res,200,sampleTransactionTotals(identity,data));
      let result=sampleFinanceMonth(identity,data);
      if(name==='fw_close_month'){
        if(!data.p_farm_id)throw new Error('Choose one sample farm before closing its month.');
        const row={workspace_id:ws,farm_id:data.p_farm_id,month:data.p_month,closing_cash:result.totals.calculated_closing};
        if(!canWrite(identity,'month_closings',row,'POST'))return fail('Sample closing permission required.');
        const old=tables.month_closings.find(r=>r.workspace_id===ws&&r.farm_id===row.farm_id&&r.month===row.month);if(old)Object.assign(old,row);else tables.month_closings.push({...row,id:randomUUID()});
        result=sampleFinanceMonth(identity,data);
      }
      return json(res,200,result);
    }catch(error){return failure(res,error.status||400,error.message);}
  }
  if(name==='fw_access_context')return json(res,200,{schema_version:'20261118',role:actor.role,farm_scope:actor.farm_scope,farm_ids:actor.farm_ids||[]});
  if(['fw_operational_workers','fw_operational_projects'].includes(name)) {
    const source=name.endsWith('workers')?'workers':'projects', fields=source==='workers'?['id','workspace_id','farm_id','full_name','role','start_date','end_date','active']:['id','workspace_id','farm_id','name','status','start_date','end_date','notes'];
    return tableResult(tables[source].filter((r)=>r.workspace_id===ws&&farmAllowed(actor,r.farm_id)).map((r)=>Object.fromEntries(fields.map((f)=>[f,r[f]??null]))));
  }
  if(!canManageMembers(actor.role))return fail('Only a sample owner or administrator manages team access.');
  if(name==='fw_list_members')return tableResult(tables.workspace_members.filter((m)=>m.workspace_id===ws).map((m)=>({...m,full_name:tables.profiles.find((p)=>p.id===m.user_id)?.full_name||'Sample teammate',email:`${m.user_id.replace('preview-','')}@fieldwork.test`})));
  if(name==='fw_list_invites')return tableResult(tables.workspace_invites.filter((i)=>i.workspace_id===ws).map(({token,...i})=>i));
  const target=tables.workspace_members.find((m)=>m.workspace_id===ws&&m.user_id===data.p_user_id);
  const validate=(oldRole,nextRole,farmIds)=>canManageMember(actor.role,oldRole,nextRole)&&(!['owner','admin'].includes(nextRole)||farmIds==null)&&(!farmIds||farmIds.length>0&&farmIds.every((id)=>tables.farms.some((f)=>f.id===id&&f.workspace_id===ws)));
  if(name==='fw_create_invite') {
    if(!validate('worker',data.p_role,data.p_farm_ids))return fail('Choose an allowed sample role and farm assignment.');
    if(tables.workspace_members.some((m)=>m.workspace_id===ws&&`${m.user_id.replace('preview-','')}@fieldwork.test`===data.p_email.toLowerCase()))return failure(res,400,'This sample account is already a member.');
    const invitation={id:randomUUID(),workspace_id:ws,email:data.p_email.toLowerCase(),role:data.p_role,farm_ids:data.p_farm_ids??null,status:'pending',token:randomBytes(32).toString('hex'),created_at:new Date().toISOString(),expires_at:new Date(Date.now()+7*86400000).toISOString(),created_by:user(identity).id};tables.workspace_invites.push(invitation);return json(res,200,invitation);
  }
  if(name==='fw_revoke_invite') {const i=tables.workspace_invites.find((i)=>i.id===data.p_invite_id&&i.workspace_id===ws);if(!i||!canManageMember(actor.role,i.role))return fail('This invitation cannot be revoked by this sample role.');i.status='revoked';return json(res,200,null);}
  if(['fw_change_member','fw_remove_member'].includes(name)) {
    if(!target||!validate(target.role,name==='fw_remove_member'?target.role:data.p_role,data.p_farm_ids))return fail('This member cannot be changed by this sample role.');
    if(target.role==='owner'&&(name==='fw_remove_member'||data.p_role!=='owner')&&tables.workspace_members.filter((m)=>m.workspace_id===ws&&m.role==='owner').length<=1)return fail('The sample workspace must keep an owner.');
    if(name==='fw_remove_member')tables.workspace_members=tables.workspace_members.filter((m)=>m!==target);
    else Object.assign(target,{role:data.p_role,farm_scope:data.p_farm_ids==null?'all':'farms',farm_ids:data.p_farm_ids||[]});return json(res,200,null);
  }
  return failure(res,404,'This operation is not simulated by the sample preview.');
}
async function rest(req, res, url) {
  const role = token(req), name = url.pathname.slice('/__preview/rest/v1/'.length);
  if (!role) return failure(res, 401, 'Use a sample @fieldwork.test account.');
  if(name.startsWith('rpc/'))return rpc(req,res,name.slice(4),role);
  if (!tables[name]) return failure(res, 404, 'Sample table not found.');
  const readable = (row) => canRead(role,name,row);
  let rows = tables[name].filter((row) => readable(row) && matches(row, url.searchParams));
  if (req.method === 'GET') {
    const order = url.searchParams.get('order') || '';
    if (['projects','enterprises'].includes(name) && order.split(',').some((part) => part.split('.')[0] === 'created_at')) return failure(res, 400, `column ${name}.created_at does not exist`);
    const fields = order.split(',').filter(Boolean).map((part) => part.split('.'));
    rows.sort((a, b) => { for (const [key, direction] of fields) { const x = a[key], y = b[key]; if (x === y) continue; return (x == null ? 1 : y == null ? -1 : x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1); } return 0; });
    const start = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
    return json(res, 200, rows.slice(start, start + limit).map((row) => related(name, row)));
  }
  if(rows.some((row)=>!canWrite(role,name,row,req.method)))return failure(res,403,'This sample role cannot change that record.');
  if (req.method === 'DELETE') { tables[name] = tables[name].filter((row) => !rows.includes(row)); return json(res, 200, []); }
  const data = await body(req);
  if (req.method === 'PATCH') {
    const updated = rows.map((row) => { Object.assign(row, normalize(name, { ...row, ...data })); return row; });
    return json(res, 200, updated);
  }
  if (req.method !== 'POST') return failure(res, 405, 'Sample operation unsupported.');
  const conflict = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean), inserted = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if(!canWrite(role,name,item,req.method))return failure(res,403,'This sample role cannot add that record.');
    if (item.workspace_id && !tables.workspace_members.some((m) => m.user_id === user(role).id && m.workspace_id === item.workspace_id)) return failure(res, 403, 'Sample workspace unavailable.');
    const existing = conflict.length && tables[name].find((row) => conflict.every((key) => row[key] === item[key]));
    if (existing) { Object.assign(existing, normalize(name, { ...existing, ...item })); inserted.push(existing); continue; }
    if (name === 'transactions' && item.source_type && tables.transactions.some((row) => row.source_type === item.source_type && row.source_id === item.source_id && row.source_period === item.source_period)) return failure(res, 409, 'This sample payment is already posted.');
    const row = normalize(name, { ...(!['projects','enterprises','categories','currencies','fx_rates'].includes(name) ? { created_at: new Date().toISOString() } : {}), id: randomUUID(), ...item });
    tables[name].push(row); inserted.push(row);
    if (name === 'workspaces') tables.workspace_members.push({ workspace_id: row.id, user_id: user(role).id, role: 'owner' });
  }
  return json(res, 201, inserted);
}

export async function previewRequest(req, res) {
  try {
    const origin = `http://127.0.0.1:${server.address()?.port??port}`, url = new URL(req.url, origin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'");
    if (url.pathname === '/api/config') return json(res, 200, { url: `${origin}/__preview`, anonKey: 'LOCAL_PREVIEW_NOT_A_KEY' });
    if(url.pathname==='/api/account'){
      const identity=token(req);if(!identity)return failure(res,401,'Use a signed-in sample account.');
      if(req.method==='GET')return json(res,200,{delete_available:false,message:'Account deletion is not simulated in this local preview. No real account is connected.'});
      const data=await body(req);if(req.method==='POST'&&['change_password','change_email'].includes(data.action))return json(res,200,{user:{...user(identity),...(data.action==='change_email'?{new_email:data.email}:{})},verification_required:data.action==='change_email',simulated:true});
      return failure(res,503,'Account deletion and real security changes are unavailable in this local sample.');
    }
    if (url.pathname.startsWith('/__preview/auth/v1/')) {
      const data = req.method === 'GET' ? {} : await body(req);
      if(url.pathname.endsWith('/settings')&&req.method==='GET')return json(res,200,{external:{google:false,email:true},disable_signup:false});
      if (url.pathname.endsWith('/token') || url.pathname.endsWith('/signup')) {
        const role = roles.find((r) => data.email?.toLowerCase()===`${r}@fieldwork.test` || data.refresh_token === `preview-refresh-${r}`);
        if(!role)return failure(res,400,'Use owner, admin, manager, accountant, worker or viewer @fieldwork.test with a dummy password.');
        return json(res, 200, authSession(role));
      }
      const identity=token(req);
      if (url.pathname.endsWith('/user')) return identity ? json(res, 200, user(identity)) : failure(res, 401, 'Sample session expired.');
      if(url.pathname.endsWith('/logout'))return json(res,200,{});
      if(/\/(?:recover|otp|resend|reauthenticate|authorize)$/.test(url.pathname))return failure(res,400,'Email delivery and Google sign-in are not connected in this LOCAL SAMPLE. Use a sample email and dummy password.');
      if(!identity)return failure(res,401,'Sample session expired.');
      if(url.pathname.endsWith('/factors')&&req.method==='POST'){
        const factor={id:randomUUID(),factor_type:'totp',friendly_name:data.friendly_name||'Sample authenticator',status:'unverified',created_at:at};identities.get(identity).factors.push(factor);
        return json(res,200,{...factor,type:'totp',totp:{secret:'LOCAL_SAMPLE_NOT_A_REAL_MFA_SECRET',uri:'otpauth://totp/LOCAL_SAMPLE?secret=LOCAL_SAMPLE_ONLY',qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><text x="12" y="70" font-size="14">LOCAL SAMPLE ONLY</text><text x="12" y="100" font-size="12">Use code 000000</text></svg>'}});
      }
      const factorMatch=/\/factors\/([0-9a-f-]+)(?:\/(challenge|verify))?$/.exec(url.pathname);
      if(factorMatch){const factor=identities.get(identity).factors.find(f=>f.id===factorMatch[1]);if(!factor)return failure(res,404,'Sample authenticator unavailable.');
        if(req.method==='DELETE'){identities.get(identity).factors=identities.get(identity).factors.filter(f=>f!==factor);return json(res,200,{id:factor.id});}
        if(factorMatch[2]==='challenge')return json(res,200,{id:randomUUID(),expires_at:Math.floor(Date.now()/1000)+300});
        if(factorMatch[2]==='verify'){if(data.code!=='000000')return failure(res,400,'This local sample accepts the invented code 000000 only.');factor.status='verified';return json(res,200,authSession(identity,'aal2'));}
      }
      return failure(res, 404, 'Sample auth operation unsupported.');
    }
    if (url.pathname.startsWith('/__preview/rest/v1/')) return await rest(req, res, url);
    const pathname = decodeURIComponent(url.pathname), localPath = pathname === '/' ? '/index.html' : pathname;
    if (!/^\/(?:index\.html|icon\.svg|manifest\.webmanifest|(?:css|js)\/[\w./-]+\.(?:css|js))$/.test(localPath)) return failure(res, 404, 'Only application assets are served.');
    const file = path.resolve(root, `.${localPath}`);
    if (!file.startsWith(root)) return failure(res, 403, 'Unavailable path.');
    let content = await readFile(file);
    if (localPath === '/index.html') content = Buffer.from(content.toString().replace('<body>', '<body><aside role="status" style="padding:4px 16px;background:var(--badge-warn-bg);color:var(--badge-warn-text);border-bottom:1px solid var(--border);font:500 13px system-ui;overflow-wrap:anywhere"><details><summary style="min-height:44px;cursor:pointer;display:flex;align-items:center">LOCAL SAMPLE PREVIEW · invented data</summary><p>Simulated SQL/permissions/account security; not live data or a database RLS test. Changes stay in memory. Email, Google and deletion are disconnected. Sample login: owner/admin/manager/accountant/worker/viewer@fieldwork.test · sample123. Sample authenticator: 000000.</p></details></aside>'));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(content);
  } catch (error) { failure(res, error.code === 'ENOENT' ? 404 : 400, error.code === 'ENOENT' ? 'Sample asset not found.' : error.message); }
}
const server = http.createServer(previewRequest);
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))server.listen(port, '127.0.0.1', () => console.log(`Local sample preview: http://127.0.0.1:${server.address().port} — invented SQL example; memory only; no Supabase connection.`));
