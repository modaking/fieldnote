import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as realComponents from '../js/components.js';
import * as realNavigation from '../js/navigation.js';
import * as pagination from '../js/read-all.js';
import {sectionDOM} from './helpers/dom-tree.mjs';
const panelSource=await readFile(new URL('../js/navigation-ui.js',import.meta.url),'utf8');
const feedbackSource=await readFile(new URL('../js/feedback.js',import.meta.url),'utf8');
const financeSource=await readFile(new URL('../js/finance.js',import.meta.url),'utf8');
async function harness(){
  const prompts=[],messages=[],panels=[];let settle,dirty=true,saving=false,drawerForm=false;
  const elements=new Map(),control=selector=>{if(!elements.has(selector))elements.set(selector,{value:'',focus(){},querySelector(){return null;},querySelectorAll(){return[];}});return elements.get(selector);};
  const dialog={open:false,close(){this.open=false;},querySelector:selector=>selector==='form'?(drawerForm?control(selector):null):control(selector),querySelectorAll(){return[];}};
  const context=vm.createContext({URLSearchParams,location:{hash:'#/account'},document:{activeElement:null}});
  const components={confirmDialog:options=>{prompts.push(options);return new Promise(resolve=>settle=resolve);},toast:message=>messages.push(message),input:()=>'<input>',button:()=>'<button>',emptyState:()=>'<p>Empty</p>',openPanel:(dlg,options)=>{dlg.open=true;const panel={...options,close:()=>dlg.close()};panels.push(panel);return panel;}};
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[k,v]of Object.entries(values))this.setExport(k,v);},{context});
  const c=synthetic(components),feedback=new vm.SourceTextModule(feedbackSource,{context});await feedback.link(()=>c);await feedback.evaluate();
  const registry=synthetic({PAGES:[{id:'overview',label:'Overview'}],SECTIONS:[],availableSections:()=>[],sectionURL:()=> '#/overview',recentItems:()=>[]});
  const panel=new vm.SourceTextModule(panelSource,{context});await panel.link(specifier=>specifier==='./components.js'?c:specifier==='./feedback.js'?feedback:registry);await panel.evaluate();
  const element={isConnected:true};feedback.namespace.registerUnsaved({element,isDirty:()=>dirty,isSaving:()=>saving});
  const X={dlg:()=>dialog,uid:()=> 'user',S:{ws:{id:'workspace'},farms:[]},permissions:{canReadModule:()=>true},migrationReady:true};
  return{api:panel.namespace,feedback:feedback.namespace,X,dialog,prompts,messages,panels,setDirty:v=>dirty=v,setSaving:v=>saving=v,setDrawerForm:v=>drawerForm=v,settle:v=>settle(v)};
}
test('dismissing Search or More preserves inline Profile registration and later discard checks',async()=>{
  for(const method of ['openCommandPalette','openMoreNavigation']){
    const h=await harness();await h.api[method](h.X);assert.equal(h.prompts.length,0,'temporary menus do not discard an inline profile');assert.equal(h.feedback.hasUnsavedChanges(),true);h.panels[0].close();
    h.setDirty(false);assert.equal(h.feedback.hasUnsavedChanges(),false);h.setDirty(true);assert.equal(h.feedback.hasUnsavedChanges(),true,'later edits still use the original registration');
    const leaving=h.feedback.confirmLeave();assert.equal(h.prompts.length,1);h.settle(false);assert.equal(await leaving,false);assert.equal(h.feedback.hasUnsavedChanges(),true);
  }
});
test('temporary menu dismissal preserves inline saving guard',async()=>{
  const h=await harness();h.setSaving(true);await h.api.openCommandPalette(h.X);h.panels[0].close();assert.equal(await h.feedback.confirmLeave(),false);assert.equal(h.prompts.length,0);assert.match(h.messages.at(-1),/finish saving/);
});
test('Search and More cannot overwrite a saving form drawer or a cancelled dirty drawer',async()=>{
  for(const method of ['openCommandPalette','openMoreNavigation']){
    const h=await harness();h.dialog.open=true;h.setDrawerForm(true);h.setSaving(true);await h.api[method](h.X);assert.equal(h.panels.length,0);assert.equal(h.dialog.open,true);
    h.setSaving(false);const opening=h.api[method](h.X);assert.equal(h.prompts.length,1);h.settle(false);await opening;assert.equal(h.panels.length,0);assert.equal(h.dialog.open,true);
  }
});

