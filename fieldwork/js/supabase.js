// Minimal Supabase client over fetch: Auth + PostgREST. No libraries.
const K = 'fw-session';
let C = null;
let memory = null, storageBlocked = false, refreshing = null;
let capabilityCache = null;
let authEpoch = 0;
const sessionListeners=new Set(),networkListeners=new Set();let requests=0,networkError='';
export const networkState=()=>({online:typeof navigator==='undefined'||navigator.onLine!==false,pending:requests,error:networkError});
const notifyNetwork=()=>{for(const listener of networkListeners){try{listener(networkState());}catch{}}};
export function subscribeNetwork(listener){networkListeners.add(listener);listener(networkState());return()=>networkListeners.delete(listener);}
export function subscribeSession(listener){sessionListeners.add(listener);return()=>sessionListeners.delete(listener);}
const requireAuthEpoch = (epoch) => { if (epoch !== authEpoch) throw error('A newer sign-in replaced this request. Continue with the latest account.', 409); };

const error = (message, status = 0, details = null) => Object.assign(new Error(message), { status, details });
const validSession = (s) => s && typeof s.access_token === 'string' && s.access_token
  && typeof s.refresh_token === 'string' && s.refresh_token && typeof s.user?.id === 'string';
export const session = () => {
  if (storageBlocked) return memory;
  try { const s = JSON.parse(localStorage.getItem(K)); return validSession(s) ? s : null; }
  catch { return memory; }
};
const save = (s) => {
  memory = s;
  try { if (s) localStorage.setItem(K, JSON.stringify(s)); else localStorage.removeItem(K); storageBlocked = false; }
  catch { storageBlocked = true; }
  for(const listener of sessionListeners){try{listener(s);}catch{}}
};
const pack = (j) => {
  if (!validSession(j)) throw error('The sign-in response was incomplete. Please try again.', 502);
  return { access_token: j.access_token, refresh_token: j.refresh_token, user: j.user,
    expires_at: Number(j.expires_at) || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600) };
};
const sameSession = (a, b) => a && b && a.user.id === b.user.id && a.refresh_token === b.refresh_token;
const currentUser = (uid) => {
  if (!session() || session().user.id !== uid) throw error('Your sign-in changed. Please sign in and try again.', 401);
};
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => { if (event.key === K||event.key==='fw-email-pkce') authEpoch++; });
  window.addEventListener('online',notifyNetwork);window.addEventListener('offline',notifyNetwork);
}
export const getPublicConfig = () => C ? { ...C } : null;

async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  if (!C) throw error('The app is not configured yet. Refresh and try again.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let r, t;
  requests++;notifyNetwork();
  try {
    r = await fetch(C.url + path, { method, signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: C.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } });
    t = await r.text();
    networkError='';
  } catch {
    networkError='Couldn’t connect. Reconnect and try again.';
    throw error('Couldn’t reach the server. Check your connection and try again.');
  } finally { clearTimeout(timer);requests--;notifyNetwork(); }
  let j = null;
  if (t) { try { j = JSON.parse(t); } catch {
    if (r.ok) throw error('The server returned an unexpected response. Refresh and try again.', 502);
  } }
  if (!r.ok) {
    const message = j?.msg || j?.message || j?.error_description || (typeof j?.error === 'string' ? j.error : null);
    throw error(message || `The request failed (${r.status}). Please try again.`, r.status, j);
  }
  return j;
}

