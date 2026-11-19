import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {sectionDOM} from './helpers/dom-tree.mjs';

async function harness({fresh=true,google=false,section='security',identities=[{provider:'email'}],factors=[],invitationStatus={needs_recovery:false,proof_recent:true}}={}){
  const tree=sectionDOM(),proto=tree.Element.prototype,calls=[],messages=[],dialog=new tree.Element('dialog');dialog.root=true;
  const matches=(node,selector)=>{const tag=/^[a-z]+/.exec(selector)?.[0],id=/#([\w-]+)/.exec(selector)?.[1],cls=/\.([\w-]+)/.exec(selector)?.[1];if(tag&&node.tag!==tag||id&&node.id!==id||cls&&!(node.attrs.class||'').split(/\s+/).includes(cls))return false;return[...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)].every(([,key,value])=>key in node.attrs&&(value==null||node.attrs[key]===value));};
  proto.querySelectorAll=function(selector){const found=[];for(const child of this.children){if(selector.split(',').some(s=>matches(child,s.trim())))found.push(child);found.push(...child.querySelectorAll(selector));}return found;};
  Object.defineProperties(proto,{name:{get(){return this.attrs.name;}},type:{get(){return this.attrs.type;},set(value){this.attrs.type=value;}},elements:{get(){return Object.fromEntries(this.querySelectorAll('[name]').map(node=>[node.name,node]));}},classList:{get(){const node=this,change=(name,enabled)=>{const names=new Set((node.attrs.class||'').split(/\s+/).filter(Boolean));enabled?names.add(name):names.delete(name);node.attrs.class=[...names].join(' ');return enabled;};return{add:name=>change(name,true),remove:name=>change(name,false),toggle:(name,enabled)=>change(name,enabled??!(node.attrs.class||'').split(/\s+/).includes(name))};}}});
  proto.showModal=function(){this.open=true;};proto.close=function(){this.open=false;for(const listener of this.listeners.get('close')||[])listener();};proto.insertAdjacentHTML=()=>{};
  const user={id:'fixture-user',email:'fixture@example.invalid',email_confirmed_at:'2026-11-18T00:00:00Z',identities,factors},current={user,access_token:'not-a-real-token'};
  const context=vm.createContext({console,Intl,Date,URLSearchParams,location:{hash:`#/account?section=${section}`,pathname:'/',search:''},history:{replaceState(){}},window:{},document:{createElement:tag=>new tree.Element(tag),body:tree.el},FormData:class{constructor(form){this.form=form;}*[Symbol.iterator](){for(const node of this.form.querySelectorAll('[name]'))if(!node.disabled)yield[node.name,node.value];}}});
  const synthetic=values=>new vm.SyntheticModule(Object.keys(values),function(){for(const[key,value]of Object.entries(values))this.setExport(key,value);},{context});
  const components=new vm.SourceTextModule(await readFile(new URL('../js/components.js',import.meta.url),'utf8'),{context});await components.link(()=>{});await components.evaluate();
  const auth={capabilities:async()=>({google,email:true}),invitationVerification:async()=>invitationStatus,syncUser:next=>calls.push(['syncUser',next]),magicLink:async(...args)=>calls.push(['magicLink',...args]),reset:async(...args)=>calls.push(['reset',...args]),signOut:async()=>calls.push(['signOut'])};
  const A={getUser:async()=>user,avatarURL:async()=>null,availability:async()=>({delete_available:true}),changePassword:async(...args)=>{calls.push(['changePassword',...args]);return{user};},changeEmail:async(...args)=>{calls.push(['changeEmail',...args]);return{user};},reauthenticatePassword:async()=>{calls.push(['reauthenticatePassword']);return user;},connectGoogle:async()=>calls.push(['connectGoogle']),unlinkGoogle:async()=>calls.push(['unlinkGoogle']),enrollTOTP:async()=>calls.push(['enrollTOTP']),unenrollFactor:async()=>calls.push(['unenrollFactor']),signOutOthers:async()=>calls.push(['signOutOthers']),deleteAccount:async()=>calls.push(['deleteAccount'])};
  const authUI=new vm.SourceTextModule(await readFile(new URL('../js/auth-ui.js',import.meta.url),'utf8'),{context});await authUI.link(()=>components);await authUI.evaluate();
  const dependencies={'./components.js':components,'./auth-ui.js':authUI,'./account-client.js':synthetic({accountClient:A,prepareAvatar:()=>{},sessionClaims:()=>({}),recentlyAuthenticated:()=>fresh}),'./supabase.js':synthetic({auth,session:()=>current}),'./theme.js':synthetic({setPref:()=>{}}),'./feedback.js':synthetic({registerUnsaved:()=>()=>{},confirmLeave:async()=>true})};
  const module=new vm.SourceTextModule(await readFile(new URL('../js/account.js',import.meta.url),'utf8'),{context});await module.link(spec=>dependencies[spec]);await module.evaluate();
  const X={S:{route:'account',profile:{full_name:'Fixture'},farms:[]},dlg:()=>dialog,toast:text=>messages.push(text),db:{rpc:async name=>name==='fw_account_context'?{schema_version:'20261118-account',profile:{full_name:'Fixture'},notifications:{}}:name==='fw_account_delete_status'?{owned_workspaces:[],business_files:0}:name==='fw_account_sessions'?{sessions:[]}:[]}};
  return{...tree,context,components,auth,authUI:authUI.namespace,api:module.namespace,dialog,X,calls,messages,user};
}
const input=(dialog,name,value)=>{dialog.querySelector(`[name="${name}"]`).value=value;};

test('Account password form validates confirmation and sends the entered current password unchanged',async()=>{
  const h=await harness();await h.api.account(h.el,h.X);await h.el.querySelector('[data-account-action="password"]').click();
  assert.equal(h.dialog.querySelector('[name="current_password"]').getAttribute('autocomplete'),'current-password');
  input(h.dialog,'current_password','Old pass phrase!');input(h.dialog,'password','New pass phrase!');input(h.dialog,'confirm_password','different');
  await h.dialog.querySelector('form').onsubmit({preventDefault(){}});assert.equal(h.calls.length,0);assert.match(h.dialog.querySelector('[data-error-for="confirm_password"]').textContent,/do not match/);
  input(h.dialog,'confirm_password','New pass phrase!');input(h.dialog,'nonce','123456');await h.dialog.querySelector('form').onsubmit({preventDefault(){}});
  assert.deepEqual(h.calls[0],['changePassword','New pass phrase!','123456','Old pass phrase!']);assert.equal(h.dialog.open,false);assert.ok(h.messages.includes('Password changed.'));
});

test('passwordless users may set a password without inventing a current password',async()=>{
  const h=await harness();await h.api.account(h.el,h.X);await h.el.querySelector('[data-account-action="password"]').click();input(h.dialog,'password','New pass phrase!');input(h.dialog,'confirm_password','New pass phrase!');await h.dialog.querySelector('form').onsubmit({preventDefault(){}});
  assert.deepEqual(h.calls[0],['changePassword','New pass phrase!','','']);
});

test('stale primary sign-in cannot initiate any sensitive Account mutation',async()=>{
  for(const action of ['email','password','google','unlink-google','logout-others','mfa-enroll','mfa-remove','delete']){
    const h=await harness({fresh:false,google:true,section:action==='delete'?'privacy':'security',identities:action==='unlink-google'?[{provider:'email'},{provider:'google'}]:[{provider:'email'}],factors:action==='mfa-remove'?[{id:'factor',factor_type:'totp',status:'verified'}]:[]});
    await h.api.account(h.el,h.X);await h.el.querySelector(`[data-account-action="${action}"]`).click();
    assert.match(h.dialog.innerHTML,/Verify your sign-in/,action);assert.equal(h.calls.length,0,action+' must wait for reauthentication');
  }
});

test('Account only offers Google connection when the public project capability allows it',async()=>{
  const disabled=await harness();await disabled.api.account(disabled.el,disabled.X);assert.equal(disabled.el.querySelector('[data-account-action="google"]'),null);assert.match(disabled.el.querySelector('[data-account-body]').innerHTML,/Google sign-in is not enabled/);
  const enabled=await harness({google:true});await enabled.api.account(enabled.el,enabled.X);assert.ok(enabled.el.querySelector('[data-account-action="google"]'));
});

test('sign-in provider discovery hides disabled Google and a failed check offers a real retry',async()=>{
  const h=await harness(),authUI=new vm.SourceTextModule(await readFile(new URL('../js/auth-ui.js',import.meta.url),'utf8'),{context:h.context});await authUI.link(()=>h.components);await authUI.evaluate();
  let attempt=0;h.auth.capabilities=async()=>{if(++attempt===1)throw new Error('Offline');return{google:false};};
  authUI.namespace.renderAuth(h.el,{auth:h.auth,onSignedIn:async()=>{},brand:()=>''});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.el.querySelector('#auth-google-option').hidden,true);await h.el.querySelector('#provider-retry').click();assert.equal(attempt,2);assert.equal(h.el.querySelector('#auth-google-option').hidden,true);assert.equal(h.el.querySelector('#google').disabled,true);
  h.auth.capabilities=async()=>({google:true});authUI.namespace.renderAuth(h.el,{auth:h.auth,onSignedIn:async()=>{},brand:()=>''});await new Promise(resolve=>setImmediate(resolve));assert.equal(h.el.querySelector('#auth-google-option').hidden,false);assert.equal(h.el.querySelector('#google').disabled,false);
});

