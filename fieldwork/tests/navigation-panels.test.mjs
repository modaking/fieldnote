import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const panelSource=await readFile(new URL('../js/navigation-ui.js',import.meta.url),'utf8');
const feedbackSource=await readFile(new URL('../js/feedback.js',import.meta.url),'utf8');
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
