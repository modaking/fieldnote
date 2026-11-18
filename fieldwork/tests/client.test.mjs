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

async function client({ stored = signedIn(),sharedValues, deferInit = false, config = { url: 'https://db.example.invalid/', anonKey: 'public-test-key' } } = {}) {
  const values = sharedValues||new Map(stored ? [['fw-session', JSON.stringify(stored)]] : []);
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
    if (url.endsWith('/auth/v1/settings')) return reply({external:{google:true,email:true},disable_signup:false});
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

test('public sign-in capabilities share one pending request and cache only verified settings',async()=>{
  const c=await client();let finish;c.respond(()=>new Promise(resolve=>{finish=resolve;}));
  const first=c.auth.capabilities(),second=c.auth.capabilities();await turn();assert.equal(c.calls.length,1);
  assert.equal(c.calls[0].headers.Authorization,undefined);assert.equal(c.calls[0].headers.apikey,'public-test-key');
  finish(reply({external:{google:false,email:true},disable_signup:true}));
  assert.deepEqual(await first,{google:false,email:true,signup:false});assert.deepEqual(await second,await first);await c.auth.capabilities();assert.equal(c.calls.length,1);
  c.respond(()=>reply({external:{google:true,email:true}}));assert.equal((await c.auth.capabilities({refresh:true})).google,true);assert.equal(c.calls.length,2);
});

test('disabled Google never stores a verifier or leaves the app',async()=>{
  const c=await client();c.respond(()=>reply({external:{google:false,email:true}}));
  await assert.rejects(c.auth.google(),{status:400,message:/not enabled/});
  assert.equal(c.assignments.length,0);assert.equal(c.tabValues.has('fw-pkce'),false);assert.ok(c.session());assert.ok(c.calls.every(call=>call.method==='GET'));
});

test('failed or malformed provider discovery is retryable and never treated as enabled',async()=>{
  const c=await client();c.respond(()=>reply({message:'Settings unavailable'},503));
  await assert.rejects(c.auth.google(),{status:503});assert.equal(c.assignments.length,0);
  c.respond(()=>reply([]));await assert.rejects(c.auth.capabilities(),/could not be verified/);
  c.respond(()=>reply({external:{google:true,email:true}}));assert.equal((await c.auth.capabilities()).google,true);assert.equal(c.calls.length,3);
});

test('a sign-out during provider discovery prevents a delayed Google redirect',async()=>{
  const c=await client();let finish;c.respond(({url})=>url.endsWith('/settings')?new Promise(resolve=>{finish=resolve;}):reply(null,204));
  const pending=c.auth.google();await turn();await c.auth.signOut();finish(reply({external:{google:true}}));
  await assert.rejects(pending,{status:409});assert.equal(c.assignments.length,0);assert.equal(c.tabValues.has('fw-pkce'),false);
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
  assert.equal(c.auth.recoveryPending().invitation,false,'an old implicit link cannot claim invitation recovery');
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

test('sign-up with an immediate authenticated response saves its valid session without requiring another sign-in',async()=>{
  const c=await client({stored:null}),next=signedIn({access_token:'signup-access',refresh_token:'signup-refresh'});c.respond(()=>reply(next));
  assert.deepEqual(await c.auth.signUp(' a@example.invalid ','test-password','Farm User'),{signedIn:true});
  assert.equal(c.session().user.id,'user-a');assert.equal(c.session().access_token,'signup-access');assert.equal(c.session().refresh_token,'signup-refresh');
  assert.equal(JSON.parse(c.values.get('fw-session')).user.id,'user-a');assert.equal(c.calls.length,1);assert.equal(new URL(c.calls[0].url).pathname,'/auth/v1/signup');
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
  const payload=JSON.parse(request.body),proof=JSON.parse(c.values.get('fw-email-pkce'));
  assert.equal(payload.email,'farmer@example.invalid');assert.equal(payload.create_user,false);assert.equal(payload.code_challenge_method,'s256');assert.equal(payload.code_challenge,createHash('sha256').update(proof.verifier).digest('base64url'));assert.equal(proof.type,'magiclink');
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
  assert.ok(!url.toString().includes(pending.verifier)); assert.equal(c.calls.length, 1);assert.ok(c.calls[0].url.endsWith('/auth/v1/settings'));assert.equal(c.calls[0].body,undefined);
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

test('invitation recovery sends PKCE only and restores reset purpose, account and invitation intent on callback',async()=>{
  const c=await client();c.tabValues.set('fw-invite','a'.repeat(64));location.hash='#/account?section=invitations';c.respond(()=>reply({}));
  await c.auth.reset(' a@example.invalid ',{invitation:true});const pending=JSON.parse(c.values.get('fw-email-pkce')),sent=JSON.parse(c.calls[0].body);
  assert.equal(sent.code_challenge_method,'s256');assert.equal(sent.code_challenge,createHash('sha256').update(pending.verifier).digest('base64url'));assert.equal(sent.code_verifier,undefined);assert.equal(pending.expectedUserId,'user-a');
  location.search='?code=recovery-code';location.hash='';c.respond(({body})=>{assert.deepEqual(JSON.parse(body),{auth_code:'recovery-code',code_verifier:pending.verifier});return reply(signedIn());});
  assert.deepEqual(await c.auth.consumeRedirect(),{type:'recovery'});assert.equal(location.search,'');assert.equal(location.hash,'#/account?section=invitations');assert.equal(c.tabValues.get('fw-invite'),'a'.repeat(64));assert.equal(c.auth.recoveryPending().invitation,true);
  c.auth.markRecoveryPasswordSaved();assert.equal(c.auth.recoveryPending().passwordSaved,true);c.auth.finishRecovery();assert.equal(c.auth.recoveryPending(),null);
});

test('invitation magic-link callback preserves intent without invoking password rotation',async()=>{
  const c=await client();c.respond(()=>reply({}));await c.auth.magicLink('a@example.invalid',{invitation:true,returnTo:'#/account?section=invitations'});
  location.search='?code=mailbox-proof';c.respond(()=>reply(signedIn()));assert.deepEqual(await c.auth.consumeRedirect(),{type:'magiclink'});assert.equal(c.auth.recoveryPending(),null);assert.equal(location.hash,'#/account?section=invitations');assert.ok(!c.calls.some(call=>call.method==='PUT'));
});

test('invited email callbacks reject another identity without replacing the current sign-in',async()=>{
  const c=await client();c.respond(()=>reply({}));await c.auth.reset('a@example.invalid',{invitation:true});location.search='?code=wrong-user';
  c.respond(()=>reply(signedIn({user:{id:'another-user',email:'a@example.invalid'}})));await assert.rejects(c.auth.consumeRedirect(),{status:401,message:/different account/});assert.equal(c.session().user.id,'user-a');assert.equal(location.search,'');assert.equal(c.auth.recoveryPending(),null);
});

test('invitation authority always comes from the checked server result, never token metadata or callback purpose',async()=>{
  const c=await client({stored:signedIn({user:{id:'user-a',app_metadata:{fieldnote_mailbox_verified_at:'forged'},user_metadata:{verified:true}}})});
  c.respond(()=>reply({needs_recovery:true,proof_recent:false}));assert.deepEqual(await c.auth.invitationVerification(),{needs_recovery:true,proof_recent:false});
  c.respond(()=>reply({message:'Fresh signed recovery proof required'},403));await assert.rejects(c.auth.completeInviteRecovery(),{status:403});
  c.respond(()=>reply({}));await assert.rejects(c.auth.invitationVerification(),/unavailable/);c.respond(()=>reply({message:'No function'},404));await assert.rejects(c.auth.invitationVerification(),/reviewed security upgrade/);
});

test('blocked shared PKCE storage prevents sending an email and keeps an existing invitation untouched',async()=>{
  const c=await client();c.tabValues.set('fw-invite','b'.repeat(64));localStorage.setItem=()=>{throw new Error('Blocked');};
  await assert.rejects(c.auth.reset('a@example.invalid',{invitation:true}),/same browser/);assert.equal(c.calls.length,0);assert.equal(c.tabValues.get('fw-invite'),'b'.repeat(64));
});

test('a fresh email tab consumes the shared proof once and restores invitation intent without a URL secret',async()=>{
  const first=await client();first.tabValues.set('fw-invite','f'.repeat(64));first.respond(()=>reply({}));await first.auth.reset('a@example.invalid',{invitation:true,returnTo:'#/account?section=invitations'});
  const binding=JSON.parse(first.values.get('fw-email-pkce'));assert.equal(binding.inviteToken,'f'.repeat(64));assert.ok(!new URL(first.calls[0].url).search.includes('f'.repeat(64)));
  const fresh=await client({sharedValues:first.values,deferInit:true});assert.equal(fresh.tabValues.has('fw-invite'),false);location.search='?code=from-email';
  fresh.respond(({body})=>{assert.equal(JSON.parse(body).code_verifier,binding.verifier);return reply(signedIn());});assert.deepEqual(await fresh.init(),{type:'recovery'});
  assert.equal(fresh.values.has('fw-email-pkce'),false);assert.equal(fresh.tabValues.get('fw-invite'),'f'.repeat(64));assert.equal(fresh.auth.takeInviteIntent(),'f'.repeat(64));assert.equal(fresh.auth.takeInviteIntent(),'');assert.equal(location.hash,'#/account?section=invitations');
  location.search='?code=from-email';const before=fresh.calls.length;await assert.rejects(fresh.auth.consumeRedirect(),/expired|another browser/);assert.equal(fresh.calls.length,before,'reused callback never exchanges without proof');
});

test('expired shared email proof is cleared and mismatched email never replaces the signed-in user',async()=>{
  const c=await client();c.respond(()=>reply({}));await c.auth.magicLink('a@example.invalid',{invitation:true});const binding=JSON.parse(c.values.get('fw-email-pkce'));c.values.set('fw-email-pkce',JSON.stringify({...binding,at:Date.now()-901000}));
  location.search='?code=expired';await assert.rejects(c.auth.consumeRedirect(),/expired|another browser/);assert.equal(c.values.has('fw-email-pkce'),false);
  c.respond(()=>reply({}));await c.auth.magicLink('a@example.invalid',{invitation:true});location.search='?code=wrong-email';c.respond(()=>reply(signedIn({user:{id:'user-a',email:'someone@example.invalid'}})));await assert.rejects(c.auth.consumeRedirect(),/another account/);assert.equal(c.session().user.email,'a@example.invalid');
});

test('an older callback cannot commit over or consume a newer email-link request',async()=>{
  const c=await client();c.respond(()=>reply({}));await c.auth.magicLink('a@example.invalid',{invitation:true});const old=JSON.parse(c.values.get('fw-email-pkce'));location.search='?code=old-code';let finish;
  c.respond(({url})=>url.includes('grant_type=pkce')?new Promise(resolve=>finish=resolve):reply({}));const oldCallback=c.auth.consumeRedirect();await turn();await c.auth.magicLink('a@example.invalid',{invitation:true});const latest=JSON.parse(c.values.get('fw-email-pkce'));assert.notEqual(latest.verifier,old.verifier);
  finish(reply(signedIn({access_token:'old-callback-access'})));await assert.rejects(oldCallback,{status:409});assert.equal(JSON.parse(c.values.get('fw-email-pkce')).verifier,latest.verifier);assert.equal(c.session().access_token,'access-a');
  location.search='?code=old-code-again';c.respond(()=>reply({message:'Invalid code verifier'},400));await assert.rejects(c.auth.consumeRedirect(),{status:400});assert.equal(JSON.parse(c.values.get('fw-email-pkce')).verifier,latest.verifier,'failed old email does not erase the latest proof');
  location.search='?code=latest-code';c.respond(({body})=>{assert.equal(JSON.parse(body).code_verifier,latest.verifier);return reply(signedIn({access_token:'latest-access'}));});assert.deepEqual(await c.auth.consumeRedirect(),{type:'magiclink'});assert.equal(c.session().access_token,'latest-access');assert.equal(c.values.has('fw-email-pkce'),false);
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

test('TABLE RPC pagination stays in the URL while POST arguments and scalar RPC URLs remain unchanged',async()=>{
  const c=await client();c.respond(()=>reply([{user_id:'member'}]));const args={p_workspace_id:'workspace-a'};
  await c.db.rpc('fw_list_members',args,'order=created_at.asc,user_id.asc&limit=1000&offset=333');const request=c.calls[0],url=new URL(request.url);
  assert.equal(request.method,'POST');assert.equal(url.pathname,'/rest/v1/rpc/fw_list_members');assert.equal(url.searchParams.get('offset'),'333');assert.equal(url.searchParams.get('order'),'created_at.asc,user_id.asc');assert.deepEqual(JSON.parse(request.body),args);
  await c.db.rpc('fw_dashboard',args);assert.equal(new URL(c.calls[1].url).search,'');assert.throws(()=>c.db.rpc('fw_list_members',args,{}),{status:400});assert.equal(c.calls.length,2);
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
