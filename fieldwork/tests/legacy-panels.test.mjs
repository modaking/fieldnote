import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// A tree-aware DOM boundary double: moving a header really changes the native
// bubbling path, unlike the flat template doubles used by data-entry tests.
function dom(){
  const observers=new Set();
  const changed=node=>{for(const observer of observers){if(!observer.target||!(observer.target===node||observer.options.subtree&&observer.target.contains(node))||observer.queued)continue;observer.queued=true;queueMicrotask(()=>{observer.queued=false;if(observer.target)observer.fn();});}};
  class Element{
    constructor(tag='div',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.parentElement=null;this.listeners={};this.disabled='disabled'in attrs;this.hidden='hidden'in attrs;this.value=attrs.value||'';}
    get id(){return this.attrs.id;}
    get dataset(){return Object.fromEntries(Object.entries(this.attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));}
    get isConnected(){return this.connected||!!this.parentElement?.isConnected;}
    get firstElementChild(){return this.children[0]||null;}
    get nextElementSibling(){const siblings=this.parentElement?.children||[];return siblings[siblings.indexOf(this)+1]||null;}
    contains(node){return this===node||this.children.some(child=>child.contains(node));}
    matches(selector){const tag=/^[a-z]+/.exec(selector)?.[0],id=/#([\w-]+)/.exec(selector)?.[1],classes=[...selector.matchAll(/\.([\w-]+)/g)].map(match=>match[1]);if(tag&&tag!==this.tag||id&&id!==this.id||classes.some(name=>!(this.attrs.class||'').split(/\s+/).includes(name)))return false;return[...selector.matchAll(/\[([\w-]+)(?:="?([^\]"]+)"?)?\]/g)].every(([,key,value])=>key in this.attrs&&(value==null||this.attrs[key]===value));}
    querySelectorAll(selector){const parts=selector.trim().split(/\s+/),found=[];for(const child of this.children){if(selector.includes(',')){if(selector.split(',').some(part=>child.matches(part)))found.push(child);}else if(child.matches(parts.at(-1))){let parent=child.parentElement,index=parts.length-2;while(parent&&index>=0){if(parent.matches(parts[index]))index--;parent=parent.parentElement;}if(index<0)found.push(child);}found.push(...child.querySelectorAll(selector));}return found;}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
    remove(){const parent=this.parentElement;if(parent){parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;changed(parent);}}
    append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}changed(this);}
    prepend(...nodes){for(const node of [...nodes].reverse()){node.remove();node.parentElement=this;this.children.unshift(node);}changed(this);}
    after(node){const parent=this.parentElement;if(!parent)return;node.remove();node.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);changed(parent);}
    replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes);}
    set innerHTML(html){this.html=html;this.replaceChildren();const stack=[this];for(const token of html.matchAll(/<\/?([a-z][\w-]*)\b([^>]*)>/gi)){if(token[0].startsWith('</')){if(stack.length>1)stack.pop();continue;}const attrs=Object.fromEntries([...token[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([,key,value])=>[key,value??''])),child=new Element(token[1],attrs);stack.at(-1).append(child);if(!['input','img','br','hr','meta','link'].includes(child.tag))stack.push(child);}changed(this);}
    get innerHTML(){return this.html||'';}
    setAttribute(key,value){this.attrs[key]=String(value);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    focus(){}
    click(target=this){const event={target,currentTarget:null,stopped:false,defaultPrevented:false,stopPropagation(){this.stopped=true;},preventDefault(){this.defaultPrevented=true;}};for(let node=target;node&&!event.stopped;node=node.parentElement){event.currentTarget=node;node.onclick?.(event);for(const handler of node.listeners.click||[])handler(event);}return event;}
  }
  class MutationObserver{constructor(fn){this.fn=fn;observers.add(this);}observe(target,options){this.target=target;this.options=options;}disconnect(){this.target=null;}}
  const root=new Element();root.connected=true;
  return{root,Element,MutationObserver,document:{createElement:tag=>new Element(tag)}};
}
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
async function harness(initial='budget'){
  const tree=dom(),calls=[],messages=[];let lateActions=0;
  const context=vm.createContext({...tree,console,Intl,Date,URLSearchParams,queueMicrotask});
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[key,value]of Object.entries(values))this.setExport(key,value);},{context});
  const components=new vm.SourceTextModule(await readFile(new URL('../js/components.js',import.meta.url),'utf8'),{context});await components.link(()=>{});await components.evaluate();
  const feedback=synthetic({registerUnsaved:()=>()=>{},confirmLeave:async()=>true});
  const reads=new vm.SourceTextModule(await readFile(new URL('../js/read-all.js',import.meta.url),'utf8'),{context});await reads.link(()=>{});await reads.evaluate();
  const crud=synthetic({minorAmount:()=>0,resource:async(el,_X,cfg)=>{el.innerHTML=components.namespace.pageHeader({title:cfg.title,actions:components.namespace.button({label:'Late action',attrs:{id:'late-action'}})});await Promise.resolve();el.querySelector('#late-action')?.addEventListener('click',()=>lateActions++);}});
  const finance=new vm.SourceTextModule(await readFile(new URL('../js/finance.js',import.meta.url),'utf8'),{context});await finance.link(spec=>({'./components.js':components,'./feedback.js':feedback,'./read-all.js':reads,'./crud.js':crud})[spec]);await finance.evaluate();
  const modules=new vm.SourceTextModule(await readFile(new URL('../js/modules.js',import.meta.url),'utf8'),{context});await modules.link(spec=>({'./components.js':components,'./feedback.js':feedback,'./read-all.js':reads,'./crud.js':crud,'./finance.js':finance})[spec]);await modules.evaluate();
  const month=()=>({schema_version:'20261118-finance',currency:'KES',period:{from:'2026-11-01',to:'2026-12-01'},totals:{income:12000,expenses:3000,net:9000,opening:1000,calculated_closing:10000,saved_closing:null,opening_recorded:true},categories:[],sections:{income:{budget:0,actual:12000},expense:{budget:0,actual:3000}}});
  const X={S:{ws:{id:'workspace',currency:'KES'},farmId:'farm',farms:[{id:'farm',name:'Farm'}],month:'2026-11',route:'finances'},filters:{tab:initial},uid:()=> 'user',migrationReady:true,canWrite:()=>true,permissions:{canWriteModule:()=>true},monthRange:()=>['2026-11-01','2026-12-01'],esc:String,money:value=>`KES ${value}`,toast:message=>messages.push(message),report:key=>calls.push(['report',key]),db:{
    select:async(table,query)=>{if(table==='categories')return[{id:'category'}];if(table==='budgets'&&!new URLSearchParams(query).get('offset'))return[{id:'budget',category_id:'category',amount:2000}];if(table==='budgets'&&new URLSearchParams(query).get('offset')==='0')return[{id:'budget',category_id:'category',amount:2000}];return[];},
    rpc:async(name,args)=>{calls.push([name,args]);return month();},upsert:async(table,rows)=>calls.push(['upsert',table,rows])}};
  await modules.namespace.finances(tree.root,X);await flush();
  return{...tree,X,calls,messages,lateActions:()=>lateActions};
}

