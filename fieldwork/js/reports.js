import { pageHeader, field, button, notice, dataTable, actionMenu } from './components.js';
import { cellText, downloadStatement, PDF_TEXT_NOTE } from './statements.js';

export const REPORT_MODULES = [
  ['overview','Farm overview'],['daily','Daily operations'],['finances','Financial statement'],['vendors','Vendors and balances'],
  ['infrastructure','Infrastructure projects'],['livestock','Livestock and crops'],['workers','Workers and pay'],['funding','Funding opportunities'],
  ['members','Members and access'],['audit','Audit history'],
].map(([key,label]) => ({ key,label }));
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const money = (key,label,currency,extra={}) => ({key,label,type:'money',currency,width:19,...extra});
const text = (key,label,width=26) => ({key,label,width});
const number = (key,label,extra={}) => ({key,label,type:'number',width:15,...extra});
const date = (key,label) => ({key,label,type:'date',width:15});
const financialRoles = ['owner','admin','manager','accountant'];
const capabilityNames={finance:'finance.read',payroll:'pay.read',members:'members.manage',audit:'audit.read'};
const capable = (X,cap) => typeof X.permissions?.has === 'function' ? X.permissions.has(capabilityNames[cap]||cap) : cap==='members'?['owner','admin'].includes(X.S.role):cap==='operations.read'?['owner','admin','manager','worker','viewer'].includes(X.S.role):financialRoles.includes(X.S.role);
const allowed = (X,key) => {
  if(typeof X.canReport==='function')return X.canReport(key);
  if(!['owner','admin','manager','accountant','worker','viewer'].includes(X.S.role))return false;
  return key==='members'?['owner','admin'].includes(X.S.role):['finances','vendors','funding','audit'].includes(key)?financialRoles.includes(X.S.role):!['daily','livestock'].includes(key)||X.S.role!=='accountant';
};
const byId = (rows) => Object.fromEntries(rows.map((row) => [row.id,row]));
const sum = (rows,key) => rows.reduce((total,row) => total + Number(row[key] || 0),0);
function major(value,currency) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('A money value is too large to export accurately. Review the source record.');
  const digits = new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  return n / 10 ** digits;
}
function validDate(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value || ''))return false;
  const parsed=new Date(`${value}T12:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function defaults(X,filters={}) {
  const range = X.monthRange?.() || [`${X.S.month}-01`,new Date(Date.UTC(Number(X.S.month.slice(0,4)),Number(X.S.month.slice(5,7)),1)).toISOString().slice(0,10)];
  const end = new Date(`${range[1]}T12:00:00Z`); end.setUTCDate(end.getUTCDate()-1);
  return {farmId:X.S.farmId || 'all',from:range[0],to:end.toISOString().slice(0,10),status:'all',category:'all',workerId:'all',...filters};
}
const within = (value,filters) => !value || (String(value).slice(0,10) >= filters.from && String(value).slice(0,10) <= filters.to);
function statusOf(task,day) {
  if (task.status !== 'done' || !['daily','monthly'].includes(task.cadence)) return task.status || 'open';
  if (!task.done_at||!Number.isFinite(Date.parse(task.done_at))) return 'open';
  const parts = new Intl.DateTimeFormat('en',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(task.done_at));
  const get = (type) => parts.find((part) => part.type === type).value, completed=`${get('year')}-${get('month')}-${get('day')}`;
  return (task.cadence === 'daily' ? completed === day : completed.slice(0,7) === day.slice(0,7)) ? 'done' : 'open';
}
function groupCurrencies(rows) {
  const groups=new Map(); for (const row of rows) { const code=row.currency || 'KES'; if(!groups.has(code))groups.set(code,[]); groups.get(code).push(row); } return groups;
}

export async function createReport(X,{module='overview',filters={}}={}) {
  if (!REPORT_MODULES.some((item)=>item.key===module) || !allowed(X,module)) throw new Error('Your role cannot open this statement.');
  if(X.migrationReady===false&&((module==='workers'&&!capable(X,'payroll'))||(module==='infrastructure'&&!capable(X,'finance'))))throw new Error('This statement needs the workspace access upgrade. Ask your workspace administrator to complete it.');
  const S=X.S, workspace=S.ws?.id, uid=X.uid?.(), f=defaults(X,filters), base=S.ws.currency;
  if(['members','funding'].includes(module))f.farmId='all';
  if (!workspace) throw new Error('Choose a workspace first.');
  if (!validDate(f.from)||!validDate(f.to)||f.from>f.to) throw new Error('Choose valid start and end dates in order.');
  if (f.farmId!=='all'&&!S.farms.some((farm)=>farm.id===f.farmId)) throw new Error('That farm is not available to your account.');
  const permitted=X.permissions?.farmIds;
  const farms=S.farms.filter((farm)=>!Array.isArray(permitted)||permitted.includes(farm.id)), farmMap=byId(farms);
  const farmName=(id)=>id ? farmMap[id]?.name || 'Unavailable farm' : 'Shared across farms';
  const scope=`workspace_id=eq.${encodeURIComponent(workspace)}`;
  const scoped=(row,nullable=true)=>row.workspace_id===workspace&&(!row.farm_id ? nullable&&!Array.isArray(permitted) : Boolean(farmMap[row.farm_id]))&&(f.farmId==='all'||row.farm_id===f.farmId||(nullable&&!row.farm_id));
  const alive=()=>{if(S.ws?.id!==workspace||(uid&&X.uid?.()!==uid)||!allowed(X,module))throw new Error('Your workspace or access changed. Generate the statement again.');};
  async function all(table,query='',order='id.asc') {
    const rows=[];
    for(let offset=0;;offset+=1000){alive();const batch=await X.db.select(table,`${scope}${query?`&${query}`:''}&order=${order}&limit=1000&offset=${offset}`);alive();
      if(!Array.isArray(batch))throw new Error('The report received an unexpected record list.');rows.push(...batch.filter((row)=>row.workspace_id===workspace));if(batch.length<1000)break;if(rows.length>100000)throw new Error('This statement is too large. Choose a shorter period.');}
    return rows;
  }
  const report={title:REPORT_MODULES.find((item)=>item.key===module).label,currency:base,module,workspaceId:workspace,filters:f,
    letterhead:{workspace:S.ws.name,farm:f.farmId==='all'?'All permitted farms':farmName(f.farmId),period:`${f.from} to ${f.to}`,generatedBy:S.profile?.full_name||S.profile?.email||S.user?.email||uid||'Workspace member',generatedAt:new Date().toISOString(),address:[S.ws.address,S.ws.phone,S.ws.email].filter(Boolean).join(' | ')},sections:[],notes:[]};
  const section=(title,columns,rows,extra={})=>report.sections.push({title,columns,rows,...extra});
  const period=(column)=>`${column}=gte.${f.from}&${column}=lte.${f.to}`;
  const selected=(row,key='status')=>f.status==='all'||String(row[key]).toLowerCase()===String(f.status).toLowerCase();
  const category=(row)=>f.category==='all'||row.category_id===f.category;
  const txRows=async()=> (await all('transactions',period('txn_date'),'txn_date.asc,id.asc')).filter((row)=>scoped(row)&&category(row)&&(f.status==='all'||row.kind===f.status));
  const categories=async()=>byId(await all('categories','','kind.asc,name.asc,id.asc'));
  const txSection=(title,rows,cats={},workers={})=>section(title,[date('txn_date','Date'),text('farm','Farm',24),text('description','Description',38),text('kind','Type',12),text('category','Category',23),text('currency','Currency',12),money('amount','Original amount',base,{currencyKey:'currency'}),money('impact',`Net movement (${base})`,base,{total:true})],rows.map((row)=>({...row,farm:farmName(row.farm_id),category:cats[row.category_id]?.name||'Uncategorised',description:workers[row.source_id]?.full_name?`${row.description||'Pay'} — ${workers[row.source_id].full_name}`:row.description,amount:major(row.amount,row.currency),impact:major((row.kind==='expense'?-1:1)*Number(row.amount_base),base)})),{totalLabel:'Net movement'});

  if(module==='overview') {
    const operations=capable(X,'operations.read'),tasks=operations?(await all('tasks','','created_at.asc,id.asc')).filter((row)=>scoped(row)&&(!row.created_at||row.created_at.slice(0,10)<=f.to)):[];
    const day=X.today?.()||new Date().toISOString().slice(0,10);
    if(capable(X,'finance')){
      const rows=await txRows(), grouped=[...farms,...(rows.some((row)=>!row.farm_id)?[{id:null,name:'Shared across farms'}]:[])].filter((farm)=>f.farmId==='all'||farm.id===f.farmId||farm.id===null);
      section('Farm activity and cash movement',[text('farm','Farm',35),money('income','Income',base,{total:true}),money('expenses','Expenses',base,{total:true}),money('net','Net movement',base,{total:true}),number('open','Current open tasks',{total:operations})],grouped.map((farm)=>{const data=rows.filter((row)=>row.farm_id===farm.id),income=sum(data.filter((row)=>row.kind==='income'),'amount_base'),expense=sum(data.filter((row)=>row.kind==='expense'),'amount_base');return{farm:farm.name,income:major(income,base),expenses:major(expense,base),net:major(income-expense,base),open:operations?tasks.filter((task)=>task.farm_id===farm.id&&statusOf(task,day)==='open').length:null};}));
    } else section('Operational farm overview',[text('farm','Farm',35),text('county','County'),number('open','Current open tasks',{total:true})],farms.filter((farm)=>f.farmId==='all'||farm.id===f.farmId).map((farm)=>({farm:farm.name,county:farm.county,open:tasks.filter((task)=>task.farm_id===farm.id&&statusOf(task,day)==='open').length})));
    report.notes.push('Cash movement is income less expenses recorded in the selected period. It is not an account balance. Task status is current, not a reconstructed historical completion ledger.');
    if(!operations)report.notes.push('Task information is unavailable to this role. A dash means unavailable, not zero.');
  }
  if(module==='daily') {
    const day=X.today?.()||new Date().toISOString().slice(0,10),tasks=(await all('tasks','','created_at.asc,id.asc')).filter((row)=>scoped(row)&&(!row.created_at||row.created_at.slice(0,10)<=f.to)).map((row)=>({...row,status:statusOf(row,day),farm:farmName(row.farm_id)})).filter((row)=>selected(row)&&(row.cadence!=='once'||within(row.due_date||row.created_at,f)));
    section('Tasks',[text('title','Task',42),text('farm','Farm',25),text('cadence','Repeats',14),date('due_date','Due date'),text('status','Current status',15),text('done_at','Last completed',25)],tasks);
    const lists=byId(await all('checklists')),runs=(await all('checklist_runs',`${period('run_date')}&select=*,checklist_run_items(item_id,done,done_at)`,'run_date.asc,id.asc')).filter((row)=>scoped(row));
    section('Recorded checklist runs',[date('run_date','Date'),text('checklist','Checklist',40),text('farm','Farm',30),number('completed','Completed steps',{total:true})],runs.map((row)=>({run_date:row.run_date,checklist:lists[row.checklist_id]?.name||'Checklist',farm:farmName(row.farm_id),completed:(row.checklist_run_items||[]).filter((item)=>item.done).length})));
    report.notes.push('Repeating tasks show current status and their last stored completion. Earlier daily/monthly task completions are not available as a full history. Checklist totals count recorded completed steps, not inferred runs.');
  }
  if(module==='finances') {
    if(!capable(X,'finance'))throw new Error('Financial statements require financial access.');
    const rows=await txRows(),cats=await categories();
    txSection('Transaction register',rows,cats);
    const income=sum(rows.filter((row)=>row.kind==='income'),'amount_base'),expense=sum(rows.filter((row)=>row.kind==='expense'),'amount_base');
    section('Selected-period totals',[text('metric','Measure',40),money('value',base,base)],[{metric:'Income',value:major(income,base)},{metric:'Expenses',value:major(expense,base)},{metric:'Net movement',value:major(income-expense,base)}]);
    const budgets=(await all('budgets',`month=gte.${f.from.slice(0,7)}-01&month=lte.${f.to.slice(0,7)}-01`)).filter((row)=>scoped(row)&&category(row));
    for(const kind of ['expense','income']){
      if(f.status!=='all'&&f.status!==kind)continue;
      const plans=budgets.filter((row)=>cats[row.category_id]?.kind===kind),actuals=rows.filter((row)=>row.kind===kind);
      const keys=new Set([...plans.map((row)=>`${row.farm_id||''}:${row.category_id||''}`),...actuals.map((row)=>`${row.farm_id||''}:${row.category_id||''}`)]);
      const budgetRows=[...keys].map((key)=>{const[farm,cat]=key.split(':'),matched=plans.filter((row)=>(row.farm_id||'')===farm&&(row.category_id||'')===cat),actual=sum(actuals.filter((row)=>(row.farm_id||'')===farm&&(row.category_id||'')===cat),'amount_base'),planned=matched.length?sum(matched,'amount'):null;return{farm:farmName(farm),category:cats[cat]?.name||'Uncategorised',budget:major(planned,base),actual:major(actual,base),variance:planned==null?null:major(kind==='expense'?planned-actual:actual-planned,base)};});
      section(kind==='expense'?'Recorded budgets versus expenses':'Recorded income targets versus income',[text('farm','Farm',27),text('category','Category',30),money('budget',kind==='expense'?'Recorded budget':'Income target',base,{total:true}),money('actual',kind==='expense'?'Expenses':'Income',base,{total:true}),money('variance',kind==='expense'?'Budget remaining':'Ahead of target',base)],budgetRows,{totalLabel:'Recorded totals',notes:['A dash means no plan was recorded. Plans cover whole months; partial date ranges compare those plans with transactions within the selected dates.']});
    }
    const closings=(await all('month_closings',`month=gte.${f.from.slice(0,7)}-01&month=lte.${f.to.slice(0,7)}-01`,'month.asc,id.asc')).filter((row)=>scoped(row));
    section('Recorded month-end cash snapshots',[date('month','Month'),text('farm','Farm',35),money('closing','Recorded closing cash',base)],closings.map((row)=>({month:row.month,farm:farmName(row.farm_id),closing:major(row.closing_cash,base)})));
    report.notes.push('Cash snapshots are recorded values, not recalculated bank balances. Missing opening/closing cash is unavailable, not zero. No opening balance is inferred.');
  }
  if(module==='vendors') {
    const finance=capable(X,'finance'),vendors=(await all('vendors',finance?'':'select=id,workspace_id,farm_id,name,kind','name.asc,id.asc')).filter((row)=>scoped(row)),map=byId(vendors);
    section('Vendor directory',[text('name','Vendor',40),text('kind','Supplies'),text('farm','Farm',30),...(finance?[text('phone','Phone',22),text('email','Email',34)]:[])],vendors.map((row)=>({...row,farm:farmName(row.farm_id)})));
    if(finance){
      const expenses=(await all('transactions',`${period('txn_date')}&kind=eq.expense`,'txn_date.asc,id.asc')).filter((row)=>row.kind==='expense'&&scoped(row)&&map[row.vendor_id]&&category(row));
      section(`Recorded vendor spend — ${base}`,[text('vendor','Vendor',40),number('transactions','Expense transactions',{total:true}),money('spend',`Recorded spend (${base})`,base,{total:true})],vendors.map((vendor)=>{const data=expenses.filter((row)=>row.vendor_id===vendor.id);return{vendor:vendor.name,transactions:data.length,spend:major(sum(data,'amount_base'),base)};}));
      let bills=[];
      try{bills=(await all('vendor_bills',`issued_on=lte.${f.to}`,'issued_on.asc,id.asc')).filter((row)=>scoped(row)&&map[row.vendor_id]);}
      catch(error){if(error.status===404||/vendor_bills|schema cache|does not exist/i.test(error.message))report.notes.push('Bills and outstanding balances are unavailable until the approved bills feature is installed. Cash transactions are not used to invent vendor debt.');else throw error;}
      const filtered=bills.filter((row)=>f.status==='all'||(Number(row.amount)-Number(row.paid_amount)>0?'outstanding':'paid')===f.status);
      for(const[currency,items]of groupCurrencies(filtered)){
        section(`Bills and balances — ${currency}`,[date('issued_on','Issued'),date('due_on','Due'),text('vendor','Vendor',30),text('reference','Reference',22),text('description','Description',36),money('amount','Billed',currency,{total:true}),money('paid','Recorded paid',currency,{total:true}),money('outstanding','Outstanding',currency,{total:true})],items.map((row)=>({...row,vendor:map[row.vendor_id].name,amount:major(row.amount,currency),paid:major(row.paid_amount,currency),outstanding:major(Number(row.amount)-Number(row.paid_amount),currency)})));
      }
      report.notes.push('Spend sums recorded expense transactions linked to each vendor in the selected period, converted using their recorded base-currency amounts. Bills and balances are a separate obligations register.');
      report.notes.push('Balances use each bill’s current recorded paid amount for bills issued through the end date, including earlier unpaid bills. They are not a historical settlement ledger. Different currencies are shown separately. Bills do not automatically post cash transactions.');
    } else report.notes.push('This directory statement excludes contact details, bills and financial balances for your role.');
  }
  if(module==='infrastructure') {
    const finance=capable(X,'finance');
    let projects=finance?await all('projects','','name.asc,id.asc'):await X.db.rpc('fw_operational_projects',{p_workspace_id:workspace});alive();
    projects=projects.filter((row)=>scoped(row)&&selected(row)&&(!row.start_date||row.start_date<=f.to)&&(!row.end_date||row.end_date>=f.from));
    if(finance)for(const[currency,items]of groupCurrencies(projects))section(`Projects — ${currency}`,[text('name','Project',36),text('farm','Farm',28),text('status','Status',14),date('start_date','Start'),date('end_date','End'),money('budget','Recorded budget',currency,{total:true}),money('cost','Recorded cost',currency,{total:true}),money('remaining','Budget remaining',currency)],items.map((row)=>({...row,farm:farmName(row.farm_id),budget:major(row.budget,currency),cost:major(row.cost,currency),remaining:row.budget==null?null:major(Number(row.budget)-Number(row.cost),currency)})),{totalLabel:'Recorded totals'});
    else section('Operational projects',[text('name','Project',40),text('farm','Farm',30),text('status','Status'),date('start_date','Start'),date('end_date','End'),text('notes','Notes',42)],projects.map((row)=>({...row,farm:farmName(row.farm_id)})));
    if(!report.sections.length)section('Projects',[text('name','Project'),text('status','Status')],[]);
    report.notes.push(finance?'Recorded project costs are entered project values, not a cash-ledger reconciliation. A dash means the budget is not recorded. Currency groups are never added together.':'Project costs and budgets are excluded for your role.');
  }
  if(module==='livestock') {
    const enterprises=(await all('enterprises','','name.asc,id.asc')).filter((row)=>scoped(row)),map=byId(enterprises),records=(await all('enterprise_records',period('record_date'),'record_date.asc,id.asc')).filter((row)=>map[row.enterprise_id]&&(f.status==='all'||row.record_type===f.status));
    section('Enterprises',[text('name','Enterprise',35),text('farm','Farm',30),text('type','Type'),text('notes','Notes',45)],enterprises.map((row)=>({...row,farm:farmName(row.farm_id)})));
    section('Field and production records',[date('record_date','Date'),text('enterprise','Enterprise',30),text('farm','Farm',27),text('record_type','Record type',23),number('quantity','Quantity'),text('unit','Unit',13),text('notes','Notes',45)],records.map((row)=>({...row,enterprise:map[row.enterprise_id].name,farm:farmName(map[row.enterprise_id].farm_id)})));
    const grouped=new Map();for(const row of records){if(row.quantity==null)continue;const key=JSON.stringify([row.enterprise_id,row.record_type,row.unit||'unspecified']);if(!grouped.has(key))grouped.set(key,{enterprise:map[row.enterprise_id].name,type:row.record_type,unit:row.unit||'unspecified',quantity:0});grouped.get(key).quantity+=Number(row.quantity);}
    section('Quantities by enterprise, record type and unit',[text('enterprise','Enterprise',35),text('type','Record type',25),text('unit','Unit',18),number('quantity','Recorded quantity')],[...grouped.values()]);
    if(capable(X,'finance')){
      let linked=null;
      if(X.migrationReady===true)try{linked=(await all('transactions',`${period('txn_date')}&enterprise_id=not.is.null`,'txn_date.asc,id.asc')).filter((row)=>scoped(row)&&map[row.enterprise_id]&&category(row));}
      catch(error){if(!(error.status===404||/enterprise_id|schema cache|does not exist/i.test(error.message)))throw error;}
      if(linked===null)section('Enterprise profitability',[text('enterprise','Enterprise',35),text('availability','Availability',60)],enterprises.map((row)=>({enterprise:row.name,availability:'Unavailable until the financial linking upgrade is installed'})));
      else section(`Recorded enterprise profitability — ${base}`,[text('enterprise','Enterprise',35),text('farm','Farm',30),money('income','Linked income',base,{total:linked.length>0}),money('cost','Linked expenses',base,{total:linked.length>0}),money('margin','Recorded margin',base,{total:linked.length>0})],enterprises.map((enterprise)=>{const data=linked.filter((row)=>row.enterprise_id===enterprise.id),income=sum(data.filter((row)=>row.kind==='income'),'amount_base'),cost=sum(data.filter((row)=>row.kind==='expense'),'amount_base');return{enterprise:enterprise.name,farm:farmName(enterprise.farm_id),income:data.length?major(income,base):null,cost:data.length?major(cost,base):null,margin:data.length?major(income-cost,base):null};}),{totalLabel:'Linked totals'});
      report.notes.push('Recorded enterprise margin is linked income less linked expenses in the selected farm, period and financial category. A dash means there are no linked transactions; it is not a zero-profit claim. Unlinked transactions and unrecorded costs are excluded.');
    }
    report.notes.push('Quantities remain separated by enterprise, record type and unit. Repeated observations are not livestock stock balances.');
  }
  if(module==='workers') {
    const payroll=capable(X,'payroll');let workers=payroll?await all('workers','','full_name.asc,id.asc'):await X.db.rpc('fw_operational_workers',{p_workspace_id:workspace});alive();workers=workers.filter((row)=>scoped(row));
    report.workerOptions=workers.map((row)=>({value:row.id,label:row.full_name}));
    if(f.workerId!=='all'&&!workers.some((row)=>row.id===f.workerId))throw new Error('Choose a worker available to your role and farm scope.');
    workers=workers.filter((row)=>(f.status==='all'||(row.active!==false?'active':'inactive')===f.status)&&(f.workerId==='all'||row.id===f.workerId));
    const map=byId(workers);section('Worker directory',[text('full_name','Name',35),text('farm','Farm',30),text('role','Role',24),date('start_date','Start'),date('end_date','End'),text('active','Active')],workers.map((row)=>({...row,farm:farmName(row.farm_id)})));
    if(payroll){for(const[currency,items]of groupCurrencies(workers))section(`Recorded pay rates — ${currency}`,[text('full_name','Worker',35),text('pay_frequency','Frequency',22),money('rate','Scheduled rate',currency)],items.map((row)=>({...row,rate:major(row.pay_amount,currency)})));
      const payments=(await all('transactions',`${period('txn_date')}&source_type=eq.worker_pay${f.workerId==='all'?'':`&source_id=eq.${encodeURIComponent(f.workerId)}`}`,'txn_date.asc,id.asc')).filter((row)=>row.source_type==='worker_pay'&&scoped(row)&&map[row.source_id]);txSection('Recorded payroll transactions',payments,await categories(),map);
      section(`Recorded payments by worker — ${base}`,[text('worker','Worker',38),text('farm','Farm',30),number('transactions','Payment records',{total:true}),money('paid','Net recorded pay',base,{total:true})],workers.map((worker)=>{const data=payments.filter((row)=>row.source_id===worker.id),paid=sum(data.filter((row)=>row.kind==='expense'),'amount_base')-sum(data.filter((row)=>row.kind==='income'),'amount_base');return{worker:worker.full_name,farm:farmName(worker.farm_id),transactions:data.length,paid:major(paid,base)};}));
      report.notes.push('Pay rates are schedules, not proof of payment. Only recorded worker-pay transactions are shown as payments. Daily, weekly and monthly rates are not totalled together.');
    } else report.notes.push('Pay rates, payment history and private contact details are excluded for your role.');
  }
  if(module==='funding') {
    const finance=capable(X,'finance'),rows=(await all('funding_opportunities','','deadline.asc.nullslast,id.asc')).filter((row)=>selected(row)&&within(row.deadline,f));
    if(finance)for(const[currency,items]of groupCurrencies(rows))section(`Opportunities — ${currency}`,[text('name','Opportunity',40),text('source','Source',30),date('deadline','Deadline'),text('status','Stage',17),text('eligible','Eligible',14),money('amount','Potential funding',currency),text('eligibility_notes','Eligibility notes',45)],items.map((row)=>({...row,amount:major(row.amount,currency)})));
    else section('Funding opportunities',[text('name','Opportunity',40),text('source','Source',30),date('deadline','Deadline'),text('status','Stage')],rows);
    if(!report.sections.length)section('Funding opportunities',[text('name','Opportunity'),text('status','Stage')],[]);
    report.notes.push('Potential funding is an opportunity value, not income received. Opportunities without deadlines remain visible. Funding opportunities are workspace-wide and are not assigned to individual farms.');
  }
  if(module==='members') {
    if(!capable(X,'members'))throw new Error('Member statements require member-management access.');
    const members=await X.db.rpc('fw_list_members',{p_workspace_id:workspace});alive();
    section('Workspace membership',[text('full_name','Name',30),text('email','Email',38),text('role','Role',18),text('farm_access','Farm access',38),text('created_at','Joined',27)],members.filter((row)=>f.status==='all'||row.role===f.status).map((row)=>({...row,farm_access:row.farm_scope==='farms'?(row.farm_ids||[]).map(farmName).join(', ')||'No farms assigned':'All workspace farms'})));
    report.notes.push('Member names, email addresses and farm access are included only for workspace owners and administrators.');
  }
  if(module==='audit') {
    if(!capable(X,'audit'))throw new Error('Audit statements require audit access.');
    const rows=(await all('audit_log',`at=gte.${encodeURIComponent(`${f.from}T00:00:00+03:00`)}&at=lte.${encodeURIComponent(`${f.to}T23:59:59.999+03:00`)}`,'at.asc,id.asc')).filter((row)=>selected(row,'action')&&(!['workspace_members','workspace_invites','workspaces'].includes(row.table_name)||capable(X,'members'))&&(f.farmId==='all'||(row.farm_id||row.new_data?.farm_id||row.old_data?.farm_id)===f.farmId));
    section('Recorded changes',[text('at','Time',27),text('action','Action',13),text('table_name','Record type',25),text('row_id','Record ID',42),text('actor','Member ID',40)],rows);
    report.notes.push('Audit statements list event metadata. Raw before/after records and secrets are excluded. Farm-specific filters omit workspace-wide changes that cannot be assigned to that farm.');
  }
  alive();return report;
}

const statusOptions={daily:['open','done'],finances:['expense','income'],vendors:['outstanding','paid'],infrastructure:['planned','active','paused','done'],workers:['active','inactive'],funding:['identified','eligible','preparing','submitted','awarded','declined'],members:['owner','admin','manager','accountant','worker','viewer'],audit:['INSERT','UPDATE','DELETE'],livestock:['milk yield','feeding','breeding','health','weight','planting','fertiliser','spraying','harvest','other']};
export function statementPreview(report) {
  const h=report.letterhead;
  return `<article class="ui-statement"><header class="ui-statement-letterhead"><p class="ui-statement-workspace">${esc(h.workspace)}</p><p><strong>${esc(report.title)}</strong></p><p>${esc(h.farm)} · ${esc(h.period)}</p>${h.address?`<p>${esc(h.address)}</p>`:''}<p class="muted">Generated by ${esc(h.generatedBy)} · ${esc(h.generatedAt)}</p></header>${report.sections.map((section)=>{
    const total=section.columns.filter((column)=>column.total||Object.hasOwn(section.totals||{},column.key)),rows=[...section.rows];if(total.length){const row={[section.columns[0].key]:section.totalLabel||'Total',__total:true};total.forEach((column)=>{row[column.key]=Object.hasOwn(section.totals||{},column.key)?section.totals[column.key]:section.rows.reduce((sum,row)=>sum+Number(row[column.key]||0),0);});rows.push(row);}
    return `<section class="ui-statement-section"><h2>${esc(section.title)}</h2><div class="table-wrap">${dataTable({caption:section.title,columns:section.columns.map((column)=>({key:column.key,label:column.label,numeric:['money','number'].includes(column.type),render:(row)=>row.__total?`<strong>${esc(cellText(column,row,report))}</strong>`:esc(cellText(column,row,report))})),rows})}</div>${!section.rows.length?'<p class="muted">No records match these filters.</p>':''}${(section.notes||[]).map((note)=>`<p class="muted">${esc(note)}</p>`).join('')}</section>`;
  }).join('')}<footer>${report.notes.map((note)=>`<p class="muted">${esc(note)}</p>`).join('')}<p>fieldnote. · End of statement</p></footer></article>`;
}
export async function renderReports(el,X,{module='overview'}={}) {
  const available=REPORT_MODULES.filter((item)=>allowed(X,item.key));
  if(!available.length){el.innerHTML=notice({title:'Statements unavailable',text:'Your role does not have statement access.',tone:'warning'});return;}
  if(!available.some((item)=>item.key===module))module=available[0].key;
  const f=defaults(X);let categories=[];
  if(capable(X,'finance'))try{categories=await X.db.select('categories',`workspace_id=eq.${X.S.ws.id}&select=id,name&order=name.asc`);}catch{}
  const advanced=field({label:'Farm',name:'farmId',type:'select',value:f.farmId,options:[{value:'all',label:'All permitted farms'},...X.S.farms.map(farm=>({value:farm.id,label:farm.name}))]})+field({label:'From',name:'from',type:'date',value:f.from,required:true})+field({label:'Through',name:'to',type:'date',value:f.to,required:true})+'<div id="statement-status"></div>'+(categories.length?field({label:'Category',name:'category',type:'select',value:'all',options:[{value:'all',label:'All categories'},...categories.map(row=>({value:row.id,label:row.name}))]}):'');
  el.innerHTML=pageHeader({title:'Reports',description:'Choose a statement, check the preview, then download.'})+`<form class="ui-report-filters" id="statement-filters">${field({label:'Statement',name:'module',type:'select',value:module,options:available.map(item=>({value:item.key,label:item.label}))})}<details class="ui-report-advanced"><summary>Advanced filters</summary><div class="ui-report-advanced-fields">${advanced}</div></details>${button({label:'Refresh preview',type:'submit',variant:'secondary'})}</form><div class="ui-report-actions">${button({label:'Download PDF',attrs:{id:'statement-pdf',disabled:true}})}${actionMenu({label:'More report actions',text:'More actions',items:[{label:'Download Excel (.xlsx)',attrs:{id:'statement-xlsx',disabled:true}}]})}</div><div id="statement-export-status" aria-live="polite"></div><details class="caption muted"><summary>About the file formats</summary><p>${esc(PDF_TEXT_NOTE)}</p></details><div id="statement-preview" aria-live="polite"></div>`;
  const form=el.querySelector('#statement-filters'),preview=el.querySelector('#statement-preview'),pdf=el.querySelector('#statement-pdf'),xlsx=el.querySelector('#statement-xlsx');let generation=0,current=null,workerOptions=[];
  const workerField=(value='all')=>field({label:'Worker',name:'workerId',type:'select',value,options:[{value:'all',label:'All permitted workers'},...workerOptions]});
  function statuses(key){el.querySelector('#statement-status').innerHTML=field({label:'Status / type',name:'status',type:'select',value:'all',options:[{value:'all',label:'All'},...(statusOptions[key]||[]).map((value)=>({value,label:value}))]})+(key==='workers'?`<div id="statement-worker">${workerField()}</div>`:'');
    const category=form.querySelector('[name=category]');if(category){const show=['overview','finances','vendors','livestock'].includes(key);category.disabled=!show;category.closest('.field').hidden=!show;}
    const farm=form.querySelector('[name=farmId]');farm.disabled=['members','funding'].includes(key);if(farm.disabled)farm.value='all';
  }
  statuses(module);
  async function load(){const ticket=++generation;pdf.disabled=true;xlsx.disabled=true;current=null;preview.innerHTML=notice({title:'Preparing statement',text:'Loading the selected records…',tone:'info'});try{const values=Object.fromEntries(new FormData(form));const report=await createReport(X,{module:values.module,filters:values});if(ticket!==generation||!el.isConnected)return;current=report;if(report.module==='workers'){workerOptions=report.workerOptions||[];el.querySelector('#statement-worker').innerHTML=workerField(values.workerId||'all');}preview.innerHTML=statementPreview(report);pdf.disabled=false;xlsx.disabled=false;}catch(error){if(ticket===generation&&el.isConnected)preview.innerHTML=notice({title:'Statement unavailable',text:error.message,tone:'negative'});}}
  form.onchange=(event)=>{if(event.target.name==='module')statuses(event.target.value);load();};form.onsubmit=(event)=>{event.preventDefault();load();};
  const ownerUid=X.uid?.();
  const download=async(format)=>{if(!current)return;const report=current,status=el.querySelector('#statement-export-status');pdf.disabled=true;xlsx.disabled=true;const chosen=format==='pdf'?pdf:xlsx;chosen.setAttribute('aria-busy','true');status.innerHTML=notice({title:`Preparing ${format==='pdf'?'PDF':'Excel'}…`,text:'Keep this page open until your file is ready.'});try{await new Promise(resolve=>setTimeout(resolve,0));if(report!==current||report.workspaceId!==X.S.ws?.id||ownerUid!==X.uid?.()||!allowed(X,report.module))throw new Error('Your selection or access changed. Refresh the preview, then download again.');downloadStatement(report,format);status.innerHTML=notice({title:'File ready',text:'Your browser will save the statement.',tone:'positive'});X.toast?.(`${format==='pdf'?'PDF':'Excel'} file ready.`);}catch(error){status.innerHTML=notice({title:'The file couldn’t be prepared',text:error.message,tone:'negative'});X.toast?.(error.message,{tone:'negative'});}finally{chosen.setAttribute('aria-busy','false');if(report===current&&el.isConnected){pdf.disabled=false;xlsx.disabled=false;}}};
  pdf.onclick=()=>download('pdf');xlsx.onclick=()=>download('xlsx');await load();
}
