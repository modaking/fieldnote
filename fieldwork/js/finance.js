import { resource, minorAmount } from './crud.js';
import * as C from './components.js';
import { registerUnsaved } from './feedback.js';
import { readAll, calendarMonth } from './read-all.js';
const digits = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
const prevMonth = (a) => { const d = new Date(`${a}T00:00`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

/* ── Budget vs actual + closing cash ── */
export async function budget(box, X) {
  const { S, db, esc, money, toast, monthRange } = X,requested=monthRange(),period=calendarMonth(S.month),a=period.from,b=period.to,singleMonth=requested[0]===a&&requested[1]===b,prev=prevMonth(a),base=S.ws.currency,d=digits(base);
  const workspace=S.ws.id,selectedFarm=S.farmId,selectedMonth=S.month,scope=`workspace_id=eq.${workspace}`,farm=selectedFarm==='all'?null:selectedFarm,fq=farm?`&farm_id=eq.${farm}`:'',write=()=>X.permissions?.canWriteModule?.('finances')??X.canWrite(),edit=write()&&farm&&singleMonth;
  let busy=false;const drafts=new Set(),actor=X.uid?.(),current=()=>S.ws?.id===workspace&&S.farmId===selectedFarm&&S.month===selectedMonth&&(!actor||X.uid?.()===actor)&&box.isConnected!==false,all=(table,query)=>readAll(db,table,query,{active:current});
  box.onclick=null;box.onchange=null;box.oninput=null;box.innerHTML=C.skeletonRows({rows:4,columns:3});
  let cats=[],bud=[],tx=[],pc=[],tc=[],month=null;
  const validMonth=data=>{
    if(data?.schema_version!=='20261118-finance'||data.period?.from!==a||data.period?.to!==b||data.currency!==base||!Array.isArray(data.categories))throw new Error('Database totals are unavailable for this month. Refresh before closing.');
    for(const key of ['income','expenses','net','opening','calculated_closing'])if(!Number.isSafeInteger(data.totals?.[key]))throw new Error('A complete, accurate database balance is unavailable. Refresh this month before continuing.');
    if(data.totals.saved_closing!=null&&!Number.isSafeInteger(data.totals.saved_closing))throw new Error('The saved balance is unavailable.');
    for(const kind of ['income','expense'])for(const key of ['budget','actual'])if(!Number.isSafeInteger(data.sections?.[kind]?.[key]))throw new Error('Complete budget totals are unavailable.');
    for(const row of data.categories)if(!['income','expense','unknown'].includes(row.kind)||!Number.isSafeInteger(row.budget)||!Number.isSafeInteger(row.actual)||(row.variance!=null&&!Number.isSafeInteger(row.variance))||(row.pct!=null&&!Number.isFinite(row.pct)))throw new Error('A budget category is unavailable.');
    return data;
  };
  if(X.migrationReady)month=validMonth(await db.rpc('fw_finance_month',{p_workspace_id:workspace,p_month:a,p_farm_id:farm}));
  else [cats,bud,tx,pc,tc]=await Promise.all([all('categories',`${scope}&order=kind,name`),all('budgets',`${scope}&month=eq.${a}${fq}`),
    all('transactions',`${scope}&select=id,category_id,kind,amount_base&txn_date=gte.${a}&txn_date=lt.${b}&order=txn_date.asc${fq}`),all('month_closings',`${scope}&month=eq.${prev}${fq}`),all('month_closings',`${scope}&month=eq.${a}${fq}`)]);
  if(!current())return;
  const sum=(arr,f)=>arr.reduce((total,row)=>{const value=f(row),next=total+value;if(!Number.isSafeInteger(value)||!Number.isSafeInteger(next))throw new Error('An amount is too large to calculate accurately. The month has not been closed.');return next;},0),act=(k,c)=>sum(tx.filter(t=>t.kind===k&&t.category_id===c),t=>t.amount_base),bg=c=>sum(bud.filter(x=>x.category_id===c),x=>x.amount);
  const inc=month?month.totals.income:sum(tx.filter(t=>t.kind==='income'),t=>t.amount_base),exp=month?month.totals.expenses:sum(tx.filter(t=>t.kind==='expense'),t=>t.amount_base),net=month?month.totals.net:inc-exp;
  const opening=month?month.totals.opening:sum(pc,r=>r.closing_cash),closing=month?month.totals.calculated_closing:opening+net,stored=month?month.totals.saved_closing:tc.length?sum(tc,r=>r.closing_cash):null;
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(closing))throw new Error('This balance is too large to record accurately. The month has not been closed.');

  const section = (kind) => {
    const list=month?month.categories.filter(c=>c.kind===kind):cats.filter(c=>c.kind===kind).map(c=>({id:c.id,name:c.name}));if(!month&&act(kind,null))list.push({id:null,name:'Uncategorised'});
    const totals=month?month.sections?.[kind]:null,tb=month?totals?.budget:sum(list,c=>c.id?bg(c.id):0),ta=month?totals?.actual:sum(list,c=>act(kind,c.id));
    const data=month?list.map(c=>({...c,left:c.variance})):list.map(c=>{const B=c.id?bg(c.id):0,A=act(kind,c.id);return{...c,budget:B,actual:A,left:kind==='expense'?B-A:A-B,can_budget:!!c.id};});
    return `<section class="ui-budget-section"><h2>${kind==='expense'?'Expenses':kind==='income'?'Income':'Unclassified records'}</h2>${data.length ? C.dataTable({ caption: `${kind} budget against actual spending`, rows: data,
      columns: [{ key: 'name', label: 'Category' }, { key: 'budget', label: `Budget (${base})`, numeric: true, render: (r) => edit && r.id&&r.can_budget!==false ? C.field({label:`Budget for ${r.name} (${base})`,labelHTML:`<span class="ui-sr-only">${esc(`Budget for ${r.name} (${base})`)}</span>`,name:`budget-${r.id}`,type:'number',value:r.budget?r.budget/10**d:'',attrs:{class:'bin',step:10**-d,min:0,'data-c':r.id,placeholder:'0'}}) : money(r.budget) },
        { key: 'actual', label: 'Actual', numeric: true, render: (r) => money(r.actual) }, { key: 'left', label: kind === 'expense' ? 'Left' : 'Ahead', numeric: true, render: (r) => (month?r.left!=null:r.budget) ? `<span class="${r.left < 0 ? 'neg' : ''}">${money(r.left)}</span>` : '—' },
        { key: 'used', label: 'Progress', render: (r) => month?(r.over_budget?C.badge({label:'Over budget',tone:'negative'}):r.pct!=null?C.badge({label:`${new Intl.NumberFormat('en-KE',{maximumFractionDigits:2}).format(r.pct)}% ${kind==='expense'?'used':'of target'}`,tone:'positive'}):'—'):kind === 'expense' && r.budget > 0 && r.actual > r.budget ? C.badge({ label: 'Over budget', tone: 'negative' }) : r.budget && r.actual ? C.badge({ label: `${Math.round(r.actual / r.budget * 100)}% ${kind === 'expense' ? 'used' : 'of target'}`, tone: 'positive' }) : '—' }] }) : C.emptyState({ title: 'No categories yet', text: 'Add income and expense categories in the Categories tab.' })}${tb!=null&&ta!=null?`<div class="sumbar"><span>Budget total <b>${money(tb)}</b></span><span>Actual total <b>${money(ta)}</b></span></div>`:''}</section>`;
  };
  const canReport = typeof X.report === 'function' && (!X.canReport || X.canReport('finances'));
  const more=[...(canReport?[{label:'Report',attrs:{id:'budget-report'}}]:[]),...(edit?[{label:'Copy last month’s budget',attrs:{id:'copy'}}]:[])];
  box.innerHTML = C.pageHeader({ title: 'Budget & closing cash', description: 'Plan the month and see how actual spending compares.', actions: (more.length?C.actionMenu({label:'More actions',text:'More actions',items:more}):'')+(edit?C.button({label:'Close month',attrs:{id:'close'}}):'') })+(!singleMonth?C.notice({text:`Budgets and cash show ${period.label} only. Clear the date-range filter to edit or close this month.`}):'')+(month?.totals.opening_recorded===false?C.notice({text:'No previous month closing is recorded. Opening cash uses zero in the existing monthly calculation.'}):'')+`<div class="grid"><div class="card"><span class="muted">Opening cash</span><div class="kpi">${money(opening)}</div></div>
      <div class="card"><span class="muted">Net this month</span><div class="kpi ${net<0?'neg':'pos'}">${money(net)}</div></div>
      <div class="card"><span class="muted">Closing cash</span><div class="kpi ${closing<0?'neg':''}">${money(closing)}</div>${stored!==null?`<span class="badge ${stored===closing?'ok':'warn'}">${stored===closing?'Month closed':`Closed at ${money(stored)}`}</span>`:''}</div></div>
    ${write() && !farm ? C.notice({ text: 'Choose one farm to edit its budget and close its month. All farms shows combined totals.' }) : ''}${section('expense')}${section('income')}${month?.categories.some(row=>row.kind==='unknown')?section('unknown'):''}`;
  box.querySelector('#budget-report')?.addEventListener('click', () => X.report('finances'));
  const firstInput=box.querySelector('[data-c]'),unregister=registerUnsaved({element:box,isDirty:()=>drafts.size>0,isSaving:()=>busy,isActive:()=>current()&&box.querySelector('[data-c]')===firstInput});
  const validateBudget=(input)=>{let error='';try{minorAmount(input.value,base);}catch(failure){error=failure.message;}
    input.setAttribute('aria-invalid',error?'true':'false');const hint=box.querySelector(`[data-error-for="budget-${input.dataset.c}"]`);if(hint){hint.hidden=!error;hint.textContent=error;}return error;
  };
  box.oninput=(event)=>{const input=event.target;if(!input.dataset.c||!edit)return;drafts.add(input.dataset.c);validateBudget(input);};
  const pending = (value) => { busy = value; box.setAttribute('aria-busy', String(value)); box.querySelectorAll('input,button').forEach((control) => { control.disabled = value; }); };
  box.onchange = async (e) => { const i = e.target; if (!i.dataset.c || busy || !edit || !write() || !current()) return;
    drafts.add(i.dataset.c);
    try { const invalid=validateBudget(i);if(invalid)throw new Error(invalid);const amount = minorAmount(i.value, base) ?? 0; i.removeAttribute('aria-invalid'); pending(true);
      await db.upsert('budgets', { workspace_id: workspace, farm_id: farm, category_id: i.dataset.c, month: a, amount }, 'workspace_id,farm_id,category_id,month');if(!current())return;drafts.delete(i.dataset.c);unregister();toast('Budget saved.');await budget(box, X);
    } catch (x) { i.setAttribute('aria-invalid', 'true'); toast(x.message); i.focus(); } finally { pending(false); } };
  box.onclick = async (e) => { const id = e.target.closest('button')?.id; if (!['close', 'copy'].includes(id) || busy || !edit || !write() || !current()) return;
    pending(true);
    try {
      if (id === 'close') {if(X.migrationReady)validMonth(await db.rpc('fw_close_month',{p_workspace_id:workspace,p_month:a,p_farm_id:farm}));else await db.upsert('month_closings', { workspace_id: workspace, farm_id: farm, month: a, closing_cash: closing }, 'workspace_id,farm_id,month');if(!current())return;unregister();toast('Month closed. Next month opens with this balance.'); await budget(box, X); }
      if (id === 'copy') { const old = await all('budgets', `${scope}&month=eq.${prev}&farm_id=eq.${farm}`); if (!old.length) return toast('Last month has no budget to copy');
        if (!bud.length || await C.confirmDialog({title:'Replace this month’s budget?',text:'The matching budget lines will use last month’s amounts.',confirmLabel:'Copy budget'})) {if(!current())return;await db.upsert('budgets', old.map((r) => ({ workspace_id: workspace, farm_id: farm, category_id: r.category_id, month: a, amount: r.amount })), 'workspace_id,farm_id,category_id,month');if(!current())return;unregister();toast('Budget copied.');await budget(box, X); } }
    } catch (x) { toast(x.message); } finally { pending(false); } };
}

/* ── Recurring payments ── */
const RECUR = { table: 'recurring_payments', title: 'Recurring payments', singular: 'recurring payment', icon: 'finances', multi: true, farmOrNull: true, refs: ['categories', 'vendors'], search: ['name'], order: 'name.asc',
  emptyTitle: 'No recurring payments', emptyText: 'Add rent, loan repayments, subscriptions or regular sales, then post them each month in one click.',
  badges: { income: 'ok', expense: 'warn' },
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] }, { k: 'amount', label: 'Amount', type: 'money', req: true },
    { k: 'category_id', label: 'Category', type: 'ref', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' },
    { k: 'day_of_month', label: 'Day of month (1–28)', type: 'number', req: true, def: 1, min: 1, max: 28, step: 1 }, { k: 'active', label: 'Active', type: 'bool', req: true, def: true }],
  cols: [{ k: 'name', label: 'Name' }, { k: 'kind', label: 'Type', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'category_id', label: 'Category', t: 'categories' }, { k: 'day_of_month', label: 'Day' }, { k: 'amount', label: 'Amount', t: 'money' }] };
