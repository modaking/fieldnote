import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

// Run the existing, dependency-free client against controlled fetch/storage
// boundaries. These tests never contact a real account or database.
const source = await readFile(new URL('../js/supabase.js', import.meta.url), 'utf8');
let moduleNumber = 0;
const reply = (value, status = 200) => status === 204
  ? new Response(null, { status }) : new Response(JSON.stringify(value), { status });
const signedIn = (changes = {}) => ({
  access_token: 'access-a', refresh_token: 'refresh-a', user: { id: 'user-a', email: 'a@example.invalid' },
  expires_at: Math.floor(Date.now() / 1000) + 3600, ...changes,
});
const turn = () => new Promise((resolve) => setImmediate(resolve));

async function client({ stored = signedIn(), deferInit = false, config = { url: 'https://db.example.invalid/', anonKey: 'public-test-key' } } = {}) {
  const values = new Map(stored ? [['fw-session', JSON.stringify(stored)]] : []);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const tabValues = new Map(), assignments = [];
  globalThis.sessionStorage = {
    getItem: (key) => tabValues.get(key) ?? null,
    setItem: (key, value) => tabValues.set(key, value),
    removeItem: (key) => tabValues.delete(key),
  };
  globalThis.location = { origin: 'https://fieldwork.example.invalid', pathname: '/farm/', search: '?keep=1', hash: '', assign: (url) => assignments.push(url) };
  const historyCalls = [];
  globalThis.history = { replaceState: (_state, _title, path) => { historyCalls.push(path); const next = new URL(path, location.origin); Object.assign(location, { pathname: next.pathname, search: next.search, hash: next.hash }); } };
  const calls = [];
  let handler = ({ url, method, body }) => {
    if (url.includes('/auth/v1/token')) return reply(signedIn({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' }));
    if (url.endsWith('/auth/v1/user')) return reply({ id: 'user-a', email: 'a@example.invalid' });
    if (method === 'GET') return reply([]);
    return reply(body ? [{ id: 'record-one', ...JSON.parse(body) }] : null);
  };
  globalThis.fetch = async (url, options = {}) => {
    const request = { url: String(url), method: options.method || 'GET', ...options };
    calls.push(request);
    if (url === '/api/config') return reply(config);
    return handler(request);
  };
  // A fresh module isolates session/refresh state without changing the source or
  // requiring a package manager, test library, or experimental Node flag.
  const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#case-${++moduleNumber}`);
  const result = { ...api, calls, values, tabValues, assignments, historyCalls, respond: (fn) => { handler = fn; } };
  if (!deferInit) await api.init();
  calls.length = 0;
  return result;
}

test('single inserts and updates retain object responses and unchanged minor-unit amounts', async () => {
  const c = await client();
  c.respond(({ body }) => reply([{ id: 'record-one', ...JSON.parse(body) }]));
  const row = await c.db.insert('transactions', { amount: 12345, currency: 'KES' });
  assert.equal(row.amount, 12345);
  assert.equal(Array.isArray(row), false);
  const changed = await c.db.update('transactions', row.id, { amount: 45678 });
  assert.equal(changed.amount, 45678);
  assert.equal(JSON.parse(c.calls[1].body).amount, 45678);
  assert.equal(c.calls[1].headers.Prefer, 'return=representation');
});

test('bulk inserts and upserts retain their original response contracts', async () => {
  const c = await client();
  c.respond(({ url }) => url.includes('on_conflict=') ? reply(null, 204) : reply([{ id: 'one' }, { id: 'two' }]));
  assert.deepEqual(await c.db.insertMany('farms', [{ name: 'A' }, { name: 'B' }]), [{ id: 'one' }, { id: 'two' }]);
  assert.equal(await c.db.upsert('budgets', { amount: 10000 }, 'workspace_id,farm_id,month'), null);
  assert.match(c.calls[1].url, /on_conflict=workspace_id%2Cfarm_id%2Cmonth/);
  assert.equal(c.calls[1].headers.Prefer, 'resolution=merge-duplicates');
});

test('an update matching no accessible row reports a failure instead of a false save', async () => {
  const c = await client(); c.respond(() => reply([]));
  await assert.rejects(c.db.update('farms', 'missing-record', { name: 'New name' }), { status: 409, message: /could not be updated/ });
});

test('missing IDs and invalid record types are rejected before sending a write', async () => {
  const c = await client();
  await assert.rejects(c.db.update('farms', undefined, { name: 'A' }), { status: 400 });
  assert.throws(() => c.db.remove('farms', ''), { status: 400 });
  assert.throws(() => c.db.select('farms?workspace_id=eq.other'), { status: 400 });
  assert.equal(c.calls.length, 0);
});

test('non-JSON server failures preserve the HTTP status and show a useful message', async () => {
  const c = await client(); c.respond(() => new Response('<html>Gateway error</html>', { status: 503 }));
  await assert.rejects(c.db.select('farms'), { status: 503, message: /request failed \(503\)/ });
  assert.ok(c.session());
});

test('a malformed successful server response is rejected without deleting the session', async () => {
  const c = await client(); c.respond(() => new Response('<html>Wrong page</html>', { status: 200 }));
  await assert.rejects(c.db.select('farms'), { status: 502, message: /unexpected response/ });
  assert.ok(c.session());
});

test('a stalled request times out as a connection error and keeps the session', async () => {
  const c = await client();
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay) => realTimeout(fn, delay === 15000 ? 1 : delay);
  c.respond(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })));
  try { await assert.rejects(c.db.select('farms'), { status: 0, message: /Check your connection/ }); }
  finally { globalThis.setTimeout = realTimeout; }
  assert.ok(c.session());
});

