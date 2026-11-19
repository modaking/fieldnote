import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { dashboard, dashboardPeriod, dashboardDrillURL } from '../js/dashboard.js';
import { sampleDashboard, previewRequest } from '../tools/preview.mjs';
import { sectionDOM } from './helpers/dom-tree.mjs';

test('dashboard periods use complete rolling months across year and leap boundaries',()=>{
  assert.deepEqual(dashboardPeriod('2026-01','quarter'),{from:'2025-11-01',to_exclusive:'2026-02-01'});
  assert.deepEqual(dashboardPeriod('2026-11','half-year'),{from:'2026-06-01',to_exclusive:'2026-12-01'});
  assert.deepEqual(dashboardPeriod('2026-11','year'),{from:'2025-12-01',to_exclusive:'2026-12-01'});
  assert.deepEqual(dashboardPeriod('2024-02'),{from:'2024-02-01',to_exclusive:'2024-03-01'});
});

test('custom dates convert an inclusive through date to the SQL exclusive end',()=>{
  assert.deepEqual(dashboardPeriod('2024-02','custom',{from:'2024-02-29',through:'2024-02-29'}),{from:'2024-02-29',to_exclusive:'2024-03-01'});
  for(const [month,period,custom]of [['2026-13','month'],['2026-11','unknown'],['2026-11','custom',{from:'2026-02-30',through:'2026-03-01'}],['2026-11','custom',{from:'2026-03-02',through:'2026-03-01'}]])assert.throws(()=>dashboardPeriod(month,period,custom));
});

test('dashboard contract compares complete calendar windows with matching complete preceding months',()=>{
  for(const [month,period,previous]of [['2026-11','month','2026-10-01'],['2024-02','month','2024-01-01'],['2026-11','quarter','2026-06-01'],['2026-11','half-year','2025-12-01'],['2026-11','year','2024-12-01']]){
    const range=dashboardPeriod(month,period),data=sampleDashboard('owner',{p_workspace_id:'workspace-a',p_from:range.from,p_to:range.to_exclusive});
    assert.equal(data.scope.previous_from,previous,`${month} ${period}`);assert.equal(data.scope.previous_to_exclusive,range.from);
  }
  const range=dashboardPeriod('2026-11','custom',{from:'2026-11-02',through:'2026-11-30'});
  const custom=sampleDashboard('owner',{p_workspace_id:'workspace-a',p_from:range.from,p_to:range.to_exclusive});
  assert.equal(custom.scope.previous_from,'2026-10-04','arbitrary 29-day range uses the preceding 29 days');
});

test('chart drills preserve SQL period and select the attention item farm',()=>{
  const scope={from:'2026-11-01',to_exclusive:'2026-12-01',farm_id:null};
  const url=dashboardDrillURL('vendors',scope,{farm_id:'farm-a',vendor_id:'vendor-1',status:'outstanding',tab:'bills'});
  const [route,query]=url.split('?'),params=new URLSearchParams(query);
  assert.equal(route,'#/vendors');assert.equal(params.get('farm'),'farm-a');
  assert.equal(params.get('from'),scope.from);assert.equal(params.get('to'),scope.to_exclusive);
  assert.equal(params.get('vendor_id'),'vendor-1');assert.equal(params.get('tab'),'bills');
  assert.equal(scope.farm_id,null,'building a drill does not change the dashboard scope');
});

test('chart drills encode search text and cannot navigate to an unapproved module',()=>{
  const scope={from:'2026-11-01',to_exclusive:'2026-12-01',farm_id:'farm-b'};
  const url=dashboardDrillURL('daily',scope,{q:'Water & feed #1 <today>',status:'open','bad-key':'drop',empty:''});
  const params=new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('q'),'Water & feed #1 <today>');assert.equal(params.get('farm'),'farm-b');
  assert.equal(params.has('bad-key'),false);assert.equal(params.has('empty'),false);
  assert.equal(dashboardDrillURL('members',scope),'#/overview');assert.equal(dashboardDrillURL('https://example.invalid',scope),'#/overview');
});

const reference=sampleDashboard('owner',{p_workspace_id:'workspace-a',p_from:'2026-01-01',p_to:'2026-02-01'}).scope.as_of.slice(0,7);
const range=dashboardPeriod(reference);
const args={p_workspace_id:'workspace-a',p_from:range.from,p_to:range.to_exclusive};

