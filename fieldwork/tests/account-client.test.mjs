import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/account-client.js',import.meta.url),'utf8');let n=0;
const uid='ab000000-0000-4000-8000-000000000001',factor='ab000000-0000-4000-8000-000000000002';
async function client(){
  const calls=[],adopted=[];let current={user:{id:uid,email:'me@example.invalid'},access_token:'access'},user={id:uid,email:'me@example.invalid',factors:[]};
  globalThis.__accountTest={session:()=>current,auth:{syncUser(){},async adoptSession(s){adopted.push(s);}},getPublicConfig:()=>({url:'https://db.example.invalid',anonKey:'public-key'}),authorized:async(path,opts)=>{calls.push({path,...opts});if(path==='/auth/v1/user')return user;if(path.endsWith('/challenge'))return{id:'challenge'};if(path.endsWith('/verify'))return{user:{id:uid},access_token:'verified',refresh_token:'refresh'};return{};}};
  const replaced=source.replace("import { authorized, getPublicConfig, session, auth } from './supabase.js';",'const {authorized,getPublicConfig,session,auth}=globalThis.__accountTest;');
  const api=await import('data:text/javascript;base64,'+Buffer.from(replaced).toString('base64')+'#'+(++n));return{...api,calls,adopted,setSession:s=>current=s,setUser:u=>user={...user,...u}};
}
test('authenticator codes are validated before requests and verified tokens use guarded adoption',async()=>{
  const c=await client();await assert.rejects(c.accountClient.verifyFactor(factor,'123'),/six-digit/);assert.equal(c.calls.length,0);
  await c.accountClient.verifyFactor(factor,'123456');assert.deepEqual(c.calls.map(c=>c.path),['/auth/v1/factors/'+factor+'/challenge','/auth/v1/factors/'+factor+'/verify']);assert.deepEqual(c.calls[1].body,{challenge_id:'challenge',code:'123456'});assert.equal(c.adopted.length,1);
});
test('recent auth requires fresh primary AMR and does not treat tokens as trusted verification',async()=>{
  const c=await client(),now=1800000000000;
  assert.equal(c.recentlyAuthenticated({amr:[{method:'password',timestamp:now/1000-1}]},now),true);
  assert.equal(c.recentlyAuthenticated({amr:[{method:'totp',timestamp:now/1000}]},now),false);
  assert.equal(c.recentlyAuthenticated({amr:[{method:'oauth',timestamp:now/1000-601}]},now),false);
  assert.deepEqual(c.sessionClaims('bad'),{});
});
test('reauthentication uses GET and other-device logout explicitly preserves this session',async()=>{
  const c=await client();await c.accountClient.sendReauthentication();await c.accountClient.signOutOthers();assert.deepEqual(c.calls,[{path:'/auth/v1/reauthenticate'},{path:'/auth/v1/logout?scope=others',method:'POST'}]);
});
test('profile image checks reject invalid files and cross-account paths before storage traffic',async()=>{
  const c=await client();await assert.rejects(c.prepareAvatar({type:'image/svg+xml',size:10}),/JPEG/);await assert.rejects(c.prepareAvatar({type:'image/png',size:11*1024*1024}),/10 MB/);
  assert.equal(await c.accountClient.avatarURL('other/avatar.webp'),null);await assert.rejects(c.accountClient.removeAvatar('other/avatar.webp'),/does not belong/);assert.equal(c.calls.length,0);
});
test('account API refreshes own token, sends no caller ID or service key, and rejects identity changes',async()=>{
  const c=await client();let sent;
  globalThis.fetch=async(path,opts)=>{sent={path,...opts};return new Response(JSON.stringify({delete_available:false}),{status:200});};
  await c.accountClient.availability();assert.equal(sent.path,'/api/account');assert.equal(sent.headers.Authorization,'Bearer access');assert.equal(sent.headers.apikey,undefined);
  globalThis.fetch=async()=>{c.setSession({user:{id:'other'},access_token:'other'});return new Response('{}');};
  await assert.rejects(c.accountClient.deleteAccount('me@example.invalid'),/account changed/);
});
test('Google removal uses the current own identity UUID and keeps a remaining sign-in method',async()=>{
  const c=await client();c.setUser({identities:[{provider:'email',identity_id:uid},{provider:'google',id:'external-google-subject',identity_id:factor}]});
  assert.equal(await c.accountClient.unlinkGoogle(),factor);
  assert.deepEqual(c.calls,[{path:'/auth/v1/user'},{path:'/auth/v1/user/identities/'+factor,method:'DELETE'}]);
  c.calls.length=0;c.setUser({identities:[{provider:'google',identity_id:factor}]});await assert.rejects(c.accountClient.unlinkGoogle(),/Keep another sign-in/);assert.ok(!c.calls.some(call=>call.method==='DELETE'));
});
test('Google removal rejects stale/malformed identity details without issuing DELETE',async()=>{
  const c=await client();c.setUser({identities:[{provider:'email',identity_id:uid}]});await assert.rejects(c.accountClient.unlinkGoogle(),/not connected/);
  c.setUser({identities:[{provider:'email',identity_id:uid},{provider:'google',id:'google-subject'}]});await assert.rejects(c.accountClient.unlinkGoogle(),/details are unavailable/);assert.ok(!c.calls.some(call=>call.method==='DELETE'));
});