const visiblePrimaryButtons=el=>el.querySelectorAll('button').filter(node=>{
  const classes=(node.attrs.class||'').split(/\s+/);if(!classes.includes('ui-button')||classes.some(name=>['secondary','ghost','danger'].includes(name)))return false;
  for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.hidden||parent.tag==='details'&&!parent.open)return false;return true;
});

test('signup makes verified Google primary while preserving the same opened email form and typed values',async()=>{
  const h=await harness();let finish;h.auth.capabilities=()=>new Promise(resolve=>finish=resolve);
  h.authUI.renderAuth(h.el,{auth:h.auth,onSignedIn:async()=>{},brand:()=>''},'up');const form=h.el.querySelector('#auth'),disclosure=h.el.querySelector('#email-signup'),name=form.querySelector('[name="name"]'),email=form.querySelector('[name="email"]'),password=form.querySelector('[name="password"]');
  assert.equal(h.el.querySelector('#auth-google-option').hidden,true);assert.match(h.el.innerHTML,/Checking sign-up options/);
  disclosure.open=true;name.value='Farmer';email.value='farmer@example.invalid';password.value='Entered-password!';finish({google:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.el.querySelector('#auth'),form);assert.equal(form.querySelector('[name="email"]'),email);assert.equal(name.value,'Farmer');assert.equal(email.value,'farmer@example.invalid');assert.equal(password.value,'Entered-password!');assert.equal(disclosure.open,true);
  assert.equal(disclosure.contains(form),true);assert.deepEqual(visiblePrimaryButtons(h.el).map(node=>node.id),['google']);assert.match(form.querySelector('#auth-submit').attrs.class,/secondary/);
  const parent=disclosure.parentElement;assert.ok(parent.children.indexOf(h.el.querySelector('#auth-google-option'))<parent.children.indexOf(disclosure));assert.match(h.el.innerHTML,/Email sign-up may require a confirmation link/);
  disclosure.open=false;h.auth.google=async()=>{throw new Error('Google could not be opened');};await h.el.querySelector('#google').click();assert.match(h.el.querySelector('#auth-provider-message').innerHTML,/Google could not be opened/);assert.equal(disclosure.open,false,'Google feedback remains visible outside the closed email form');
});

test('disabled or unavailable Google opens an email primary fallback and retry never rebuilds its draft',async()=>{
  for(const unavailable of [false,true]){
    const h=await harness();let attempts=0;h.auth.capabilities=async()=>{if(++attempts===1){if(unavailable)throw new Error('Offline');return{google:false};}return{google:true};};
    h.authUI.renderAuth(h.el,{auth:h.auth,onSignedIn:async()=>{},brand:()=>''},'up');await new Promise(resolve=>setImmediate(resolve));const form=h.el.querySelector('#auth'),email=form.querySelector('[name="email"]'),disclosure=h.el.querySelector('#email-signup');
    assert.equal(disclosure.open,true);assert.equal(h.el.querySelector('#auth-google-option').hidden,true);assert.deepEqual(visiblePrimaryButtons(h.el).map(node=>node.id),['auth-submit']);email.value='saved@example.invalid';
    if(unavailable){await h.el.querySelector('#provider-retry').click();assert.equal(h.el.querySelector('#auth'),form);assert.equal(form.querySelector('[name="email"]'),email);assert.equal(email.value,'saved@example.invalid');assert.equal(disclosure.open,true);assert.deepEqual(visiblePrimaryButtons(h.el).map(node=>node.id),['google']);}
  }
});

test('disclosed email signup still follows the actual session response with either confirmation setting',async()=>{
  for(const signedIn of [false,true]){
    const h=await harness({google:true});let loaded=0,request;h.auth.signUp=async(...args)=>{request=args;return{signedIn};};
    h.authUI.renderAuth(h.el,{auth:h.auth,onSignedIn:async()=>loaded++,brand:()=>''},'up');await new Promise(resolve=>setImmediate(resolve));h.el.querySelector('#email-signup').open=true;
    input(h.el,'name',' Farmer ');input(h.el,'email','farmer@example.invalid');input(h.el,'password','Entered-password!');await h.el.querySelector('#auth').onsubmit({preventDefault(){}});
    assert.deepEqual(request,['farmer@example.invalid','Entered-password!','Farmer']);assert.equal(loaded,signedIn?1:0);if(!signedIn)assert.match(h.el.innerHTML,/Verify your email/);
  }
});

test('incoming invitations stay unread until server attestation and a fresh mailbox proof are both present',async()=>{
  for(const status of [{needs_recovery:true,proof_recent:true},{needs_recovery:false,proof_recent:false}]){
    const h=await harness({section:'invitations',invitationStatus:status}),original=h.X.db.rpc,reads=[];h.X.db.rpc=async(name,args)=>{reads.push(name);return original(name,args);};
    await h.api.account(h.el,h.X);assert.equal(reads.includes('fw_account_invites'),false);assert.equal(h.el.querySelector('[data-account-action="accept-invite"]'),null);
    await h.el.querySelector('[data-invite-proof]').click();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),[status.needs_recovery?'reset':'magicLink','fixture@example.invalid',{invitation:true,returnTo:'#/account?section=invitations'}]);
  }
});

