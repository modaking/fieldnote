import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createHandler}=createRequire(import.meta.url)('../api/account.js');
const uid='ab000000-0000-4000-8000-000000000001',now=1800000000000;
const env={SUPABASE_URL:'https://db.example.invalid',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'server-secret'};
const token=(changes={})=>['test',Buffer.from(JSON.stringify({sub:uid,role:'authenticated',aud:'authenticated',iss:env.SUPABASE_URL+'/auth/v1',exp:now/1000+3600,aal:'aal1',amr:[{method:'password',timestamp:now/1000}],...changes})).toString('base64url'),'verified-by-upstream'].join('.');
const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status});
async function run({method='DELETE',body={confirmation:'DELETE MY ACCOUNT',email:'me@example.invalid'},claims={},user={},status={},key=true,environment={},route,headers={}}={}){
  const calls=[];const handler=createHandler({env:{...env,...(!key?{SUPABASE_SERVICE_ROLE_KEY:''}:{}),...environment},now:()=>now,fetch:async(url,options)=>{
    const c={url,method:options.method,headers:options.headers,body:options.body?JSON.parse(options.body):undefined};calls.push(c);
    const custom=route?.(c);if(custom)return custom;
    if(url.endsWith('/auth/v1/user'))return reply(c.method==='PUT'?{id:uid,email:'me@example.invalid',...c.body}:{id:uid,email:'me@example.invalid',email_confirmed_at:'2026-01-01',factors:[],...user});
    if(url.endsWith('/rpc/fw_account_delete_status'))return reply({schema_version:'20261118-account',session_active:true,owned_workspaces:[],business_files:0,avatar_paths:[],...status});
    if(url.includes('/storage/v1/object/')||url.includes('/auth/v1/admin/users/'))return reply(null,204);
    throw new Error('Unexpected request '+url);
  }});
  const result={headers:{},statusCode:0,body:null};const res={setHeader(k,v){result.headers[k]=v;},status(code){result.statusCode=code;return this;},json(value){result.body=value;return this;},end(){return this;}};
  await handler({method,body,headers:{host:'app.example.invalid',origin:'https://app.example.invalid',authorization:'Bearer '+token(claims),...headers}},res);
  return {...result,calls};
}
test('requires verified own sign-in and rejects caller-selected identities before privileged work',async()=>{
  const denied=await run({route:c=>c.url.endsWith('/auth/v1/user')?reply({message:'invalid'},401):null});assert.equal(denied.statusCode,401);assert.equal(denied.calls.length,1);
  const selected=await run({body:{confirmation:'DELETE MY ACCOUNT',email:'me@example.invalid',user_id:'victim'}});assert.equal(selected.statusCode,400);assert.equal(selected.calls.length,1);
  const wrong=await run({claims:{sub:'another-user'}});assert.equal(wrong.statusCode,401);assert.equal(wrong.calls.length,1);
});
test('delegated OAuth-client tokens cannot access availability or any security/deletion endpoint',async()=>{
  for(const action of [{method:'GET'},{method:'POST',body:{action:'change_email',email:'next@example.invalid'}},{method:'POST',body:{action:'change_password',password:'new-password'}},{method:'DELETE'}]){
    const r=await run({...action,claims:{client_id:'delegated-client',aal:'aal2'}});assert.equal(r.statusCode,403);assert.equal(r.calls.length,1,'reject immediately after verifying caller claims');assert.ok(!r.calls.some(call=>call.method==='PUT'||call.method==='DELETE'));
  }
});
test('rejects cross-origin requests and missing bearer without upstream traffic',async()=>{
  for(const headers of [{origin:'https://other.example.invalid'},{authorization:''}]){const r=await run({headers});assert.ok([401,403].includes(r.statusCode));assert.equal(r.calls.length,0);}
});
test('sensitive changes require fresh primary authentication, not refresh or MFA alone',async()=>{
  for(const amr of [[{method:'password',timestamp:now/1000-601}],[{method:'token_refresh',timestamp:now/1000}],[{method:'totp',timestamp:now/1000}]]){
    const r=await run({claims:{amr}});assert.equal(r.statusCode,403);assert.equal(r.calls.length,1);
  }
});
test('enrolled MFA blocks aal1 and a revoked session blocks even a valid fresh JWT',async()=>{
  const mfa=await run({user:{factors:[{status:'verified',factor_type:'totp'}]}});assert.equal(mfa.statusCode,403);assert.equal(mfa.calls.length,1);
  const revoked=await run({status:{session_active:false},method:'POST',body:{action:'change_password',password:'new-password'}});assert.equal(revoked.statusCode,401);assert.ok(!revoked.calls.some(c=>c.method==='PUT'));
});
test('database session denials stay distinct from missing migrations and temporary failures',async()=>{
  for(const [http,code,expected,wording] of [[401,'PGRST301',401,/sign-in has ended/],[403,'42501',403,/sign in again/i],[404,'PGRST202',503,/migration must be installed/],[400,'42883',503,/migration must be installed/],[500,'XX000',503,/could not be checked/],[400,'22023',502,/could not be checked/]]){
    const r=await run({method:'POST',body:{action:'change_password',password:'new-password'},route:c=>c.url.endsWith('/rpc/fw_account_delete_status')?reply({code,message:'upstream detail'},http):null});
    assert.equal(r.statusCode,expected);assert.match(r.body.message,wording);assert.equal(r.calls.length,2);assert.ok(!r.calls.some(c=>c.method==='PUT'||c.method==='DELETE'));assert.ok(!JSON.stringify(r.body).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  }
});
test('missing backend credential, owned workspaces and shared files fail without deleting anything',async()=>{
  for(const fixture of [{key:false},{status:{owned_workspaces:[{id:'ws',name:'Farm'}]}},{status:{business_files:1}}]){
    const r=await run(fixture);assert.ok([409,503].includes(r.statusCode));assert.ok(!r.calls.some(c=>c.method==='DELETE'));assert.ok(!JSON.stringify(r.body).includes(env.SUPABASE_SERVICE_ROLE_KEY));
  }
});
test('successful deletion uses only verified user ID and keeps service key on server-only calls',async()=>{
  const r=await run({claims:{aal:'aal2'},user:{factors:[{status:'verified'}]},status:{avatar_paths:[uid+'/avatar.webp']}});
  assert.equal(r.statusCode,204);assert.equal(r.calls.length,4);
  assert.equal(r.calls[2].url,env.SUPABASE_URL+'/storage/v1/object/fw-avatars');assert.deepEqual(r.calls[2].body,{prefixes:[uid+'/avatar.webp']});
  assert.equal(r.calls[3].url,env.SUPABASE_URL+'/auth/v1/admin/users/'+uid);assert.deepEqual(r.calls[3].body,{should_soft_delete:false});
  for(const c of r.calls.slice(0,2))assert.equal(c.headers.apikey,'public-key');
  for(const c of r.calls.slice(2))assert.equal(c.headers.Authorization,'Bearer server-secret');
  assert.equal(r.headers['Cache-Control'],'no-store');
});

test('server-only SERVICE_ROLE_KEY alias enables availability and privileged deletion without exposing it',async()=>{
  const environment={SUPABASE_SERVICE_ROLE_KEY:undefined,SERVICE_ROLE_KEY:' alias-server-secret '};
  const available=await run({method:'GET',environment});assert.equal(available.statusCode,200);assert.deepEqual(available.body,{delete_available:true,message:''});
  assert.equal(available.calls.length,1);assert.equal(available.calls[0].headers.apikey,'public-key');assert.ok(!JSON.stringify(available.body).includes('alias-server-secret'));
  const deleted=await run({environment,status:{avatar_paths:[uid+'/avatar.webp']}});assert.equal(deleted.statusCode,204);assert.equal(deleted.calls.length,4);
  for(const call of deleted.calls.slice(0,2)){assert.equal(call.headers.apikey,'public-key');assert.ok(!call.headers.Authorization.includes('alias-server-secret'));}
  for(const call of deleted.calls.slice(2)){assert.equal(call.headers.apikey,'alias-server-secret');assert.equal(call.headers.Authorization,'Bearer alias-server-secret');}
  assert.equal(deleted.calls.at(-1).url,env.SUPABASE_URL+'/auth/v1/admin/users/'+uid);assert.ok(!JSON.stringify(deleted.body).includes('alias-server-secret'));
  const blankCanonical=await run({method:'GET',environment:{...environment,SUPABASE_SERVICE_ROLE_KEY:' '}});assert.equal(blankCanonical.body.delete_available,true);
});

test('canonical service credential takes precedence over its server alias',async()=>{
  const result=await run({environment:{SUPABASE_SERVICE_ROLE_KEY:' canonical-server-secret ',SERVICE_ROLE_KEY:'alias-server-secret'}});
  assert.equal(result.statusCode,204);const admin=result.calls.at(-1);assert.equal(admin.headers.apikey,'canonical-server-secret');assert.equal(admin.headers.Authorization,'Bearer canonical-server-secret');
  assert.ok(!result.calls.some(call=>call.headers.Authorization.includes('alias-server-secret')));
});
test('avatar cleanup refuses paths for another user and prevents deletion after failed cleanup',async()=>{
  const escaped=await run({status:{avatar_paths:['someone-else/avatar.webp']}});assert.equal(escaped.statusCode,409);assert.equal(escaped.calls.length,2);
  const failed=await run({status:{avatar_paths:[uid+'/avatar.webp']},route:c=>c.url.includes('/storage/v1/object/')?reply({message:'error'},500):null});assert.equal(failed.statusCode,409);assert.ok(!failed.calls.some(c=>c.url.includes('/admin/users/')));
});
test('security updates whitelist own Auth fields and propagate verification errors without service key',async()=>{
  const r=await run({method:'POST',body:{action:'change_email',email:' next@example.invalid ',app_metadata:{role:'admin'},email_confirm:true}});assert.equal(r.statusCode,200);assert.equal(r.body.verification_required,true);assert.deepEqual(r.calls.at(-1).body,{email:'next@example.invalid'});assert.equal(r.calls.at(-1).headers.apikey,'public-key');
  const password=await run({method:'POST',body:{action:'change_password',password:'new-password',nonce:'123456',current_password:'old-password'}});assert.equal(password.statusCode,200);assert.deepEqual(password.calls.at(-1).body,{password:'new-password',nonce:'123456',current_password:'old-password'});
  const anonymous=await run({user:{is_anonymous:true}});assert.equal(anonymous.statusCode,401);
});
test('unsupported or unavailable migration fails closed without security/admin mutation',async()=>{
  const r=await run({status:{schema_version:'old'}});assert.equal(r.statusCode,503);assert.ok(!r.calls.some(c=>c.method==='DELETE'||c.method==='PUT'));
  const unavailable=await run({route:()=>{throw new Error('offline');}});assert.equal(unavailable.statusCode,503);assert.ok(!JSON.stringify(unavailable.body).includes('server-secret'));
});
