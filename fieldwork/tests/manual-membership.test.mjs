import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {sectionDOM} from './helpers/dom-tree.mjs';

const OWNER='10000000-0000-4000-8000-000000000001',TARGET='10000000-0000-4000-8000-000000000abc',EXISTING='10000000-0000-4000-8000-000000000002';
const WORKSPACE='30000000-0000-4000-8000-000000000001',FARM='20000000-0000-4000-8000-000000000001';
async function harness({role='owner',add}={}){
  const tree=sectionDOM(),proto=tree.Element.prototype,calls=[],messages=[],copies=[],registrations=[];let currentUID=OWNER;
  const matches=(node,selector)=>{const checked=selector.includes(':checked');selector=selector.replace(':checked','');if(checked&&!node.checked)return false;const tag=/^[a-z]+/.exec(selector)?.[0],id=/#([\w-]+)/.exec(selector)?.[1];if(tag&&node.tag!==tag||id&&node.id!==id)return false;return[...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)].every(([,key,value])=>key in node.attrs&&(value==null||node.attrs[key]===value));};
  proto.querySelectorAll=function(selector){const found=[];for(const child of this.children){if(selector.split(',').some(s=>matches(child,s.trim())))found.push(child);found.push(...child.querySelectorAll(selector));}return found;};
  Object.defineProperties(proto,{name:{get(){return this.attrs.name;}},checked:{get(){return this.checkedValue??('checked'in this.attrs);},set(value){this.checkedValue=value;}},
    value:{get(){if(this.tag==='select'&&!this.valueSet)return this.querySelector('option[selected]')?.attrs.value||this.querySelector('option')?.attrs.value||'';return this.valueSet||'';},set(value){this.valueSet=value;}},
    elements:{get(){return Object.fromEntries(this.querySelectorAll('[name]').map(node=>[node.name,node]));}},classList:{get(){return{add(){},remove(){}};}}});
  proto.showModal=function(){this.open=true;};proto.close=function(){this.open=false;};
  const dialog=new tree.Element('dialog');dialog.root=true;
  const location={hash:'#/people?section=members',pathname:'/',search:'',origin:'https://example.invalid'};
  const navigator={clipboard:{writeText:async value=>copies.push(value)}};
  const context=vm.createContext({console,Intl,Date,URLSearchParams,URL,location,navigator,history:{replaceState(){}},window:{},document:{createElement:tag=>new tree.Element(tag),body:tree.el},
    FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const node of this.form.querySelectorAll('[name]'))if(!node.disabled&&(node.attrs.type!=='checkbox'||node.checked))yield[node.name,node.value];}}});
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[key,value]of Object.entries(values))this.setExport(key,value);},{context});
  const components=new vm.SourceTextModule(await readFile(new URL('../js/components.js',import.meta.url),'utf8'),{context});await components.link(()=>{});await components.evaluate();
  const authUI=new vm.SourceTextModule(await readFile(new URL('../js/auth-ui.js',import.meta.url),'utf8'),{context});await authUI.link(()=>components);await authUI.evaluate();
  const feedback=synthetic({registerUnsaved:entry=>{registrations.push(entry);return()=>entry.removed=true;},confirmLeave:async()=>!registrations.some(e=>!e.removed&&e.isActive?.()&&e.isSaving?.())});
  const dependencies={'./components.js':components,'./auth-ui.js':authUI,'./feedback.js':feedback};
  for(const file of ['permissions','invites','read-all']){const module=new vm.SourceTextModule(await readFile(new URL('../js/'+file+'.js',import.meta.url),'utf8'),{context});await module.link(()=>{});await module.evaluate();dependencies['./'+file+'.js']=module;}
  const module=new vm.SourceTextModule(await readFile(new URL('../js/members.js',import.meta.url),'utf8'),{context});await module.link(spec=>dependencies[spec]);await module.evaluate();
  const rows=[{user_id:OWNER,email:'owner@example.invalid',full_name:'Owner',role:'owner',farm_scope:'all'},{user_id:EXISTING,email:'member@example.invalid',full_name:'Existing',role:'viewer',farm_scope:'all'}];
  const X={uid:()=>currentUID,migrationReady:true,S:{route:'members',userId:OWNER,ws:{id:WORKSPACE},role,farms:[{id:FARM,name:'Farm A'}],profile:{full_name:'Own profile'}},dlg:()=>dialog,toast:(text,options)=>messages.push({text,options}),
    db:{rpc:async(name,args,query)=>{calls.push({name,args});if(name==='fw_add_member_by_id')return add?add(args):{user_id:args.p_user_id,role:args.p_role,farm_scope:args.p_farm_ids?'farms':'all',farm_ids:args.p_farm_ids||[]};if(name==='fw_account_context')return{schema_version:'20261118-account',profile:X.S.profile};if(name==='fw_list_members')return Number(new URLSearchParams(query).get('offset')||0)?[]:rows;return[];},update:async(...args)=>calls.push({name:'update',args})}};
  return{...tree,dialog,X,calls,messages,copies,registrations,navigator,context,dependencies,feedback,api:module.namespace,setUser:id=>currentUID=id,
    async showMembers(){await module.namespace.members(tree.el,X,{hideTabs:true,tab:'members'});},
    async showAccount(){location.hash='#/account';X.S.route='account';const user={id:currentUID,email:'own@example.invalid'};dependencies['./supabase.js']=synthetic({auth:{},session:()=>({user:{...user,id:currentUID}})});dependencies['./account-client.js']=synthetic({accountClient:{getUser:async()=>user,avatarURL:async()=>null},prepareAvatar(){},sessionClaims:()=>({}),recentlyAuthenticated:()=>true});dependencies['./theme.js']=synthetic({setPref(){}});const account=new vm.SourceTextModule(await readFile(new URL('../js/account.js',import.meta.url),'utf8'),{context});await account.link(spec=>dependencies[spec]);await account.evaluate();await account.namespace.account(tree.el,X);}
  };
}
const submit=h=>h.dialog.querySelector('form').onsubmit({preventDefault(){}});
const field=(h,name)=>h.dialog.querySelector(`[name="${name}"]`);
const complete=h=>{field(h,'user_id').value=TARGET;field(h,'verified_person').checked=true;};
const mutations=h=>h.calls.filter(call=>call.name==='fw_add_member_by_id');