test('failed recovery attestation retries completion without repeating the saved password or loading invitations',async()=>{
  const h=await harness();let stage=false,updates=0,attempts=0,loaded=0;
  Object.assign(h.auth,{recoveryPending:()=>({passwordSaved:stage}),markRecoveryPasswordSaved:()=>stage=true,updatePassword:async()=>{updates++;},completeInviteRecovery:async()=>{if(++attempts===1)throw new Error('Verification unavailable');},finishRecovery:()=>stage=false});
  h.authUI.renderReset(h.el,{auth:h.auth,brand:()=>'',invitationRecovery:true,onSignedIn:async()=>loaded++});const form=h.el.querySelector('form');
  input(h.el,'password','New-password!');input(h.el,'confirm','New-password!');await form.onsubmit({preventDefault(){}});
  assert.equal(updates,1);assert.equal(loaded,0);assert.match(h.el.querySelector('#reset-message').innerHTML,/password was saved/);assert.equal(h.el.querySelector('[name="password"]').disabled,true);
  await form.onsubmit({preventDefault(){}});assert.equal(updates,1);assert.equal(attempts,2);assert.equal(loaded,1);assert.equal(stage,false);
});

test('missing invitation verification service fails closed without querying invite data',async()=>{
  const h=await harness({section:'invitations'}),reads=[];h.auth.invitationVerification=async()=>{throw new Error('Invitation verification is unavailable.');};const original=h.X.db.rpc;h.X.db.rpc=async(name,args)=>{reads.push(name);return original(name,args);};
  await h.api.account(h.el,h.X);assert.equal(reads.includes('fw_account_invites'),false);assert.match(h.el.querySelector('[data-account-body]').innerHTML,/verification is unavailable/);assert.equal(h.el.querySelector('[data-account-action="accept-invite"]'),null);
});