async function sectionHarness(){
  const dom=sectionDOM(),calls=[],reports=[],messages=[];
  const context=vm.createContext({URLSearchParams,Intl,Date,MutationObserver:dom.MutationObserver,location:{hash:'#/finances?section=budgets'}});
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[key,value]of Object.entries(values))this.setExport(key,value);},{context});
  const dependencies=new Map([
    ['./components.js',synthetic(realComponents)],['./navigation.js',synthetic(realNavigation)],
    ['./feedback.js',synthetic({confirmLeave:async()=>true,registerUnsaved:()=>()=>{}})],
    ['./read-all.js',synthetic(pagination)],['./crud.js',synthetic({resource:async()=>{},minorAmount:value=>Number(value)*100})],
  ]);
  const link=specifier=>{const found=dependencies.get(specifier);assert.ok(found,`Unexpected module ${specifier}`);return found;};
  const panel=new vm.SourceTextModule(panelSource,{context}),finance=new vm.SourceTextModule(financeSource,{context});
  await panel.link(link);await finance.link(link);await panel.evaluate();await finance.evaluate();
  let saved=null,releaseClose,closing=false;
  const result=()=>({schema_version:'20261118-finance',period:{from:'2026-11-01',to:'2026-12-01'},currency:'KES',totals:{income:300,expenses:100,net:200,opening:500,calculated_closing:700,saved_closing:saved,opening_recorded:true},categories:[{id:'feed',name:'Feed',kind:'expense',budget:150,actual:100,variance:50,pct:66.67,can_budget:true}],sections:{income:{budget:0,actual:300},expense:{budget:150,actual:100}}});
  const X={S:{ws:{id:'workspace-a',currency:'KES'},farms:[],farmId:'farm-a',month:'2026-11'},migrationReady:true,uid:()=> 'user',esc:realComponents.escapeHTML,money:value=>String(value),toast:message=>messages.push(message),canWrite:()=>true,canReport:()=>true,report:key=>reports.push(key),monthRange:()=>['2026-11-01','2026-12-01'],permissions:{canReadModule:()=>true,canWriteModule:()=>true},db:{
    rpc:async(name,args)=>{calls.push({name,args});if(name==='fw_close_month'){closing=true;await new Promise(resolve=>releaseClose=resolve);saved=700;}return result();},
    select:async(table,query)=>{calls.push({name:'select',table,query});return new URLSearchParams(query).get('offset')==='0'?[{id:'old-budget',category_id:'feed',amount:125}]:[];},
    upsert:async(table,payload)=>calls.push({name:'upsert',table,payload}),
  }};
  return{...dom,api:panel.namespace,finance:finance.namespace,X,calls,reports,messages,releaseClose:()=>releaseClose(),isClosing:()=>closing};
}

test('section headers retain real Budget Close, Copy and Report handlers and their pending scope across rerenders',async()=>{
  const h=await sectionHarness();await h.api.renderSectionPage(h.el,h.X,{page:'finances',section:'budgets'},{budgets:h.finance.budget});h.flush();
  const box=h.el.querySelector('#section-content'),navigation=h.el.querySelector('.section-navigation'),header=box.querySelector('.ui-page-header');
  assert.ok(header,'The real finance header must remain inside its module.');assert.equal(header.nextElementSibling,navigation);assert.equal(h.el.querySelector('#section-heading').hidden,true);
  const close=box.querySelector('#close'),copy=box.querySelector('#copy'),report=box.querySelector('#budget-report');
  await report.click();assert.deepEqual(h.reports,['finances']);
  const saving=close.click();assert.equal(h.isClosing(),true);assert.equal(close.disabled,true);assert.equal(copy.disabled,true);assert.equal(report.disabled,true);
  await close.click();assert.equal(h.calls.filter(call=>call.name==='fw_close_month').length,1);
  h.releaseClose();await saving;h.flush();
  assert.equal(box.querySelector('.ui-page-header').nextElementSibling,navigation,'The same navigation controls must survive the budget rerender.');
  assert.equal(box.querySelector('#close').disabled,false);await box.querySelector('#copy').click();h.flush();
  assert.equal(h.calls.filter(call=>call.name==='upsert'&&call.table==='budgets').length,1);
  await box.querySelector('#budget-report').click();assert.deepEqual(h.reports,['finances','finances']);
  assert.equal(box.querySelector('.ui-page-header').nextElementSibling,navigation);assert.ok(h.messages.includes('Month closed. Next month opens with this balance.'));
});

test('section navigation keeps native bubbling and post-await header bindings without double dispatch',async()=>{
  const h=await sectionHarness();let direct=0,delegated=0,listener=0;
  const view=async box=>{
    box.innerHTML='<header class="ui-page-header"><button id="late-header-action">Report</button><button id="forwarded-action">Add checklist</button></header><section>Records</section>';
    h.flush();await Promise.resolve();
    box.querySelector('#late-header-action')?.addEventListener('click',()=>direct++);
    box.onclick=event=>{assert.equal(event.currentTarget,box);delegated++;};
    box.addEventListener('click',()=>listener++);
    box.querySelector('#forwarded-action').addEventListener('click',event=>{event.stopPropagation();box.onclick(event);});
  };
  // Checklist's existing explicit forward uses the originating event; assert
  // native currentTarget only for normally bubbling actions below.
  await h.api.renderSectionPage(h.el,h.X,{page:'operations',section:'tasks'},{tasks:view});h.flush();
  const box=h.el.querySelector('#section-content');await box.querySelector('#late-header-action').click();
  assert.equal(direct,1);assert.equal(delegated,1);assert.equal(listener,1);
  box.onclick=()=>delegated++;await box.querySelector('#forwarded-action').click();
  assert.equal(delegated,2,'The existing checklist-style forward must fire once.');assert.equal(listener,1);
});