test('local synthetic dashboard matches its minor-unit contract and shared sample records',()=>{
  const data=sampleDashboard('owner',args);
  assert.equal(data.version,'20261118-dashboard-v1');assert.equal(data.scope.finance,true);assert.equal(data.scope.operations,true);
  assert.equal(data.kpis.income.value,1000000);assert.equal(data.kpis.expenses.value,940000);assert.equal(data.kpis.net.value,60000);
  assert.equal(data.payroll.amount,450000);assert.equal(data.expense_categories.reduce((sum,row)=>sum+row.amount,0),940000);
  assert.equal(data.series.monthly.length,6);assert.equal(data.series.monthly.at(-1).net,60000);
  const previousMonth=data.series.monthly.find(row=>row.month===data.scope.previous_from);
  assert.ok(previousMonth);assert.equal(data.kpis.income.previous,previousMonth.income);assert.equal(data.kpis.expenses.previous,previousMonth.expenses,'default month comparison matches the full monthly trend');
  assert.equal(data.kpis.recorded_cash.value,2400000);assert.equal(data.cash_coverage.recorded_rows,2);
  assert.equal(data.budgets.expenses.find(r=>r.name==='Seed').actual,240000);
  assert.equal(data.budgets.income[0].actual,1000000);assert.equal(data.enterprise_profitability[0].margin,760000);
  assert.equal(data.tasks.total,6);assert.equal(data.tasks.completed,3);assert.equal(data.tasks.overdue,2);
  assert.equal(data.attention_count,data.attention.length);assert.ok(data.attention.some(i=>i.kind==='bill_due'&&i.amount===130000));
  assert.ok(data.notes.some(note=>/LOCAL SIMULATION/.test(note)),'sample response identifies itself as simulated');
  assert.equal(JSON.stringify(data).includes('Other workspace sale'),false);
});

test('local preview reproduces unavailable financial data and assigned-farm operational scope',()=>{
  for(const role of ['worker','viewer']){
    const data=sampleDashboard(role,args);
    assert.equal(data.scope.finance,false);assert.equal(data.scope.operations,true);
    for(const key of ['income','expenses','net','recorded_cash']){assert.equal(data.kpis[key].available,false);assert.equal(data.kpis[key].value,null);}
    assert.equal(data.payroll,null);assert.deepEqual(data.series.monthly,[]);assert.deepEqual(data.top_vendors,[]);
    assert.equal(data.tasks.total,3);assert.equal(data.tasks.completed,1);assert.equal(data.farm_comparison.length,1);
    assert.ok(data.attention.every(item=>item.kind==='overdue_task'));
    assert.throws(()=>sampleDashboard(role,{...args,p_farm_id:'farm-b'}),/unavailable/);
  }
  const data=sampleDashboard('accountant',args);assert.equal(data.scope.operations,false);assert.equal(data.tasks,null);
  assert.equal(data.kpis.task_completion.available,false);assert.deepEqual(data.series.task_completion,[]);
  assert.ok(data.attention.every(item=>item.kind!=='overdue_task'));
});

test('local preview does not carry closing snapshots or fabricate profit in an empty period',()=>{
  const data=sampleDashboard('owner',{...args,p_from:'2020-01-01',p_to:'2020-02-01'});
  assert.equal(data.kpis.recorded_cash.value,null);assert.equal(data.kpis.income.value,0);
  assert.equal(data.enterprise_profitability[0].margin,null);assert.equal(data.kpis.income.change_pct,null);
  assert.equal(data.kpis.income.trend,'flat');assert.ok(data.series.recorded_cash.every(row=>row.value===null));
  assert.throws(()=>sampleDashboard('owner',{...args,p_workspace_id:'unknown'}),/unavailable/);
  assert.throws(()=>sampleDashboard('owner',{...args,p_from:'2026-02-30'}),/valid/);
});