test('legacy budget Close and Copy bubble inside their module after header layout and rerender',async()=>{
  const h=await harness(),tabs=h.root.querySelector('.subtabs'),panel=h.root.querySelector('[role="tabpanel"]');
  assert.equal(panel.querySelector('.ui-page-header').nextElementSibling,tabs);
  assert.equal(h.root.querySelector('#module-heading').querySelector('.ui-page-header'),null);
  h.root.querySelector('#close').click(h.root.querySelector('#close span'));await flush();
  assert.equal(h.calls.filter(([name])=>name==='fw_close_month').length,1);assert.equal(h.root.querySelector('.subtabs'),tabs,'rerender reuses the controls and their listeners');
  assert.equal(panel.querySelector('.ui-page-header').nextElementSibling,tabs);
  h.root.querySelector('#copy').click();await flush();assert.equal(h.calls.filter(([name])=>name==='upsert').length,1);
  h.root.querySelector('#budget-report').click();assert.equal(h.calls.filter(([name])=>name==='report').length,1,'direct Report listener runs only once');
  tabs.querySelectorAll('button')[3].click();await flush();assert.equal(h.root.querySelector('.subtabs'),tabs);assert.equal(tabs.parentElement.getAttribute?.('role')||tabs.parentElement.attrs.role,'tabpanel');
  tabs.querySelectorAll('button')[1].click();await flush();h.root.querySelector('#close').click();await flush();assert.equal(h.calls.filter(([name])=>name==='fw_close_month').length,2,'the same tab controls still switch back to a working budget');
});

test('legacy tab layout retains headers for action listeners attached after an awaited load',async()=>{
  const h=await harness('categories'),tabs=h.root.querySelector('.subtabs');
  h.root.querySelector('#late-action').click();assert.equal(h.lateActions(),1);
  assert.equal(h.root.querySelector('[role="tabpanel"]').querySelector('.ui-page-header').nextElementSibling,tabs);
});