test('a recovery password response cannot attest or load invitations after its account changes',async()=>{
  const h=await harness();let state={userId:'first',sessionId:'first-session',passwordSaved:false},finish,completed=0,loaded=0;
  Object.assign(h.auth,{recoveryPending:()=>state,updatePassword:()=>new Promise(resolve=>finish=resolve),completeInviteRecovery:async()=>completed++});
  h.authUI.renderReset(h.el,{auth:h.auth,brand:()=>'',invitationRecovery:true,onSignedIn:async()=>loaded++});input(h.el,'password','New-password!');input(h.el,'confirm','New-password!');
  const saving=h.el.querySelector('form').onsubmit({preventDefault(){}});state={userId:'second',sessionId:'second-session'};finish();await saving;assert.equal(completed,0);assert.equal(loaded,0);
});

test('a terminal recovery session rejection shows a usable sign-in handoff instead of a permanently busy form',async()=>{
  const h=await harness();let state={userId:'first',sessionId:'session',passwordSaved:false},handoffs=0;
  Object.assign(h.auth,{recoveryPending:()=>state,updatePassword:async()=>{state=null;throw Object.assign(new Error('Sign in again'),{status:401});}});
  h.authUI.renderReset(h.el,{auth:h.auth,brand:()=>'',invitationRecovery:true,onSignedIn:async()=>assert.fail('must not load'),onSessionEnded:()=>handoffs++});input(h.el,'password','New-password!');input(h.el,'confirm','New-password!');await h.el.querySelector('form').onsubmit({preventDefault(){}});assert.equal(handoffs,1);assert.match(h.el.querySelector('#reset-message').innerHTML,/Sign in again/);assert.equal(h.el.querySelector('[type="submit"]').disabled,false);
});