test('only owners see Add Google account while administrators retain email invitations',async()=>{
  for(const role of ['owner','admin','manager','worker','viewer']){const h=await harness({role});await h.showMembers();assert.equal(Boolean(h.el.querySelector('[data-add-existing-member]')),role==='owner');if(role==='owner')assert.match(h.el.innerHTML,/Add Google account/);if(['owner','admin'].includes(role))assert.ok(h.el.querySelector('[data-invite-member]'));assert.equal(mutations(h).length,0);}
});
test('manual join validates exact ID, intended-person confirmation, lower role and selected farms before sending',async()=>{
  const h=await harness();await h.showMembers();await h.el.querySelector('[data-add-existing-member]').click();
  assert.match(h.dialog.innerHTML,/Add a Google account/);assert.match(h.dialog.innerHTML,/password or another sign-in method cannot use this option/);assert.match(h.dialog.innerHTML,/does not search by email or send an email/);
  assert.deepEqual(field(h,'role').querySelectorAll('option').map(n=>n.attrs.value),['manager','accountant','worker','viewer']);
  field(h,'user_id').value='someone@example.invalid';await submit(h);assert.match(h.dialog.querySelector('[data-error-for="user_id"]').textContent,/complete account ID/);assert.match(h.dialog.querySelector('[data-error-for="verified_person"]').textContent,/checked/);assert.equal(mutations(h).length,0);
  complete(h);field(h,'scope').value='selected';field(h,'scope').onchange();await submit(h);assert.match(h.dialog.querySelector('[data-error-for="scope"]').textContent,/at least one/);assert.equal(mutations(h).length,0);
  field(h,'role').value='owner';await submit(h);assert.match(h.dialog.querySelector('[data-error-for="role"]').textContent,/Manager/);assert.equal(mutations(h).length,0);
  field(h,'role').value='worker';field(h,'farm_ids').checked=true;field(h,'user_id').value=TARGET.toUpperCase();await submit(h);
  assert.deepEqual(JSON.parse(JSON.stringify(mutations(h)[0].args)),{p_workspace_id:WORKSPACE,p_user_id:TARGET,p_role:'worker',p_farm_ids:[FARM]});assert.equal(h.dialog.open,false);assert.ok(h.messages.some(m=>/Google account added/.test(m.text)));assert.ok(h.registrations.every(e=>e.removed));
});
test('manual join rejects self, an existing member and a changed owner context without a mutation',async()=>{
  for(const uid of [OWNER,EXISTING]){const h=await harness();await h.showMembers();await h.el.querySelector('[data-add-existing-member]').click();complete(h);field(h,'user_id').value=uid;await submit(h);assert.equal(mutations(h).length,0);assert.match(h.dialog.querySelector('[data-error-for="user_id"]').textContent,/already a member/);}
  for(const change of ['role','user']){const h=await harness();await h.showMembers();await h.el.querySelector('[data-add-existing-member]').click();complete(h);if(change==='role')h.X.S.role='admin';else h.setUser(EXISTING);await submit(h);assert.equal(mutations(h).length,0);}
});
test('stale-owner, ineligible-password-account and unavailable-RPC errors retain the form without success',async()=>{
  const cases=[{status:403,text:'Sign in again before approving a new workspace member',expected:/Sign in again/},{status:403,text:'This account needs email recovery before it can be added. Google-only accounts can be added now.',expected:/This account needs email recovery/,eligibility:true},{status:404,text:'Function not found',expected:/not available yet/}];
  for(const entry of cases){const h=await harness({add:async()=>{throw Object.assign(new Error(entry.text),{status:entry.status,details:{code:entry.status===403?'42501':'PGRST202'}});}});await h.showMembers();await h.el.querySelector('[data-add-existing-member]').click();complete(h);await submit(h);assert.equal(field(h,'user_id').value,TARGET);assert.equal(h.dialog.open,true);assert.equal(h.dialog.querySelector('[type=submit]').disabled,false);const shown=h.dialog.querySelector('#existing-member-message').innerHTML;assert.match(shown,entry.expected);if(entry.eligibility){assert.ok(shown.includes(entry.text));assert.doesNotMatch(shown,/Sign in again|reopen Members|workspace owner/);}assert.equal(h.messages.length,0);assert.deepEqual(h.calls.filter(c=>!['fw_list_members','fw_list_invites','fw_add_member_by_id'].includes(c.name)),[]);}
});
test('a saving manual join blocks close and an old account response cannot repaint another user',async()=>{
  let finish;const h=await harness({add:()=>new Promise(resolve=>finish=resolve)});await h.showMembers();await h.el.querySelector('[data-add-existing-member]').click();complete(h);const pending=submit(h);
  assert.equal(h.registrations.some(e=>e.isSaving()),true);await h.dialog.querySelector('[data-existing-cancel]').click();assert.equal(h.dialog.open,true);
  h.setUser(EXISTING);finish({user_id:TARGET,role:'worker'});await pending;assert.equal(h.messages.length,0);assert.equal(mutations(h).length,1);
});
test('Profile copies only the own account ID and preserves a dirty profile; clipboard failure is usable',async()=>{
  const h=await harness();await h.showAccount();const form=h.el.querySelector('form');form.elements.full_name.value='Unsaved name';
  assert.ok(h.registrations.some(e=>e.isDirty()));await h.el.querySelector('[data-account-action="copy-account-id"]').click();assert.deepEqual(h.copies,[OWNER]);assert.equal(form.elements.full_name.value,'Unsaved name');assert.ok(h.registrations.some(e=>e.isDirty()));assert.equal(h.calls.some(c=>c.name==='update'),false);
  h.navigator.clipboard.writeText=async()=>{throw new Error('Blocked');};await h.el.querySelector('[data-account-action="copy-account-id"]').click();assert.ok(h.messages.some(m=>/Select and copy/.test(m.text)));assert.equal(form.elements.full_name.value,'Unsaved name');
});
test('local preview simulates Google-only owner approval and blocks mixed credentials entirely in memory',async()=>{
  const {previewRequest,SAMPLE_EXISTING_ACCOUNT_ID,SAMPLE_MIXED_ACCOUNT_ID}=await import('../tools/preview.mjs');
  async function request(url,data,bearer){let status,result;const req={url,method:'POST',headers:{authorization:bearer?'Bearer '+bearer:undefined},async*[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(data));}};const res={setHeader(){},writeHead(value){status=value;},end(value){result=JSON.parse(String(value));}};await previewRequest(req,res);return{status,result};}
  const login=async role=>(await request('/__preview/auth/v1/token?grant_type=password',{email:role+'@fieldwork.test',password:'sample123'})).result.access_token;
  const owner=await login('owner'),admin=await login('admin'),url='/__preview/rest/v1/rpc/fw_add_member_by_id',args={p_workspace_id:'workspace-a',p_user_id:SAMPLE_EXISTING_ACCOUNT_ID,p_role:'worker',p_farm_ids:['farm-a','farm-a']};
  assert.equal((await request(url,args,admin)).status,403);assert.equal((await request(url,{...args,p_role:'owner'},owner)).status,400);assert.equal((await request(url,{...args,p_farm_ids:['farm-other']},owner)).status,400);
  const mixed=await request(url,{...args,p_user_id:SAMPLE_MIXED_ACCOUNT_ID},owner);assert.equal(mixed.status,400);assert.match(mixed.result.message,/only Google, with no password/);
  const parts=owner.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.amr[0].timestamp-=601;parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');assert.equal((await request(url,args,parts.join('.'))).status,403);
  const approved=await request(url,args,owner);assert.equal(approved.status,200);assert.deepEqual(approved.result,{user_id:SAMPLE_EXISTING_ACCOUNT_ID,role:'worker',farm_scope:'farms',farm_ids:['farm-a']});
  assert.equal((await request(url,{...args,p_role:'manager',p_farm_ids:null},owner)).status,409);const members=await request('/__preview/rest/v1/rpc/fw_list_members',{p_workspace_id:'workspace-a'},owner);assert.equal(members.result.find(m=>m.user_id===SAMPLE_EXISTING_ACCOUNT_ID).role,'worker');
});
