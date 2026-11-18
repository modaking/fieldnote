import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../js/feedback.js',import.meta.url),'utf8');
async function harness(){
  const dialogs=[],messages=[];let finish;
  const context=vm.createContext({});
  const module=new vm.SourceTextModule(source,{context});
  await module.link(()=>new vm.SyntheticModule(['confirmDialog','toast'],function(){
    this.setExport('confirmDialog',options=>{dialogs.push(options);return new Promise(resolve=>{finish=resolve;});});
    this.setExport('toast',message=>messages.push(message));
  },{context}));await module.evaluate();
  return {api:module.namespace,dialogs,messages,finish:value=>finish(value)};
}
test('navigation considers only active connected dirty forms and unregisters explicitly',async()=>{
  const h=await harness(),element={isConnected:true};let dirty=false,open=true;
  const unregister=h.api.registerUnsaved({element,isDirty:()=>dirty,isActive:()=>open});
  assert.equal(h.api.hasUnsavedChanges(),false);dirty=true;assert.equal(h.api.hasUnsavedChanges(),true);
  open=false;assert.equal(h.api.hasUnsavedChanges(),false);open=true;element.isConnected=false;assert.equal(h.api.hasUnsavedChanges(),false);
  element.isConnected=true;assert.equal(h.api.hasUnsavedChanges(),false,'Detached form registrations are released.');
  const release=h.api.registerUnsaved({element,isDirty:()=>true});release();unregister();assert.equal(h.api.hasUnsavedChanges(),false);
});
test('concurrent leave attempts share one discard dialog and preserve a cancelled draft',async()=>{
  const h=await harness();h.api.registerUnsaved({element:{isConnected:true},isDirty:()=>true});
  const one=h.api.confirmLeave(),two=h.api.confirmLeave();assert.equal(h.dialogs.length,1);
  h.finish(false);assert.equal(await one,false);assert.equal(await two,false);assert.equal(h.api.hasUnsavedChanges(),true);
  const next=h.api.confirmLeave();h.finish(true);assert.equal(await next,true);assert.equal(h.dialogs.length,2);
});
test('an in-flight save blocks navigation and account invalidation clears old drafts',async()=>{
  const h=await harness();h.api.registerUnsaved({element:{isConnected:true},isDirty:()=>true,isSaving:()=>true});
  assert.equal(await h.api.confirmLeave(),false);assert.equal(h.dialogs.length,0);assert.match(h.messages[0],/finish saving/);
  h.api.clearUnsavedChanges();assert.equal(h.api.hasUnsavedChanges(),false);assert.equal(await h.api.confirmLeave(),true);
});
test('a previous account discard response cannot authorize navigation after invalidation',async()=>{
  const h=await harness();h.api.registerUnsaved({element:{isConnected:true},isDirty:()=>true});
  const leaving=h.api.confirmLeave();h.api.clearUnsavedChanges();h.finish(true);assert.equal(await leaving,false);
});