export async function recurring(box, X) {
  const { S, db, toast } = X, workspace = S.ws.id, scope = `workspace_id=eq.${workspace}`, base = S.ws.currency;
  const write = () => X.permissions?.canWriteModule?.('finances') ?? X.canWrite();
  const selectedMonth=S.month,selectedFarm=S.farmId,period=calendarMonth(selectedMonth),actor=X.uid?.(),current=()=>S.ws?.id===workspace&&S.month===selectedMonth&&S.farmId===selectedFarm&&(!actor||X.uid?.()===actor)&&write(),all=(table,query)=>readAll(db,table,query,{active:current});
  box.innerHTML = `${write() ? C.notice({ title: 'Keep regular payments up to date', text: `Use More actions to post ${period.label} only. Previously posted entries are skipped.` }) : ''}<div id="rc"></div>`;
  const postRecurring=async (event) => {
    const button = event.currentTarget; if (button.disabled || !current()) return; button.disabled = true;
    try {
      const a=period.from,fq=selectedFarm==='all'?'':`&farm_id=eq.${selectedFarm}`;
      const [list, done] = await Promise.all([all('recurring_payments', `${scope}&active=eq.true${fq}`), all('transactions', `${scope}&select=id,source_id&source_type=eq.recurring&source_period=eq.${a}`)]);
      const posted = new Set(done.map((r) => r.source_id)), rows = [], skipped = [];
      for (const r of list.filter((r) => !posted.has(r.id))) {
        if(!current())return;
        let fx = 1; if (r.currency !== base) { const [x] = await db.select('fx_rates', `${scope}&currency=eq.${r.currency}&order=as_of.desc&limit=1`); if (!x) { skipped.push(r.name); continue; } fx = x.rate; }
        rows.push({ workspace_id: workspace, farm_id: r.farm_id, txn_date: `${a.slice(0, 8)}${String(r.day_of_month).padStart(2, '0')}`, kind: r.kind, amount: r.amount, currency: r.currency, fx_rate: fx,
          category_id: r.category_id, vendor_id: r.vendor_id, description: r.name, source_type: 'recurring', source_id: r.id, source_period: a });
      }
      if (!current())return;
      if (rows.some((r) => !Number.isSafeInteger(r.amount) || !Number.isFinite(Number(r.fx_rate)) || Number(r.fx_rate) <= 0)) throw new Error('An amount or exchange rate is invalid. Review recurring payments before posting.');
      if (rows.length) await db.insertMany('transactions', rows);
      if(!current())return;
      toast(`${rows.length} posted${skipped.length ? `. No exchange rate for ${skipped.join(', ')}` : ''}${!rows.length && !skipped.length ? ' (all already posted)' : ''}`);
    } catch (x) {if(current())toast(x.message);} finally { button.disabled = false; } };
  await resource(box.querySelector('#rc'), X, {...RECUR,moreActions:write()?[{label:`Post ${period.label}`,attrs:{id:'postr'}}]:[]});
  box.querySelector('#postr')?.addEventListener('click',postRecurring);
  const header=box.querySelector('.ui-page-header');if(header)box.prepend(header);
}

/* ── Categories ── */
export const CAT = { table: 'categories', title: 'Categories', singular: 'category', icon: 'finances', farmScoped: false, search: ['name'], order: 'kind.asc,name.asc', badges: { income: 'ok', expense: 'warn' },
  emptyTitle: 'No categories yet', emptyText: 'Categories sort your income and expenses and drive the budget.',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] }],
  cols: [{ k: 'name', label: 'Category' }, { k: 'kind', label: 'Type', t: 'badge' }], filters: [{ k: 'kind', label: 'Type', options: ['income', 'expense'] }] };
