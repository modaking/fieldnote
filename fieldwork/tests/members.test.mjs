import {test} from 'node:test';
import assert from 'node:assert/strict';
import {members,memberTab} from '../js/members.js';
function harness(){
  let uid='own-user',dialogCalls=0;const nodes=new Map(),inviteButton={};
  const el={isConnected:true,innerHTML:'',querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,{addEventListener(){}});return nodes.get(selector);},querySelectorAll:selector=>selector==='[data-invite-member]'?[inviteButton]:[]};
  const X={uid:()=>uid,migrationReady:true,S:{userId:uid,ws:{id:'workspace'},role:'owner',route:'members',farms:[]},db:{rpc:async name=>name==='fw_list_members'?[{user_id:'member',email:'member-only@example.invalid',full_name:'Member Only',role:'worker',farm_scope:'all'}]:[{id:'invitation',email:'invite-only@example.invalid',role:'viewer',status:'pending',expires_at:'2099-01-01',farm_ids:null}]},dlg(){dialogCalls++;throw new Error('Unexpected dialog');}};
  globalThis.location={hash:'#/people?section=invitations',pathname:'/',search:''};
  return{el,X,inviteButton,setUser:value=>uid=value,get dialogCalls(){return dialogCalls;}};
}
test('People invitations uses the requested list and omits nested Team access tabs',async()=>{
  const h=harness();await members(h.el,h.X,{tab:'invites',hideTabs:true});assert.match(h.el.innerHTML,/<h1>Invitations<\/h1>/);assert.match(h.el.innerHTML,/Workspace invitations/);assert.match(h.el.innerHTML,/invite-only@example.invalid/);assert.doesNotMatch(h.el.innerHTML,/member-only@example.invalid/);assert.doesNotMatch(h.el.innerHTML,/role="tablist"/);
});
test('explicit Members selection takes precedence and standalone legacy tab URLs still work',async()=>{
  const h=harness();await members(h.el,h.X,{tab:'members',hideTabs:true});assert.match(h.el.innerHTML,/Workspace members/);assert.doesNotMatch(h.el.innerHTML,/invite-only@example.invalid/);
  location.hash='#/members?tab=invites';await members(h.el,h.X);assert.match(h.el.innerHTML,/Workspace invitations/);assert.match(h.el.innerHTML,/role="tablist"/);
  assert.equal(memberTab({tab:'members'},'#/members?tab=invites'),'members');assert.equal(memberTab({},'#/members?tab=invalid'),'members');
});
test('late membership responses do not paint after account switch or detached view',async()=>{
  for(const change of ['account','detached']){const h=harness();let finish;const pending=new Promise(resolve=>finish=resolve);h.X.db.rpc=()=>pending;const rendering=members(h.el,h.X,{tab:'invites',hideTabs:true});if(change==='account')h.setUser('other-user');else h.el.isConnected=false;finish([]);await rendering;assert.doesNotMatch(h.el.innerHTML,/No invitations yet/);assert.match(h.el.innerHTML,/Loading your team/);}
});
test('old invitation actions cannot open a dialog after account switch',async()=>{
  const h=harness();await members(h.el,h.X,{tab:'invites',hideTabs:true});h.setUser('other-user');h.inviteButton.onclick();assert.equal(h.dialogCalls,0);
});
