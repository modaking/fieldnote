// Minimal Supabase client over fetch: Auth + PostgREST. No libraries.
const K = 'fw-session';
let C = null;

export const session = () => { try { return JSON.parse(localStorage.getItem(K)); } catch { return null; } };
const save = (s) => (s ? localStorage.setItem(K, JSON.stringify(s)) : localStorage.removeItem(K));
const pack = (j) => ({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user,
  expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600) });

async function raw(path, { method = 'GET', body, token, headers = {} } = {}) {
  const r = await fetch(C.url + path, { method, body: body && JSON.stringify(body),
    headers: { apikey: C.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } });
  const t = await r.text(), j = t ? JSON.parse(t) : null;
  if (!r.ok) { const e = new Error(j?.msg || j?.message || j?.error_description || r.statusText); e.status = r.status; throw e; }
  return j;
}

export async function init() {
  C = await (await fetch('/api/config')).json();
  if (!C.url) throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.');
  const s = session();
  if (s && s.expires_at - 60 < Date.now() / 1000) await refresh(s);
}

async function refresh(s) {
  try { save(pack(await raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } }))); }
  catch { save(null); }
}
const tok = async () => {
  let s = session(); if (!s) throw new Error('Signed out');
  if (s.expires_at - 60 < Date.now() / 1000) { await refresh(s); s = session(); if (!s) throw new Error('Session expired'); }
  return s.access_token;
};

export const auth = {
  async signUp(email, password, full_name) {
    const j = await raw('/auth/v1/signup', { method: 'POST', body: { email, password, data: { full_name } } });
    if (j.access_token) { save(pack(j)); return { signedIn: true }; }
    return { signedIn: false };              // email confirmation is on
  },
  async signIn(email, password) {
    save(pack(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } })));
  },
  async reset(email) { await raw('/auth/v1/recover', { method: 'POST', body: { email } }); },
  async signOut() { try { await raw('/auth/v1/logout', { method: 'POST', token: await tok() }); } catch {} save(null); },
};

const rest = async (path, opts = {}) => raw('/rest/v1/' + path, { ...opts, token: await tok() });
const rep = { Prefer: 'return=representation' };
export const db = {
  select: (table, query = '') => rest(`${table}?${query}`),
  insert: async (table, row) => (await rest(table, { method: 'POST', body: row, headers: rep }))[0],
  insertMany: (table, rows) => rest(table, { method: 'POST', body: rows, headers: rep }),
  update: async (table, id, patch) => (await rest(`${table}?id=eq.${id}`, { method: 'PATCH', body: patch, headers: rep }))[0],
  remove: (table, id) => rest(`${table}?id=eq.${id}`, { method: 'DELETE' }),
  upsert: (table, row, onConflict) => rest(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates' } }),
};
