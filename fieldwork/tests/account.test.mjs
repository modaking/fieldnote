import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let source=await readFile(new URL('../js/account.js',import.meta.url),'utf8');
source=source.replace("import * as C from './components.js';",'const C={escapeHTML:value=>String(value??\'\')};')
 .replace("import { renderInvitationVerification } from './auth-ui.js';",'const renderInvitationVerification=()=>{};')
 .replace("import { accountClient as A, prepareAvatar, sessionClaims, recentlyAuthenticated } from './account-client.js';",'const A={getUser:()=>globalThis.__accountUser()};const prepareAvatar=()=>{},sessionClaims=()=>globalThis.__accountClaims,recentlyAuthenticated=()=>false;')
 .replace("import { auth, session } from './supabase.js';",'const auth={},session=()=>null;')
 .replace("import { setPref } from './theme.js';",'const setPref=()=>{};')
 .replace("import { registerUnsaved, confirmLeave } from './feedback.js';",'const registerUnsaved=()=>()=>{},confirmLeave=async()=>true;');
source=source.replace("import { dashboardDrillURL } from './dashboard.js';",'const dashboardDrillURL=()=>\'#/overview\';');
const account=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('account section URLs allow only named sections and default safely',()=>{
  assert.equal(account.accountSection('#/account?section=privacy'),'privacy');assert.equal(account.accountSection('#/account?section=invitations'),'invitations');assert.equal(account.accountSection('#/account?section=%3Cscript%3E'),'profile');assert.equal(account.accountSection('#/account'),'profile');
});
test('profile inline validation accepts optional phone but rejects invalid names and zones',()=>{
  assert.deepEqual(account.profileErrors({full_name:'Ian',phone:'',time_zone:'Africa/Nairobi'}),{});
  const errors=account.profileErrors({full_name:' ',phone:'javascript:alert(1)',time_zone:'Not/AZone'});assert.ok(errors.full_name);assert.ok(errors.phone);assert.ok(errors.time_zone);
});
test('personal display timezone changes presentation without changing source values',()=>{
  assert.equal(account.accountDate(null),'Unavailable');assert.equal(account.accountDate('invalid'),'Unavailable');const at='2026-11-18T02:00:00Z';assert.notEqual(account.accountDate(at,{time_zone:'Africa/Nairobi'}),account.accountDate(at,{time_zone:'America/New_York'}));assert.equal(at,'2026-11-18T02:00:00Z');
});
test('startup checks live own factors before permitting any workspace load',async()=>{
  let reads=0;globalThis.__accountUser=async()=>{reads++;return{factors:[]};};globalThis.__accountClaims={aal:'aal1'};assert.equal(await account.requireMfa({}, {},()=>assert.fail('unexpected callback')),false);assert.equal(reads,1);
  globalThis.__accountUser=async()=>({factors:[{factor_type:'totp',status:'verified'}]});globalThis.__accountClaims={aal:'aal2'};assert.equal(await account.requireMfa({}, {},()=>{}),false);
  globalThis.__accountUser=async()=>{throw new Error('offline');};await assert.rejects(account.requireMfa({}, {},()=>{}),/offline/);
});
test('photo progress follows actual awaited preparation, upload and profile-save stages',async()=>{
  const stages=[],saved=[];let finishUpload;
  const pending=account.saveProfilePhoto({name:'photo.jpg'},{prepare:async()=>({type:'image/webp'}),upload:()=>new Promise(resolve=>{finishUpload=resolve;}),save:async path=>{saved.push(path);},preview:async()=>'/signed-photo',onStage:stage=>stages.push(stage)});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(stages,['Preparing photo…','Uploading photo…']);assert.deepEqual(saved,[]);
  finishUpload('own/avatar.webp');const result=await pending;
  assert.deepEqual(stages,['Preparing photo…','Uploading photo…','Saving profile…','Loading photo preview…']);assert.deepEqual(saved,['own/avatar.webp']);assert.deepEqual(result,{path:'own/avatar.webp',url:'/signed-photo',previewUnavailable:false});
});
test('photo failures stop subsequent writes and a failed preview still reports a saved profile',async()=>{
  let saves=0;const options={prepare:async()=>({}),upload:async()=>{throw new Error('Upload failed');},save:async()=>{saves++;}};
  await assert.rejects(account.saveProfilePhoto({},options),/Upload failed/);assert.equal(saves,0);
  const result=await account.saveProfilePhoto({},{...options,upload:async()=> 'own/avatar.webp',preview:async()=>{throw new Error('No preview');}});assert.equal(saves,1);assert.equal(result.previewUnavailable,true);assert.equal(result.path,'own/avatar.webp');
});
