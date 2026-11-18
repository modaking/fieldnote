// Minimal Supabase client over fetch: Auth + PostgREST. No libraries.
const K = 'fw-session';
let C = null;
let memory = null, storageBlocked = false, refreshing = null;
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
  window.addEventListener('storage', (event) => { if (event.key === K) authEpoch++; });
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
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const auth = {
  async magicLink(email) {
    await raw('/auth/v1/otp?redirect_to=' + redirectTo(), { method: 'POST', body: { email: email.trim(), create_user: false } });
  },
  async resendVerification(email) {
    await raw('/auth/v1/resend?redirect_to=' + redirectTo(), { method: 'POST', body: { email: email.trim(), type: 'signup' } });
  },
  async google() {
    const epoch = ++authEpoch;
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
  async reset(email) { await raw('/auth/v1/recover?redirect_to=' + redirectTo(), { method: 'POST', body: { email: email.trim() } }); },
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
      let pending;
      try { pending = JSON.parse(sessionStorage.getItem(PKCE)); sessionStorage.removeItem(PKCE); } catch {}
      const age = Date.now() - pending?.at;
      if (typeof pending?.verifier !== 'string' || !pending.verifier || !Number.isFinite(pending.at) || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) throw error('This sign-in link expired or was opened in another browser. Start sign-in again here.', 400);
      const next = pack(await raw('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: pending.verifier } }));
      const expectedUser=pending.expectedUserId||pending.userId;
      if(expectedUser&&(next.user.id!==expectedUser||(session()&&session().user.id!==expectedUser)))throw error('Google returned a different account. Sign in to the original account and try linking again.',401);
      requireAuthEpoch(epoch); save(next);
      return { type: 'oauth' };
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
    return { type: p.get('type') || 'signup' };
  },
  async signOut() {
    authEpoch++;
    const token = session()?.access_token;
    save(null);
    try { sessionStorage.removeItem(PKCE); } catch {}
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
  rpc: (name, args = {}) => rest('rpc/' + tableName(name), { method: 'POST', body: args }),
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
