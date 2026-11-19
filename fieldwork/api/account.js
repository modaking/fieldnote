// Server-only account operations. Never return or publish the service-role key.
// The caller's identity comes from a verified bearer, never a body/query user ID.
const PRIMARY_AUTH = new Set(['password','oauth','otp','magiclink','sso/saml']);
function claimsOf(token) { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } }
const problem = (status, message) => Object.assign(new Error(message), { status });
function createHandler({ fetch: fetcher = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  return async function account(req, res) {
    res.setHeader('Cache-Control','no-store'); res.setHeader('Vary','Authorization, Origin');
    const send = (status, value) => status === 204 ? res.status(204).end() : res.status(status).json(value);
    if (!['GET','POST','DELETE'].includes(req.method)) { res.setHeader('Allow','GET, POST, DELETE'); return send(405,{message:'Method not allowed.'}); }
    try {
      const url = String(env.SUPABASE_URL || '').replace(/\/+$/,''), anonKey = env.SUPABASE_ANON_KEY;
      const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || String(env.SERVICE_ROLE_KEY || '').trim();
      if (!/^https:\/\//.test(url) || !anonKey) throw problem(503,'Account services are not configured. Ask the workspace administrator to finish setup.');
      if (req.headers.origin) {
        let origin; try { origin = new URL(req.headers.origin); } catch { throw problem(403,'This account request has an invalid origin.'); }
        if (origin.host !== req.headers.host) throw problem(403,'Open Account in the app to continue.');
      }
      const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];
      if (!token) throw problem(401,'Sign in to manage your account.');
      async function request(path, { method='GET', body, service=false } = {}) {
        const key = service ? serviceKey : anonKey;
        const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15000);
        try {
          const response = await fetcher(url+path,{method,signal:controller.signal,headers:{apikey:key,Authorization:'Bearer '+(service?key:token),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
          let data = null; const text = await response.text(); if(text){try{data=JSON.parse(text);}catch{throw problem(502,'The account service returned an unexpected response.');}}
          return { ok:response.ok,status:response.status,data };
        } catch(error) { if(error.status)throw error;throw problem(503,'The account service could not be reached. Try again later.'); }
        finally {clearTimeout(timer);}
      }
      // Supabase validates the token's signature and current user before claims
      // are used for this token's recent-auth/MFA checks below.
      const verified = await request('/auth/v1/user');
      if (!verified.ok || !verified.data?.id || verified.data.is_anonymous) throw problem(401,'Your permanent sign-in could not be verified. Sign in again.');
      const user=verified.data, claims=claimsOf(token), seconds=now()/1000;
      if(claims.sub!==user.id || claims.role!=='authenticated' || claims.iss!==url+'/auth/v1' || !(claims.exp>seconds)
        || !(claims.aud==='authenticated'||Array.isArray(claims.aud)&&claims.aud.includes('authenticated'))) throw problem(401,'Use a current Fieldnote sign-in to continue.');
      // GET /user also accepts delegated OAuth-client tokens. Personal account
      // management requires a direct session, particularly before service-role
      // deletion; an application's delegated grant is not that authorization.
      if(claims.client_id!=null)throw problem(403,'Open Fieldnote and sign in directly to manage your account.');
      if(req.method==='GET')return send(200,{delete_available:Boolean(serviceKey),message:serviceKey?'':'Account deletion is unavailable until its server-side service credential is configured. No credential belongs in the browser.'});
      let body=req.body; if(typeof body==='string'){try{body=JSON.parse(body);}catch{throw problem(400,'Submit a valid account request.');}}
      if(!body||typeof body!=='object'||Array.isArray(body)||'user_id' in body||'userId' in body)throw problem(400,'Submit an account request for your own sign-in.');
      const recent=Array.isArray(claims.amr)&&claims.amr.some(item=>PRIMARY_AUTH.has(item.method)&&Number.isFinite(item.timestamp)&&seconds-item.timestamp>=-30&&seconds-item.timestamp<=600);
      if(!recent)throw problem(403,'Sign in again before changing security details or deleting your account.');
      if((user.factors||[]).some(factor=>factor.status==='verified')&&claims.aal!=='aal2')throw problem(403,'Verify your authenticator before continuing.');
      // A signed access JWT can outlive logout. The checked, caller-scoped RPC
      // requires the actual session to remain active before sensitive actions.
      const status=await request('/rest/v1/rpc/fw_account_delete_status',{method:'POST',body:{}});
      if(!status.ok){
        if(status.status===401)throw problem(401,'This sign-in has ended. Sign in again to continue.');
        if(status.status===403)throw problem(403,'This sign-in cannot manage your account. Sign in again and verify your authenticator if prompted.');
        if([400,404].includes(status.status)&&['PGRST202','42883'].includes(status.data?.code))throw problem(503,'The reviewed account migration must be installed before security changes or deletion are available.');
        throw problem(status.status>=500?503:502,'Account access could not be checked. Try again, or ask your workspace administrator to review account setup.');
      }
      if(status.data?.schema_version!=='20261118-account')throw problem(503,'The reviewed account migration must be installed before security changes or deletion are available.');
      if(!status.data.session_active)throw problem(401,'This sign-in has ended. Sign in again to continue.');
      if(req.method==='POST'){
        let patch;
        if(body.action==='change_email'){
          if(typeof body.email!=='string'||body.email.length>320||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))throw problem(400,'Enter a valid new email address.');
          patch={email:body.email.trim()};
        } else if(body.action==='change_password'){
          if(typeof body.password!=='string'||body.password.length<8)throw problem(400,'Use a password with at least 8 characters.');
          patch={password:body.password,...(body.nonce?{nonce:String(body.nonce)}:{}),...(body.current_password?{current_password:String(body.current_password)}:{})};
        } else throw problem(400,'Choose a supported account action.');
        const result=await request('/auth/v1/user',{method:'PUT',body:patch});
        if(!result.ok)throw problem(result.status>=500?503:result.status,result.data?.message||result.data?.msg||'The security change could not be completed. Review your verification details.');
        if(result.data?.id!==user.id)throw problem(502,'The account service returned an incomplete security response. Refresh Account to review the change.');
        return send(200,{user:result.data,verification_required:body.action==='change_email'});
      }
      if(!serviceKey)throw problem(503,'Account deletion is not configured. Your account has not been changed.');
      if(body.confirmation!=='DELETE MY ACCOUNT'||typeof body.email!=='string'||body.email.toLowerCase().trim()!==String(user.email).toLowerCase())throw problem(400,'Confirm deletion with your current email address and the required confirmation.');
      if(status.data.owned_workspaces?.length)throw problem(409,'Transfer ownership of every workspace before deleting your account.');
      if(Number(status.data.business_files)>0)throw problem(409,'Business files are still owned by this account. Ask an administrator to transfer their ownership before deleting the account.');
      const paths=status.data.avatar_paths||[];
      if(!Array.isArray(paths)||paths.length>1000||paths.some(path=>typeof path!=='string'||!path.startsWith(user.id+'/')||path.includes('..')))throw problem(409,'Profile photo cleanup needs administrator review. Your account has not been deleted.');
      for(let i=0;i<paths.length;i+=100){
        const removed=await request('/storage/v1/object/fw-avatars',{method:'DELETE',body:{prefixes:paths.slice(i,i+100)},service:true});
        if(!removed.ok)throw problem(409,'The profile photo could not be removed. Your account has not been deleted.');
      }
      const removed=await request('/auth/v1/admin/users/'+encodeURIComponent(user.id),{method:'DELETE',body:{should_soft_delete:false},service:true});
      if(!removed.ok)throw problem(409,'The account could not be deleted. Workspace ownership or file references may have changed. Refresh Account and review them.');
      return send(204);
    }catch(error){return send(error.status||500,{message:error.status?error.message:'Account services encountered a problem. Your account request could not be completed.'});}
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