test('concurrent requests share one refresh for an expired token', async () => {
  const c = await client();
  c.values.set('fw-session', JSON.stringify(signedIn({ expires_at: 1 })));
  let completeRefresh;
  c.respond(({ url }) => url.includes('grant_type=refresh_token')
    ? new Promise((resolve) => { completeRefresh = resolve; }) : reply([]));
  const reads = Promise.all([c.db.select('farms'), c.db.select('tasks'), c.db.select('workers')]);
  await turn();
  assert.equal(c.calls.filter((r) => r.url.includes('grant_type=refresh_token')).length, 1);
  completeRefresh(reply(signedIn({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' })));
  await reads;
  assert.equal(c.session().refresh_token, 'fresh-refresh');
  assert.ok(c.calls.filter((r) => r.url.includes('/rest/')).every((r) => r.headers.Authorization === 'Bearer fresh-access'));
});

test('network and temporary server failures while refreshing preserve saved sign-in', async () => {
  const c = await client(); c.values.set('fw-session', JSON.stringify(signedIn({ expires_at: 1 })));
  c.respond(() => { throw new TypeError('Offline'); });
  await assert.rejects(c.db.select('farms'), { status: 0 });
  assert.equal(c.session().refresh_token, 'refresh-a');
  c.respond(() => reply({ message: 'Unavailable' }, 503));
  await assert.rejects(c.db.select('farms'), { status: 503 });
  assert.equal(c.session().refresh_token, 'refresh-a');
});

test('a rejected refresh credential signs out the affected session', async () => {
  const c = await client(); c.values.set('fw-session', JSON.stringify(signedIn({ expires_at: 1 })));
  c.respond(() => reply({ message: 'Invalid Refresh Token' }, 400));
  await assert.rejects(c.db.select('farms'), { status: 400 });
  assert.equal(c.session(), null);
});

test('initialization preserves an expired saved session when the refresh network is unavailable', async () => {
  const c = await client({ stored: signedIn({ expires_at: 1 }), deferInit: true });
  c.respond(() => { throw new TypeError('Offline'); });
  assert.equal(await c.init(), null);
  assert.equal(c.session().user.id, 'user-a');
});

test('simultaneous 401 responses share a refresh and retry with the new token', async () => {
  const c = await client();
  let completeRefresh;
  c.respond(({ url, headers }) => {
    if (url.includes('grant_type=refresh_token')) return new Promise((resolve) => { completeRefresh = resolve; });
    return headers.Authorization === 'Bearer access-a' ? reply({ message: 'Expired token' }, 401) : reply([]);
  });
  const reads = Promise.all([c.db.select('farms'), c.db.select('tasks')]);
  await turn();
  assert.equal(c.calls.filter((r) => r.url.includes('grant_type=refresh_token')).length, 1);
  completeRefresh(reply(signedIn({ access_token: 'new-access', refresh_token: 'new-refresh' })));
  await reads;
  assert.equal(c.calls.filter((r) => r.url.includes('/rest/')).length, 4);
});

test('network loss after a 401 refresh preserves the session without repeated write retries', async () => {
  const c = await client(); let writes = 0;
  c.respond(({ url }) => {
    if (url.includes('grant_type=refresh_token')) return reply(signedIn({ access_token: 'new-access', refresh_token: 'new-refresh' }));
    if (++writes === 1) return reply({ message: 'Expired' }, 401);
    throw new TypeError('Connection lost');
  });
  await assert.rejects(c.db.insert('transactions', { amount: 10100 }), { status: 0 });
  assert.equal(c.session().access_token, 'new-access');
  assert.equal(writes, 2);
});

test('a refresh finishing after sign-out cannot restore the previous session', async () => {
  const c = await client(); c.values.set('fw-session', JSON.stringify(signedIn({ expires_at: 1 })));
  let completeRefresh;
  c.respond(({ url }) => url.includes('grant_type=refresh_token')
    ? new Promise((resolve) => { completeRefresh = resolve; }) : reply(null, 204));
  const read = c.db.select('farms');
  await turn(); await c.auth.signOut();
  completeRefresh(reply(signedIn({ access_token: 'late-access', refresh_token: 'late-refresh' })));
  await assert.rejects(read, { status: 401 });
  assert.equal(c.session(), null);
});

test('a failed old refresh cannot erase a newly signed-in account', async () => {
  const c = await client(); c.values.set('fw-session', JSON.stringify(signedIn({ expires_at: 1 })));
  let completeRefresh;
  c.respond(({ url }) => url.includes('grant_type=refresh_token')
    ? new Promise((resolve) => { completeRefresh = resolve; })
    : reply(signedIn({ access_token: 'access-b', refresh_token: 'refresh-b', user: { id: 'user-b' } })));
  const read = c.db.select('farms'); await turn();
  await c.auth.signIn('b@example.invalid', 'test-password');
  completeRefresh(reply({ message: 'Old token rejected' }, 400));
  await assert.rejects(read, { status: 400 });
  assert.equal(c.session().user.id, 'user-b');
});

test('a previous account response is not returned after another account signs in', async () => {
  const c = await client(); let completeRead;
  c.respond(({ url }) => url.includes('grant_type=password')
    ? reply(signedIn({ access_token: 'access-b', refresh_token: 'refresh-b', user: { id: 'user-b' } }))
    : new Promise((resolve) => { completeRead = resolve; }));
  const read = c.db.select('farms'); await turn();
  await c.auth.signIn('b@example.invalid', 'test-password');
  completeRead(reply([{ id: 'old-account-farm' }]));
  await assert.rejects(read, { status: 401, message: /sign-in changed/ });
  assert.equal(c.session().user.id, 'user-b');
});

test('blocked browser storage keeps sign-in usable in memory and sign-out still clears it', async () => {
  const c = await client({ stored: null });
  localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  localStorage.removeItem = () => { throw new Error('Storage blocked'); };
  await c.auth.signIn('a@example.invalid', 'test-password');
  assert.equal(c.session().user.id, 'user-a');
  assert.deepEqual(await c.db.select('farms'), []);
  await c.auth.signOut(); assert.equal(c.session(), null);
});

test('recovery redirects validate the new token before stale stored-session refresh and scrub the URL', async () => {
  const c = await client({ stored: signedIn({ expires_at: 1 }), deferInit: true });
  location.hash = '#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery&expires_in=3600';
  c.respond(({ headers }) => {
    assert.equal(headers.Authorization, 'Bearer recovery-access');
    return reply({ id: 'recovery-user', email: 'recovery@example.invalid' });
  });
  assert.deepEqual(await c.init(), { type: 'recovery' });
  assert.equal(c.session().user.id, 'recovery-user');
  assert.equal(c.session().access_token, 'recovery-access');
  assert.deepEqual(c.historyCalls, ['/farm/?keep=1']);
  assert.equal(location.hash, '');
  assert.equal(c.calls.filter((r) => r.url.includes('grant_type=refresh_token')).length, 0);
});

test('expired email-link errors scrub the URL and preserve an existing signed-in account', async () => {
  const c = await client({ deferInit: true });
  location.hash = '#error=access_denied&error_description=Email+link+expired';
  await assert.rejects(c.init(), { status: 400, message: 'Email link expired' });
  assert.equal(location.hash, ''); assert.equal(c.session().user.id, 'user-a');
});

test('reset emails return to the app path and password updates preserve the current token', async () => {
  const c = await client();
  c.respond(({ method }) => method === 'PUT' ? reply({ id: 'user-a', email: 'a@example.invalid' }) : reply({}));
  await c.auth.reset(' a@example.invalid ');
  const url = new URL(c.calls[0].url);
  assert.equal(url.searchParams.get('redirect_to'), 'https://fieldwork.example.invalid/farm/');
  assert.equal(JSON.parse(c.calls[0].body).email, 'a@example.invalid');
  await assert.rejects(c.auth.updatePassword('short'), { status: 400 });
  await c.auth.updatePassword('updated-password');
  assert.equal(c.calls.at(-1).method, 'PUT');
  assert.equal(c.session().access_token, 'access-a');
});

test('sign-up still reports email-confirmation status without creating a fake session', async () => {
  const c = await client({ stored: null }); c.respond(() => reply({ id: 'user-a' }));
  assert.deepEqual(await c.auth.signUp(' a@example.invalid ', 'test-password', 'Farm User'), { signedIn: false });
  assert.equal(c.session(), null);
});

test('missing public configuration is reported before any authenticated request', async () => {
  const c = await client({ config: { url: 'https://db.example.invalid' }, deferInit: true });
  await assert.rejects(c.init(), { message: /Supabase is not configured/ });
  assert.equal(c.calls.length, 1);
});

test('stalled configuration loading times out instead of leaving boot waiting forever', async () => {
  const c = await client({ deferInit: true });
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, delay) => realTimeout(fn, delay === 15000 ? 1 : delay);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  });
  try { await assert.rejects(c.init(), { status: 0, message: /load app settings.*Check your connection/ }); }
  finally { globalThis.setTimeout = realTimeout; }
  assert.ok(c.session());
});

test('magic-link sign-in never creates a new user and returns to the app path', async () => {
  const c = await client(); c.respond(() => reply({}));
  await c.auth.magicLink(' farmer@example.invalid ');
  const request = c.calls[0], url = new URL(request.url);
  assert.equal(request.method, 'POST'); assert.equal(url.pathname, '/auth/v1/otp');
  assert.equal(url.searchParams.get('redirect_to'), 'https://fieldwork.example.invalid/farm/');
  assert.deepEqual(JSON.parse(request.body), { email: 'farmer@example.invalid', create_user: false });
  assert.equal(c.session().user.id, 'user-a');
});

test('resending verification requests only signup confirmation and preserves sign-in', async () => {
  const c = await client(); c.respond(() => reply({}));
  await c.auth.resendVerification(' farmer@example.invalid ');
  const request = c.calls[0], url = new URL(request.url);
  assert.equal(request.method, 'POST'); assert.equal(url.pathname, '/auth/v1/resend');
  assert.equal(url.searchParams.get('redirect_to'), 'https://fieldwork.example.invalid/farm/');
  assert.deepEqual(JSON.parse(request.body), { email: 'farmer@example.invalid', type: 'signup' });
  assert.equal(c.session().access_token, 'access-a');
});

test('Google sign-in stores a tab-local verifier and sends its SHA-256 challenge only', async () => {
  const c = await client();
  await c.auth.google();
  const pending = JSON.parse(c.tabValues.get('fw-pkce')), url = new URL(c.assignments[0]);
  assert.match(pending.verifier, /^[A-Za-z0-9_-]{64}$/); assert.ok(Math.abs(Date.now() - pending.at) < 5000);
  assert.equal(url.origin, 'https://db.example.invalid'); assert.equal(url.pathname, '/auth/v1/authorize');
  assert.equal(url.searchParams.get('provider'), 'google'); assert.equal(url.searchParams.get('code_challenge_method'), 's256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('redirect_to'), 'https://fieldwork.example.invalid/farm/');
  assert.ok(!url.toString().includes(pending.verifier)); assert.equal(c.calls.length, 0);
  assert.equal(c.values.has('fw-pkce'), false); assert.equal(c.session().user.id, 'user-a');
});

test('Google sign-in explains blocked tab storage without navigating or deleting sign-in', async () => {
  const c = await client(); sessionStorage.setItem = () => { throw new Error('Storage blocked'); };
  await assert.rejects(c.auth.google(), /Allow browser storage/);
  assert.equal(c.assignments.length, 0); assert.equal(c.session().user.id, 'user-a');
});

test('PKCE redirects scrub the code before exchange and replace the session only after success', async () => {
  const c = await client({ deferInit: true, stored: signedIn({ expires_at: 1 }) });
  location.search = '?keep=1&code=returned-code'; location.hash = '#/overview';
  c.tabValues.set('fw-pkce', JSON.stringify({ verifier: 'sample-verifier-from-this-tab', at: Date.now() }));
  c.respond(({ url, method, body }) => {
    assert.equal(location.search, '?keep=1'); assert.equal(location.hash, '#/overview');
    assert.ok(!location.search.includes('returned-code'));
    assert.match(url, /grant_type=pkce$/); assert.equal(method, 'POST');
    assert.deepEqual(JSON.parse(body), { auth_code: 'returned-code', code_verifier: 'sample-verifier-from-this-tab' });
    return reply(signedIn({ access_token: 'oauth-access', refresh_token: 'oauth-refresh', user: { id: 'oauth-user' } }));
  });
  assert.deepEqual(await c.init(), { type: 'oauth' });
  assert.deepEqual(c.historyCalls, ['/farm/?keep=1#/overview']);
  assert.equal(c.tabValues.has('fw-pkce'), false); assert.equal(c.session().user.id, 'oauth-user');
  assert.equal(c.calls.filter((request) => request.url.includes('grant_type=refresh_token')).length, 0);
});

test('missing or stale PKCE proof is rejected without erasing an existing session', async () => {
  for (const pending of [null, { at: Date.now() }, { verifier: 'expired-verifier', at: Date.now() - 16 * 60 * 1000 }, { verifier: 'missing-timestamp' }]) {
    const c = await client({ deferInit: true }); location.search = '?code=untrusted-code&keep=1';
    if (pending) c.tabValues.set('fw-pkce', JSON.stringify(pending));
    c.respond(() => { throw new Error('Invalid proof must not reach the token endpoint.'); });
    await assert.rejects(c.init(), { status: 400, message: /expired|another browser/ });
    assert.equal(location.search, '?keep=1'); assert.equal(c.session().user.id, 'user-a');
    assert.equal(c.calls.filter((request) => request.url.includes('/auth/')).length, 0);
  }
});

test('RPCs use authenticated JSON POST and validate function names before sending', async () => {
  const c = await client(); c.respond(() => reply([{ user_id: 'member-one', role: 'worker' }]));
  const members = await c.db.rpc('fw_list_members', { p_workspace_id: 'workspace-a' });
  assert.equal(members[0].user_id, 'member-one'); const request = c.calls[0];
  assert.equal(request.method, 'POST'); assert.equal(new URL(request.url).pathname, '/rest/v1/rpc/fw_list_members');
  assert.equal(request.headers.Authorization, 'Bearer access-a');
  assert.deepEqual(JSON.parse(request.body), { p_workspace_id: 'workspace-a' });
  for (const name of ['', '../users', 'public.fn', 'fw_list_members?override=1']) assert.throws(() => c.db.rpc(name, {}), { status: 400 });
  assert.equal(c.calls.length, 1);
});

test('an earlier password sign-in cannot replace a newer account', async () => {
  const c=await client({stored:null});const replies=new Map();
  c.respond(({body})=>new Promise(resolve=>replies.set(JSON.parse(body).email,resolve)));
  const first=c.auth.signIn('first@example.invalid','dummy-password');
  const rejected=assert.rejects(first,{status:409,message:/newer sign-in/});
  const second=c.auth.signIn('second@example.invalid','dummy-password');await turn();
  replies.get('second@example.invalid')(reply(signedIn({user:{id:'user-second'}})));await second;
  replies.get('first@example.invalid')(reply(signedIn({user:{id:'user-first'}})));await rejected;
  assert.equal(c.session().user.id,'user-second');
});

test('a signup finishing after sign-out cannot restore an authenticated session', async () => {
  const c=await client();let complete;
  c.respond(({url})=>url.includes('/signup')?new Promise(resolve=>{complete=resolve;}):reply(null,204));
  const pending=c.auth.signUp('new@example.invalid','dummy-password','Sample');
  const rejected=assert.rejects(pending,{status:409});await turn();await c.auth.signOut();
  complete(reply(signedIn({user:{id:'user-new'}})));await rejected;
  assert.equal(c.session(),null);
});