// Exercise the real dashboard and shared chart controller against a DOM boundary;
// database aggregates are supplied intact, without creating any farm records.
async function dashboardHost(data,{write=true}={}){
  const tree=sectionDOM(),proto=tree.Element.prototype,originals=new Map(['document','MutationObserver','FormData','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  proto.append=function(...nodes){this.replaceChildren(...this.children,...nodes);};
  proto.removeEventListener=function(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));};
  const closest=proto.closest;proto.closest=function(selector){for(const part of selector.split(',')){const found=closest.call(this,part);if(found)return found;}return null;};
  Object.defineProperty(proto,'elements',{get(){return Object.fromEntries(this.querySelectorAll('[name]').map(node=>[node.attrs.name,node]));}});
  const document={createElement:tag=>new tree.Element(tag),activeElement:null};
  const location={hash:'#/overview'};
  const FormData=class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const node of this.form.querySelectorAll('[name]'))yield[node.attrs.name,node.tag==='select'?(node.querySelector('option[selected]')||node.querySelector('option'))?.attrs.value||'':node.value];}};
  for(const[key,value]of Object.entries({document,MutationObserver:tree.MutationObserver,FormData,location}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const X={S:{ws:{id:'workspace-a',currency:'KES'},farms:[{id:'farm-a'}],month:'2026-11',farmId:'all'},uid:()=> 'own-test-user',permissions:{canWriteModule:()=>write},canWrite:()=>write,money:v=>`KSh ${v/100}`,toast(){},report(){},db:{rpc:async()=>data}};
  let controller;
  try{controller=await dashboard(tree.el,X);}catch(error){restore();throw error;}
  function restore(){controller?.destroy();for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  return{...tree,location,restore};
}
function emptyDashboard(){
  const data=sampleDashboard('owner',{...args,p_from:'2020-01-01',p_to:'2020-02-01'});
  data.tasks={completed:0,open:0,overdue:0,total:0,pct:null};data.attention=[];return data;
}

test('zero-task dashboard offers the existing scoped add-task path without an unavailable percentage',async()=>{
  for(const write of [true,false]){
    const data=emptyDashboard(),before=structuredClone(data),h=await dashboardHost(data,{write});
    try{
      const body=h.el.querySelector('#tasks-body'),chart=body.parentElement.parentElement;assert.match(chart.innerHTML,/No tasks yet/);assert.doesNotMatch(chart.innerHTML,/Unavailable|Complete now/);
      const add=body.querySelector('[data-chart-empty]');assert.equal(Boolean(add),write);
      if(add){await add.click();const params=new URLSearchParams(h.location.hash.split('?')[1]);assert.match(h.location.hash,/^#\/daily\?/);assert.equal(params.get('add'),'1');assert.equal(params.get('tab'),'tasks');assert.equal(params.get('from'),data.scope.from);assert.equal(params.get('farm'),'all');}
      assert.equal(chart.querySelector('[data-chart-csv]').disabled,false);assert.equal(chart.querySelector('[data-chart-table]').disabled,false);
      await chart.querySelector('[data-chart-table]').click();assert.match(chart.innerHTML,/resource-table ui-table/);assert.match(chart.innerHTML,/Complete now/);assert.match(chart.innerHTML,/>0<\/td>/);
      assert.deepEqual(data,before,'presentation does not change database counts or null percentage');
    }finally{h.restore();}
  }
});

test('all-zero cash movement uses a truthful empty summary and keeps its zero data table',async()=>{
  const data=emptyDashboard(),before=structuredClone(data),h=await dashboardHost(data);
  try{
    const body=h.el.querySelector('#monthly-body'),chart=body.parentElement.parentElement;assert.match(chart.innerHTML,/No recorded cash movement/);assert.doesNotMatch(chart.innerHTML,/first transaction|no transactions|<svg|0\.01/i);
    await chart.querySelector('[data-chart-table]').click();assert.match(chart.innerHTML,/resource-table ui-table/);
    assert.equal(chart.querySelector('[data-chart-csv]').disabled,false);assert.deepEqual(data,before);
  }finally{h.restore();}
});

test('equal nonzero income and expenses still display a chart when net is zero',async()=>{
  const data=emptyDashboard();Object.assign(data.series.monthly.at(-1),{income:10000,expenses:10000,net:0});data.tasks={completed:0,open:1,overdue:0,total:1,pct:0};
  const h=await dashboardHost(data);
  try{assert.ok(h.el.querySelector('#monthly-body').querySelector('svg'));assert.doesNotMatch(h.el.querySelector('#monthly-body').parentElement.parentElement.innerHTML,/No recorded cash movement/);assert.ok(h.el.querySelector('#tasks-body').querySelector('svg'));assert.match(h.el.querySelector('#tasks-body').parentElement.parentElement.innerHTML,/Complete now/);}finally{h.restore();}
});

// Call the real dev handler with memory streams: no server, port or network call.
async function preview(url,{method='GET',data,token}={}){
  const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
  Object.assign(req,{url,method,headers:token?{authorization:'Bearer '+token}:{}});
  let status=200;const headers={};let output;
  const res={setHeader(key,value){headers[key]=value;},writeHead(code,values={}){status=code;Object.assign(headers,values);},end(value=''){output=Buffer.isBuffer(value)?value.toString():String(value);}};
  await previewRequest(req,res);let body;try{body=JSON.parse(output);}catch{body=output;}return{status,headers,body};
}

test('local preview Auth and account endpoints return exact own-account shapes without any service connection',async()=>{
  const login=await preview('/__preview/auth/v1/token?grant_type=password',{method:'POST',data:{email:'admin@fieldwork.test',password:'sample123'}});
  assert.equal(login.status,200);const token=login.body.access_token,claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.equal(claims.sub,'preview-admin');assert.equal(claims.aal,'aal1');assert.equal(claims.amr[0].method,'password');
  const call=(name,data={})=>preview('/__preview/rest/v1/rpc/'+name,{method:'POST',token,data});
  const me=await preview('/__preview/auth/v1/user',{token});assert.equal(me.body.email,'admin@fieldwork.test');
  const context=await call('fw_account_context');assert.equal(context.body.schema_version,'20261118-account');
  assert.equal(context.body.profile.id,'preview-admin');assert.equal(context.body.profile.time_zone,'Africa/Nairobi');assert.equal(context.body.notifications.email,false);
  const spaces=await call('fw_account_workspaces');assert.equal(spaces.body.length,2);assert.ok(spaces.body.every(w=>w.role==='admin'));
  const sessions=await call('fw_account_sessions');assert.equal(sessions.body.available,true);assert.equal(sessions.body.sessions[0].current,true);
  assert.deepEqual((await call('fw_account_invites')).body,[]);
  const unavailable=await preview('/api/account',{token});assert.equal(unavailable.body.delete_available,false);assert.match(unavailable.body.message,/not simulated/);
  const dashboard=await call('fw_dashboard',args);assert.equal(dashboard.status,200);assert.equal(dashboard.body.version,'20261118-dashboard-v1');
  await preview('/__preview/rest/v1/profiles?id=eq.preview-admin',{method:'PATCH',token,data:{full_name:'Updated synthetic administrator'}});
  assert.equal((await call('fw_account_context')).body.profile.full_name,'Updated synthetic administrator');
  assert.deepEqual((await preview('/__preview/rest/v1/profiles?id=eq.preview-owner',{token})).body,[],'sample profile reads stay self-only');
});

test('sample provider discovery hides Google while invitation proof and email delivery stay explicitly disconnected',async()=>{
  assert.deepEqual((await preview('/__preview/auth/v1/settings')).body,{external:{google:false,email:true},disable_signup:false});
  const login=await preview('/__preview/auth/v1/token?grant_type=password',{method:'POST',data:{email:'viewer@fieldwork.test',password:'sample123'}}),token=login.body.access_token;
  const status=()=>preview('/__preview/rest/v1/rpc/fw_invitation_verification',{method:'POST',token,data:{}});
  assert.deepEqual((await status()).body,{needs_recovery:true,proof_recent:false});
  const complete=await preview('/__preview/rest/v1/rpc/fw_complete_invite_recovery',{method:'POST',token,data:{}});assert.equal(complete.status,403);assert.match(complete.body.message,/disconnected.*LOCAL SAMPLE/);
  assert.deepEqual((await status()).body,{needs_recovery:true,proof_recent:false});
  for(const action of ['recover','otp']){const sent=await preview('/__preview/auth/v1/'+action,{method:'POST',token,data:{email:'viewer@fieldwork.test',code_challenge:'synthetic-only',code_challenge_method:'s256'}});assert.equal(sent.status,400);assert.match(sent.body.message,/not connected.*LOCAL SAMPLE/);}
});

test('local authenticator is explicitly synthetic and accepts only the published sample code',async()=>{
  const login=await preview('/__preview/auth/v1/token?grant_type=password',{method:'POST',data:{email:'manager@fieldwork.test',password:'sample123'}}),token=login.body.access_token;
  const enrolled=await preview('/__preview/auth/v1/factors',{method:'POST',token,data:{factor_type:'totp',friendly_name:'Sample test'}});
  assert.equal(enrolled.status,200);assert.match(enrolled.body.totp.secret,/LOCAL_SAMPLE/);
  const path='/__preview/auth/v1/factors/'+enrolled.body.id;
  assert.equal((await preview(path+'/verify',{method:'POST',token,data:{code:'123456'}})).status,400);
  const verified=await preview(path+'/verify',{method:'POST',token,data:{code:'000000'}});
  assert.equal(JSON.parse(Buffer.from(verified.body.access_token.split('.')[1],'base64url')).aal,'aal2');
  assert.equal((await preview('/__preview/auth/v1/user',{token})).body.factors[0].status,'verified');
  assert.equal((await preview(path,{method:'DELETE',token})).status,200);
});

test('preview labels simulations and serves app assets while excluding private/project files',async()=>{
  assert.match((await preview('/')).body,/LOCAL SAMPLE PREVIEW/);
  assert.equal((await preview('/.env')).status,404);assert.equal((await preview('/db/schema.sql')).status,404);
  assert.equal((await preview('/__preview/rest/v1/rpc/fw_dashboard',{method:'POST',data:args})).status,401);
});
