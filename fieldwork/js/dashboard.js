import * as C from './components.js';
import { renderChartCard, chartSVG } from './charts.js';

const $=(selector,el)=>el.querySelector(selector);
const dateOK=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const dayAfter=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);};
const dayBefore=value=>{const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-1);return date.toISOString().slice(0,10);};
export function dashboardPeriod(month,period='month',custom={}){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw new Error('Choose a valid reference month.');
  if(period==='custom'){
    if(!dateOK(custom.from)||!dateOK(custom.through)||custom.through<custom.from)throw new Error('Choose a start and end date in order.');
    return{from:custom.from,to_exclusive:dayAfter(custom.through)};
  }
  const months=({month:1,quarter:3,'half-year':6,year:12})[period];if(!months)throw new Error('Choose a valid period.');
  const [y,m]=month.split('-').map(Number);
  return{from:new Date(Date.UTC(y,m-months,1)).toISOString().slice(0,10),to_exclusive:new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)};
}
export function dashboardDrillURL(module,scope,filters={}){
  const allowed=new Set(['daily','finances','vendors','infrastructure','livestock','workers','funding','reports']);
  if(!allowed.has(module))return '#/overview';
  const params=new URLSearchParams({from:scope.from,to:scope.to_exclusive,farm:scope.farm_id||'all'});
  for(const[key,value]of Object.entries(filters))if(value!=null&&value!==''&&/^[a-z_]+$/.test(key))params.set(key==='farm_id'?'farm':key,String(value));
  return `#/${module}?${params}`;
}
export async function dashboard(el,X){
  const workspace=X.S.ws.id,uid=X.uid(),currency=X.S.ws.currency;
  const exponent=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
  const prefix=currency==='KES'?'KSh':currency;
  const amount=value=>value==null?'Unavailable':X.money(Number(value),currency);
  const compact=value=>{if(value==null||!Number.isFinite(Number(value)))return 'Unavailable';const n=Number(value)/10**exponent,a=Math.abs(n),scale=a>=1e6?1e6:a>=1e3?1e3:1,suffix=scale===1e6?'M':scale===1e3?'K':'';return `${prefix} ${new Intl.NumberFormat('en-KE',{maximumFractionDigits:scale===1?2:1}).format(n/scale)}${suffix}`;};
  const count=value=>value==null?'Unavailable':new Intl.NumberFormat('en-KE',{maximumFractionDigits:0}).format(Number(value));
  let period=['month','quarter','half-year','year'].includes(X.S.dashboardPeriod)?X.S.dashboardPeriod:'month',range=dashboardPeriod(X.S.month,period),generation=0,controllers=[],current=null,mode=X.filters?.view==='insights'?'insights':'summary',chartOptions=[];
  const active=()=>el.isConnected&&X.S.ws?.id===workspace&&X.uid()===uid;
  const destroy=()=>{controllers.forEach(controller=>controller.destroy());controllers=[];};
  const observer=new MutationObserver(()=>{if(!el.isConnected){destroy();observer.disconnect();}});observer.observe(el.parentElement,{childList:true});
  el.innerHTML=C.pageHeader({title:'Overview',eyebrow:'Farm performance',description:'Your money, people and field work, with the records behind every figure.',actions:C.actionMenu({label:'More dashboard actions',text:'More actions',items:[{label:'Overview report',attrs:{id:'dashboard-report'}}]})+(X.permissions.canWriteModule('daily')||X.canWrite()?C.button({label:X.S.farms.length?'Add a record':'Add first farm',attrs:{id:'dashboard-add'}}):'')})
    +C.tabs([{id:'summary',label:'Summary'},{id:'insights',label:'More insights'}],{active:mode,label:'Overview sections'})
    +`<form class="dashboard-toolbar" id="dashboard-period">${C.field({label:'Range',name:'period',type:'select',value:period,options:[{value:'month',label:'This month'},{value:'quarter',label:'Last 3 months'},{value:'half-year',label:'Last 6 months'},{value:'year',label:'Last 12 months'},{value:'custom',label:'Custom dates'}]})}<div id="dashboard-custom" hidden>${C.field({label:'From',name:'from',type:'date',value:range.from})}${C.field({label:'Through',name:'through',type:'date',value:dayBefore(range.to_exclusive)})}</div>${C.button({label:'Refresh',variant:'ghost',type:'submit'})}<span class="caption muted" id="dashboard-period-label"></span></form><div id="dashboard-message" aria-live="polite"></div><div class="dashboard-kpis" id="dashboard-kpis"></div><div class="dashboard-charts" id="dashboard-charts"></div><section class="card dashboard-attention" id="dashboard-attention" tabindex="-1"><h2>Needs attention</h2><div id="dashboard-attention-content"></div></section><div class="dashboard-notes caption muted" id="dashboard-notes"></div>`;
  $('#dashboard-report',el).onclick=()=>X.report('overview');$('#dashboard-add',el)?.addEventListener('click',()=>X.openAddRecord?.());
  el.querySelectorAll('[data-tab]').forEach(tab=>{tab.onclick=()=>{mode=tab.dataset.tab;X.setViewURL?.({view:mode==='insights'?'insights':null});el.querySelectorAll('[data-tab]').forEach(item=>{item.setAttribute('aria-selected',String(item===tab));item.tabIndex=item===tab?0:-1;});if(current)drawCharts();};});
  const form=$('#dashboard-period',el),message=$('#dashboard-message',el);
  const drill=(module,filters={})=>{if(!current)return;location.hash=dashboardDrillURL(module,current.scope,filters);};
  const chart=options=>chartOptions.push(options);
  function drawCharts(){destroy();$('#dashboard-charts',el).replaceChildren();$('#dashboard-kpis',el).hidden=mode==='insights';$('#dashboard-attention',el).hidden=mode==='insights';for(const options of chartOptions){const key=['monthly','categories','tasks'].includes(options.id);if(key!==(mode==='summary'))continue;const box=document.createElement('section');box.className='dashboard-chart';$('#dashboard-charts',el).append(box);controllers.push(renderChartCard(box,{unit:prefix,rawUnit:`${currency} minor units`,format:compact,tableFormat:amount,tooltipFormat:amount,...options,onFilter:({seriesKeys})=>X.toast(`Showing ${seriesKeys.length?seriesKeys.join(', '):'no series'}.`)}));}}
  function paint(data){
    destroy();current=data;chartOptions=[];$('#dashboard-charts',el).replaceChildren();
    const configs=[['income','Income','finances',{kind:'income'}],['expenses','Expenses','finances',{kind:'expense'}],['net','Net cash movement','finances',{}],['recorded_cash','Recorded month-end cash','finances',{tab:'budget'}],['task_completion','Recorded task completions','daily',{status:'done'}]];
    $('#dashboard-kpis',el).innerHTML=configs.filter(([key])=>data.kpis[key]&&(key==='task_completion'?data.scope.operations&&!data.scope.finance:data.scope.finance)).map(([key,label,module,filters])=>{
      const kpi=data.kpis[key],format=key==='task_completion'?count:compact;
      const change=kpi.change_pct==null?(kpi.trend==='new'?'New activity':kpi.previous==null?'Previous period unavailable':'No change'):`${kpi.change_pct>0?'↑':kpi.change_pct<0?'↓':'→'} ${Math.abs(Number(kpi.change_pct)).toFixed(1)}%`;
      return `<article class="card dashboard-kpi"><span class="caption muted">${label}</span><strong class="kpi" title="${C.escapeHTML(key==='task_completion'?count(kpi.value):amount(kpi.value))}">${kpi.available?C.escapeHTML(format(kpi.value)):'Unavailable'}</strong><span class="caption">${C.escapeHTML(change)} <span class="muted">vs previous period</span></span><div class="dashboard-sparkline" inert aria-hidden="true">${chartSVG({id:`kpi-${key}`,title:`${label} trend`,type:'sparkline',rows:kpi.sparkline||[],xKey:'month',series:[{key:'value',label}],format:key==='task_completion'?count:compact,width:240,height:64})}</div>${C.button({label:'View records',variant:'ghost',size:'sm',attrs:{'data-kpi':key,'aria-label':`View ${label.toLowerCase()} records`}})}</article>`;
    }).join('');
    el.querySelectorAll('[data-kpi]').forEach(btn=>{btn.onclick=()=>{const config=configs.find(item=>item[0]===btn.dataset.kpi);drill(config[2],config[3]);};});
    if(data.scope.finance){
      const emptyAction={label:'Add your first transaction',onClick:()=>drill('finances',{add:'1'})};
      chart({id:'monthly',title:'Income, expenses and net',description:'Recorded cash movement by month. Net is income less expenses.',type:'grouped-bar',rows:data.series.monthly,xKey:'month',series:[{key:'income',label:'Income'},{key:'expenses',label:'Expenses'},{key:'net',label:'Net',kind:'line'}],emptyChart:data.series.monthly.length>0&&data.series.monthly.every(row=>['income','expenses','net'].every(key=>row[key]===0)),emptyTitle:'No recorded cash movement',emptyText:'Income and expenses are zero across the displayed months. View the data table or choose another period.',emptyAction:X.permissions.canWriteModule('finances')?{label:'Add transaction',onClick:()=>drill('finances',{add:'1'})}:undefined,onDrill:({row,seriesKey})=>drill('finances',{from:row.month,to:new Date(Date.UTC(Number(row.month.slice(0,4)),Number(row.month.slice(5,7)),1)).toISOString().slice(0,10),...(seriesKey==='income'||seriesKey==='expenses'?{kind:seriesKey==='income'?'income':'expense'}:{})})});
      chart({id:'cash',title:'Recorded cash trend',description:'Month-end snapshots only. Missing snapshots remain unavailable.',type:'line',rows:data.series.recorded_cash,xKey:'month',series:[{key:'value',label:'Recorded cash'}],emptyAction:{label:'Record month-end cash',onClick:()=>drill('finances',{tab:'budget'})},onDrill:()=>drill('finances',{tab:'budget'})});
      chart({id:'categories',title:'Expenses by category',description:'Converted to the workspace reporting currency.',type:'donut',rows:data.expense_categories,xKey:'name',series:[{key:'amount',label:'Expenses'}],emptyAction,onDrill:({row})=>drill('finances',{kind:'expense',category_id:row.id})});
      chart({id:'budgets',title:'Expense budget versus actual',description:'Whole-month expense budgets compared with expenses in this period.',type:'grouped-bar',rows:data.budgets.expenses,xKey:'name',series:[{key:'budget',label:'Budget'},{key:'actual',label:'Actual'}],emptyAction:{label:'Set a budget',onClick:()=>drill('finances',{tab:'budget'})},onDrill:({row})=>drill('finances',{tab:'budget',farm:row.farm_id||'all',category_id:row.category_id})});
      chart({id:'income-targets',title:'Income targets versus actual',description:'Recorded income against your category targets.',type:'grouped-bar',rows:data.budgets.income,xKey:'name',series:[{key:'budget',label:'Target'},{key:'actual',label:'Income'}],emptyAction:{label:'Set an income target',onClick:()=>drill('finances',{tab:'budget'})},onDrill:({row})=>drill('finances',{tab:'budget',category_id:row.category_id})});
      chart({id:'farms',title:'Farm comparison',description:'Income and expense records by farm.',type:'grouped-bar',rows:data.farm_comparison,xKey:'name',series:[{key:'income',label:'Income'},{key:'expenses',label:'Expenses'},{key:'net',label:'Net',kind:'line'}],onDrill:({row})=>drill('finances',{farm:row.id||'all'})});
      chart({id:'enterprises',title:'Enterprise profitability',description:'Income less expenses explicitly linked to each enterprise.',type:'horizontal-bar',rows:data.enterprise_profitability,xKey:'name',series:[{key:'margin',label:'Recorded margin'}],emptyAction:{label:'Link enterprise transactions',onClick:()=>drill('finances')},onDrill:({row})=>drill('finances',{enterprise_id:row.id})});
      chart({id:'payroll',title:'Payroll share of expenses',description:'Recorded worker payments as a share of recorded expenses.',type:'progress',rows:data.payroll.expense_total==null?[]:[{label:'Recorded payroll',value:data.payroll.amount,target:data.payroll.expense_total,pct:data.payroll.pct}],xKey:'label',series:[{key:'value',label:'Worker pay'}],onDrill:()=>drill('finances',{source_type:'worker_pay'})});
      chart({id:'vendors',title:'Top vendors by spend',description:'Recorded expenses; supplier bills are tracked separately.',type:'horizontal-bar',rows:data.top_vendors,xKey:'name',series:[{key:'amount',label:'Spend'}],emptyAction,onDrill:({row})=>drill('finances',{kind:'expense',vendor_id:row.id})});
    }
    if(data.scope.operations){
      chart({id:'tasks',title:'Current task progress',description:'Daily and monthly routines use the farm calendar. Historical repeats are not reconstructed.',type:'progress',rows:[{label:'Complete now',value:data.tasks.completed,target:data.tasks.total,pct:data.tasks.pct}],emptyChart:data.tasks.total===0,xKey:'label',series:[{key:'value',label:'Complete'}],unit:'tasks',rawUnit:'tasks',format:count,tableFormat:count,tooltipFormat:count,emptyTitle:'No tasks yet',emptyText:'Add a daily routine, a monthly job or a one-time task.',emptyAction:X.permissions.canWriteModule('daily')?{label:'Add task',onClick:()=>drill('daily',{add:'1',tab:'tasks'})}:undefined,onDrill:()=>drill('daily',{status:'open'})});
      chart({id:'task-calendar',title:'Recorded task completions',description:'Each task stores its latest completion only; this is not a full history.',type:'heatmap',rows:data.series.task_completion,xKey:'date',series:[{key:'completed',label:'Latest recorded completions'}],unit:'tasks',rawUnit:'tasks',format:count,tableFormat:count,tooltipFormat:count,onDrill:({row})=>drill('daily',{status:'done',completed_on:row.date})});
    }
    const attention=$('#dashboard-attention-content',el);
    attention.innerHTML=data.attention.length?`<ul class="dashboard-attention-list">${data.attention.map((item,index)=>`<li><div><strong>${C.escapeHTML(item.title)}</strong><p class="caption muted">${C.escapeHTML(item.date||'Review required')}${item.amount==null?'':` · ${C.escapeHTML(X.money(item.amount,item.currency||currency))}`}</p></div>${C.badge({label:item.severity||'Review',tone:item.severity==='overdue'?'negative':'warning'})}${C.button({label:'Review',variant:'secondary',size:'sm',attrs:{'data-attention':index}})}</li>`).join('')}</ul>`:C.emptyState({title:'No urgent items',text:'No overdue tasks, unrecorded scheduled payments or approaching deadlines were found in this view.'});
    attention.querySelectorAll('[data-attention]').forEach(btn=>{btn.onclick=()=>{const item=data.attention[Number(btn.dataset.attention)],action=item.action||{};drill(action.module||'daily',{...action.filters,...(action.id?{id:action.id}:{}),...(action.tab?{tab:action.tab}:{})});};});
    $('#dashboard-notes',el).innerHTML=`<details><summary>About these figures</summary>${(data.notes||[]).map(note=>`<p>${C.escapeHTML(note)}</p>`).join('')}</details>`;drawCharts();
  }
  async function load(){
    const ticket=++generation;message.innerHTML='';el.setAttribute('aria-busy','true');const btn=form.querySelector('button');btn.disabled=true;btn.setAttribute('aria-busy','true');
    if(!current){$('#dashboard-kpis',el).innerHTML=C.skeletonRows({rows:1,columns:4});$('#dashboard-charts',el).innerHTML=Array.from({length:4},()=>`<section class="card dashboard-chart-loading">${C.skeletonRows({rows:4,columns:3})}</section>`).join('');}
    try{
      const values=Object.fromEntries(new FormData(form));period=values.period;range=dashboardPeriod(X.S.month,period,{from:values.from,through:values.through});X.S.dashboardPeriod=period;
      const data=await X.db.rpc('fw_dashboard',{p_workspace_id:workspace,p_from:range.from,p_to:range.to_exclusive,p_farm_id:X.S.farmId==='all'?null:X.S.farmId});
      if(ticket!==generation||!active())return;if(data?.version!=='20261118-dashboard-v1')throw new Error('The dashboard needs the reviewed database upgrade. Ask your workspace administrator to install it.');
      $('#dashboard-period-label',el).textContent=`${data.scope.from} – ${dayBefore(data.scope.to_exclusive)}`;paint(data);
    }catch(error){if(ticket!==generation||!active())return;const missing=[400,404].includes(error.status)&&/function|schema|fw_dashboard/i.test(error.message);message.innerHTML=C.notice({title:missing?'Dashboard upgrade required':'Dashboard couldn’t refresh',text:missing?'The reviewed database migration calculates these figures securely. Your existing module records are still available.':`${error.message} Try refreshing after checking your connection.`,tone:missing?'warning':'negative',action:C.button({label:'Try again',variant:'secondary',attrs:{id:'dashboard-retry'}})});$('#dashboard-retry',el).onclick=load;if(!current){$('#dashboard-kpis',el).replaceChildren();$('#dashboard-charts',el).replaceChildren();}}
    finally{if(ticket===generation&&active()){el.setAttribute('aria-busy','false');btn.disabled=false;btn.setAttribute('aria-busy','false');}}
  }
  form.onchange=()=>{$('#dashboard-custom',el).hidden=form.elements.period.value!=='custom';load();};form.onsubmit=event=>{event.preventDefault();load();};
  await load();return{refresh:load,destroy:()=>{destroy();observer.disconnect();}};
}