test('a workspace load failure after successful verification remains visible and retryable',async()=>{
  const h=await harness();let state={userId:'first',sessionId:'session',passwordSaved:true};Object.assign(h.auth,{recoveryPending:()=>state,completeInviteRecovery:async()=>{},finishRecovery:()=>state=null});
  h.authUI.renderReset(h.el,{auth:h.auth,brand:()=>'',invitationRecovery:true,onSignedIn:async()=>{throw new Error('Workspace unavailable');}});await h.el.querySelector('form').onsubmit({preventDefault(){}});assert.match(h.el.querySelector('#reset-message').innerHTML,/Workspace unavailable/);assert.equal(h.el.querySelector('[type="submit"]').disabled,false);
});

test('an expired open recovery form offers a new-link handoff while a different session stays silent',async()=>{
  for(const sameSession of [true,false]){
    const h=await harness();let state={userId:'first',sessionId:'session',passwordSaved:false},handoffs=0,updates=0;
    Object.assign(h.auth,{recoveryPending:()=>state,isRecoverySession:()=>sameSession,updatePassword:async()=>updates++});
    h.authUI.renderReset(h.el,{auth:h.auth,brand:()=>'',invitationRecovery:true,onSignedIn:async()=>assert.fail('must not load'),onRecoveryExpired:()=>handoffs++});state=null;
    await h.el.querySelector('form').onsubmit({preventDefault(){}});assert.equal(updates,0);
    if(sameSession){assert.match(h.el.querySelector('#reset-message').innerHTML,/Recovery link expired/);await h.el.querySelector('[data-reset-new-link]').click();assert.equal(handoffs,1);}else{assert.equal(h.el.querySelector('[data-reset-new-link]'),null);assert.equal(handoffs,0);}
  }
});