export async function init() {
  let r, j;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    r = await fetch('/api/config', { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw error(`Couldn’t load app settings (${r.status}). Refresh and try again.`, r.status);
    j = await r.json();
  } catch (e) { throw e.status ? e : error('Couldn’t load app settings. Check your connection and try again.'); }
  finally { clearTimeout(timer); }
  if (typeof j?.url !== 'string' || !/^https?:\/\//i.test(j.url) || typeof j.anonKey !== 'string' || !j.anonKey.trim()) {
    throw error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.');
  }
  C = { url: j.url.replace(/\/+$/, ''), anonKey: j.anonKey };
  readEmailPending();
  const redirect = await auth.consumeRedirect();
  if (redirect) return redirect;
  const s = session();
  if (s && !(Number(s.expires_at) - 60 > Date.now() / 1000)) {
    // Connectivity problems must not erase a saved sign-in. The data request will
    // report them, while a revoked refresh token correctly returns to sign-in.
    try { await refresh(s); } catch {}
  }
  return null;
}

async function refresh(s) {
  if (refreshing?.token === s.refresh_token) return refreshing.promise;
  const pending = { token: s.refresh_token };
  refreshing = pending;
  pending.promise = (async () => {
    try {
      const next = pack(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }));
      if (sameSession(s, session())) save(next);
    } catch (e) {
      // Offline, timeout, rate-limit and server errors leave the session available
      // for a later retry. Only a rejected refresh credential signs this user out.
      if ([400, 401, 403].includes(e.status) && sameSession(s, session())) save(null);
      throw e;
    } finally { if (refreshing === pending) refreshing = null; }
  })();
  return pending.promise;
}
const tok = async () => {
  let s = session(); if (!s) throw error('Please sign in to continue.', 401);
  const uid = s.user.id;
  if (!(Number(s.expires_at) - 60 > Date.now() / 1000)) {
    await refresh(s); currentUser(uid); s = session();
  }
  return s.access_token;
};

export async function authorized(path, opts = {}) {
  const uid = session()?.user.id;
  let token = await tok();
  currentUser(uid);
  try {
    const result = await raw(path, { ...opts, token });
    currentUser(uid);
    return result;
  } catch (e) {
    if (e.status !== 401) throw e;
    currentUser(uid);
    // A simultaneous request may already have refreshed this access token.
    if (session().access_token === token) await refresh(session());
    currentUser(uid);
    token = session().access_token;
    try {
      const result = await raw(path, { ...opts, token });
      currentUser(uid);
      return result;
    } catch (retryError) {
      if (retryError.status === 401 && session()?.access_token === token) save(null);
      throw retryError;
    }
  }
}

const redirectTo = () => encodeURIComponent(location.origin + location.pathname);
const PKCE = 'fw-pkce';
const EMAIL_PKCE = 'fw-email-pkce';
const RECOVERY = 'fw-recovery';
let recoveryMemory=null,callbackInvite='';
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sessionId=()=>{try{return JSON.parse(atob(session().access_token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id||null;}catch{return null;}};
const storeRecovery=state=>{recoveryMemory=state;try{sessionStorage.setItem(RECOVERY,JSON.stringify(state));}catch{}};
const recoveryState=()=>{let state=recoveryMemory;try{state=JSON.parse(sessionStorage.getItem(RECOVERY))||state;}catch{}if(state?.userId===session()?.user.id&&state.sessionId===sessionId()&&Date.now()-state.at>=0&&Date.now()-state.at<1800000)return state;return null;};
const readEmailPending=()=>{try{const raw=localStorage.getItem(EMAIL_PKCE);if(!raw)return null;const state=JSON.parse(raw),age=Date.now()-state?.at;if(typeof state?.verifier==='string'&&/^[A-Za-z0-9_-]{64}$/.test(state.verifier)&&['recovery','magiclink'].includes(state.type)&&typeof state.email==='string'&&Number.isFinite(age)&&age>=0&&age<=900000)return state;localStorage.removeItem(EMAIL_PKCE);}catch{}return null;};
const clearEmailPending=verifier=>{try{if(!verifier||JSON.parse(localStorage.getItem(EMAIL_PKCE))?.verifier===verifier)localStorage.removeItem(EMAIL_PKCE);}catch{}};
async function emailPKCE(type,email,{invitation=false,returnTo=location.hash,inviteToken=''}={}){
  const epoch=authEpoch,expectedUserId=invitation?session()?.user.id:null,address=String(email||'').trim();
  if(invitation&&!expectedUserId)throw error('Sign in before verifying an invitation.',401);
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(48))),challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  requireAuthEpoch(epoch);
  try{inviteToken=inviteToken||sessionStorage.getItem('fw-invite')||'';}catch{}if(!/^[0-9a-f]{64}$/i.test(inviteToken))inviteToken='';
  const pending={verifier,at:Date.now(),type,email:address.toLowerCase(),invitation:Boolean(invitation||type==='recovery'&&inviteToken),...(inviteToken?{inviteToken}:{}),...(expectedUserId?{expectedUserId}:{}),returnTo:/^#\/[a-z][a-z0-9/-]*(?:\?[^#]*)?$/i.test(returnTo||'')?returnTo:''};
  try{const encoded=JSON.stringify(pending);localStorage.setItem(EMAIL_PKCE,encoded);if(localStorage.getItem(EMAIL_PKCE)!==encoded)throw new Error('Storage unavailable');}catch{clearEmailPending(verifier);throw error('Allow browser storage, then request a new email link. Open it in this same browser.');}
  try{sessionStorage.removeItem(PKCE);}catch{}
  try{await raw(`/auth/v1/${type==='recovery'?'recover':'otp'}?redirect_to=${redirectTo()}`,{method:'POST',body:{email:address,...(type==='magiclink'?{create_user:false}:{}),code_challenge:challenge,code_challenge_method:'s256'}});requireAuthEpoch(epoch);}
  catch(failure){clearEmailPending(verifier);throw failure;}
}
const invitationStatus=value=>{if(typeof value?.needs_recovery!=='boolean'||typeof value.proof_recent!=='boolean')throw error('Invitation verification is unavailable. Ask your workspace administrator to finish the reviewed security upgrade.',503);return{needs_recovery:value.needs_recovery,proof_recent:value.proof_recent};};
export const auth = {
  recoveryPending:recoveryState,
  isRecoverySession:state=>Boolean(state&&state.userId===session()?.user.id&&state.sessionId===sessionId()),
  takeInviteIntent(){const token=callbackInvite;callbackInvite='';return token;},
  clearEmailLink:()=>clearEmailPending(),
  markRecoveryPasswordSaved(){const state=recoveryState();if(state){state.passwordSaved=true;storeRecovery(state);}},
  finishRecovery(){recoveryMemory=null;try{sessionStorage.removeItem(RECOVERY);}catch{}},
  async invitationVerification(){try{return invitationStatus(await authorized('/rest/v1/rpc/fw_invitation_verification',{method:'POST',body:{}}));}catch(failure){if([400,404].includes(failure.status))throw error('Invitation verification is unavailable. Ask your workspace administrator to finish the reviewed security upgrade.',failure.status);throw failure;}},
  async completeInviteRecovery(){const status=invitationStatus(await authorized('/rest/v1/rpc/fw_complete_invite_recovery',{method:'POST',body:{}}));if(status.needs_recovery||!status.proof_recent)throw error('Email verification is incomplete. Request a new recovery link before joining a workspace.',403);return status;},
  async capabilities({refresh:reload=false}={}) {
    if(!C)throw error('The app is not configured yet. Refresh and try again.');
    if(!reload&&capabilityCache?.url===C.url&&capabilityCache.expires>Date.now())return capabilityCache.promise;
    const pending={url:C.url,expires:Date.now()+300000};
    pending.promise=(async()=>{try{
      const settings=await raw('/auth/v1/settings');
      if(!settings?.external||typeof settings.external!=='object'||Array.isArray(settings.external))throw error('Sign-in options could not be verified. Try again.',502);
      return Object.freeze({google:settings.external.google===true,email:settings.external.email===true,signup:settings.disable_signup!==true});
    }catch(failure){if(capabilityCache===pending)capabilityCache=null;throw failure;}})();
    capabilityCache=pending;return pending.promise;
  },
  magicLink:(email,options)=>emailPKCE('magiclink',email,options),
  async resendVerification(email) {
    await raw('/auth/v1/resend?redirect_to=' + redirectTo(), { method: 'POST', body: { email: email.trim(), type: 'signup' } });
  },
  async google() {
    const epoch = ++authEpoch;
    const options=await auth.capabilities();requireAuthEpoch(epoch);
    if(!options.google)throw error('Google sign-in is not enabled for this app. Use your password or an email sign-in link.',400);
    clearEmailPending();
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    try { sessionStorage.setItem(PKCE, JSON.stringify({ verifier, at: Date.now() })); }
    catch { throw error('Allow browser storage to continue with Google. You can also sign in with your email.'); }
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    requireAuthEpoch(epoch);
    location.assign(C.url + '/auth/v1/authorize?provider=google&redirect_to=' + redirectTo() + '&code_challenge_method=s256&code_challenge=' + challenge);
  },
  async signUp(email, password, full_name) {
    const epoch = ++authEpoch;
    const j = await raw('/auth/v1/signup?redirect_to=' + redirectTo(), { method: 'POST', body: { email: email.trim(), password, data: { full_name } } });
    requireAuthEpoch(epoch);
    if (j?.access_token) { save(pack(j)); return { signedIn: true }; }
    return { signedIn: false };              // email confirmation is on
  },
  async signIn(email, password) {
    const epoch = ++authEpoch;
    const next = pack(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } }));
    requireAuthEpoch(epoch); save(next);
  },
  reset:(email,options)=>emailPKCE('recovery',email,options),
  async updatePassword(password, nonce) {
    if (typeof password !== 'string' || password.length < 8) throw error('Use a password with at least 8 characters.', 400);
    const user = await authorized('/auth/v1/user', { method: 'PUT', body: { password, ...(nonce ? { nonce } : {}) } });
    const s = session(); if (s && user?.id === s.user.id) save({ ...s, user });
    return user;
  },
  async consumeRedirect() {
    const query = new URLSearchParams(location.search);
    if (query.has('code') || query.has('error_description')) {
      const epoch = ++authEpoch;
      const code = query.get('code'); query.delete('code');
      const message = query.get('error_description'); query.delete('error_description'); query.delete('error');
      history.replaceState(null, '', location.pathname + (query.size ? '?' + query : '') + location.hash);
      if (message) throw error(message, 400);
      let pending=readEmailPending(),emailFlow=Boolean(pending);
      if(!pending)try { pending = JSON.parse(sessionStorage.getItem(PKCE)); sessionStorage.removeItem(PKCE); } catch {}
      const age = Date.now() - pending?.at;
      if (typeof pending?.verifier !== 'string' || !pending.verifier || !Number.isFinite(pending.at) || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) throw error('This sign-in link expired or was opened in another browser. Start sign-in again here.', 400);
      const next = pack(await raw('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: pending.verifier } }));
      const expectedUser=pending.expectedUserId||pending.userId;
      if(expectedUser&&(next.user.id!==expectedUser||(session()&&session().user.id!==expectedUser)))throw error('This link returned a different account. Sign in to the original account and request a new link.',401);
      if(pending.email&&String(next.user.email||'').toLowerCase()!==pending.email)throw error('This email link belongs to another account. Request a new link for your current email.',401);
      if(emailFlow&&readEmailPending()?.verifier!==pending.verifier)throw error('A newer email link replaced this request. Open the latest email link.',409);
      requireAuthEpoch(epoch); save(next);
      const type=['recovery','magiclink'].includes(pending.type)?pending.type:'oauth';
      if(type==='recovery')storeRecovery({userId:next.user.id,sessionId:sessionId(),at:Date.now(),invitation:pending.invitation===true,passwordSaved:false});
      if(emailFlow){clearEmailPending(pending.verifier);if(/^[0-9a-f]{64}$/i.test(pending.inviteToken||'')){callbackInvite=pending.inviteToken;try{sessionStorage.setItem('fw-invite',callbackInvite);}catch{}}}
      if(pending.returnTo)history.replaceState(null,'',location.pathname+location.search+pending.returnTo);
      return {type};
    }
    const p = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
    if (!p.has('access_token') && !p.has('error') && !p.has('error_description')) return null;
    const epoch = ++authEpoch;
    // Remove credentials from the address immediately, including on expired links.
    history.replaceState(null, '', location.pathname + location.search);
    if (p.has('error') || p.has('error_description')) throw error(p.get('error_description') || 'This email link is invalid or has expired. Request a new one.', 400);
    const access_token = p.get('access_token'), refresh_token = p.get('refresh_token');
    if (!access_token || !refresh_token) throw error('This email link is incomplete. Request a new one.', 400);
    const user = await raw('/auth/v1/user', { token: access_token });
    requireAuthEpoch(epoch);
    save(pack({ access_token, refresh_token, user, expires_at: p.get('expires_at'), expires_in: p.get('expires_in') }));
    // Older email links still open the reset form, but never grant invitation
    // verification; only the server's signed PKCE proof can authorize that.
    if(p.get('type')==='recovery')storeRecovery({userId:user.id,sessionId:sessionId(),at:Date.now(),invitation:false,passwordSaved:false});
    return { type: p.get('type') || 'signup' };
  },
  async signOut() {
    authEpoch++;
    const token = session()?.access_token;
    save(null);
    recoveryMemory=null;
    callbackInvite='';clearEmailPending();
    try { sessionStorage.removeItem(PKCE);sessionStorage.removeItem(RECOVERY); } catch {}
    if (token) { try { await raw('/auth/v1/logout', { method: 'POST', token }); } catch { return {remoteRevoked:false}; } }
    return {remoteRevoked:true};
  },
  async adoptSession(next) {
    const uid = session()?.user.id, epoch = ++authEpoch, packed = pack(next);
    if (!uid || packed.user.id !== uid) throw error('Your account changed. Sign in and try again.', 401);
    const user = await raw('/auth/v1/user', { token: packed.access_token });
    requireAuthEpoch(epoch); currentUser(uid);
    if (user?.id !== uid) throw error('Your account changed. Sign in and try again.', 401);
    save({ ...packed, user });
  },
  syncUser(user) { const s=session(); if (s && user?.id===s.user.id) save({...s,user}); },
};

const rest = (path, opts = {}) => authorized('/rest/v1/' + path, opts);
const rep = { Prefer: 'return=representation' };
const tableName = (table) => {
  if (typeof table !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(table)) throw error('Choose a valid record type.', 400);
  return table;
};
const recordId = (id) => {
  if (typeof id !== 'string' || !id.trim()) throw error('This record has no ID. Refresh and try again.', 400);
  return encodeURIComponent(id);
};
const first = (rows, action) => {
  if (!Array.isArray(rows) || !rows.length) throw error(`This record could not be ${action}. It may have been removed or your access changed. Refresh and try again.`, 409);
  return rows[0];
};
export const db = {
  rpc: (name, args = {}, query = '') => {
    const path='rpc/'+tableName(name);if(typeof query!=='string')throw error('Choose valid RPC read options.',400);
    return rest(path+(query?'?'+new URLSearchParams(query).toString():''),{method:'POST',body:args});
  },
  select: (table, query = '') => rest(`${tableName(table)}?${query}`),
  insert: async (table, row) => first(await rest(tableName(table), { method: 'POST', body: row, headers: rep }), 'saved'),
  insertMany: (table, rows) => rest(tableName(table), { method: 'POST', body: rows, headers: rep }),
  update: async (table, id, patch) => first(await rest(`${tableName(table)}?id=eq.${recordId(id)}`, { method: 'PATCH', body: patch, headers: rep }), 'updated'),
  remove: (table, id) => rest(`${tableName(table)}?id=eq.${recordId(id)}`, { method: 'DELETE' }),
  upsert: (table, row, onConflict) => {
    if (typeof onConflict !== 'string' || !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/i.test(onConflict)) throw error('Choose valid conflict columns.', 400);
    return rest(`${tableName(table)}?on_conflict=${encodeURIComponent(onConflict)}`, { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates' } });
  },
};
