import { init, session, auth, db } from './supabase.js';
import { getPref, setPref } from './theme.js';
import * as M from './modules.js';
import { loadDemo } from './seed.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = {
  overview: 'M3 11l9-8 9 8M5 10v10h14V10', daily: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  finances: 'M3 17l6-6 4 4 8-8M15 7h6v6', vendors: 'M4 9h16l-1-5H5zM5 9v11h14V9M10 20v-6h4v6',
  infrastructure: 'M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6', livestock: 'M12 21v-9M12 12c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z',
  workers: 'M16 20v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6M20 20v-2a3 3 0 00-2-3M16 4a3 3 0 010 6',
  funding: 'M12 3v18M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H7', plus: 'M12 5v14M5 12h14', menu: 'M4 6h16M4 12h16M4 18h16',
  light: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8',
  dark: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z', system: 'M3 5h18v11H3zM8 20h8M12 16v4',
};
const I = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const MODULES = [
  ['overview', 'Overview', ''], ['daily', 'Daily operations', 'Daily, monthly and one-time tasks, plus reusable checklists.'],
  ['finances', 'Monthly finances', 'Income, expenses, budgets and your transaction register.'], ['vendors', 'Vendors', 'Your suppliers, plus the KEPHIS seed merchant list.'],
  ['infrastructure', 'Infrastructure', 'Projects with status, cost and dates.'], ['livestock', 'Livestock & crops', 'Records for each enterprise on your farms.'],
  ['workers', 'Workers', 'Roles and pay. Pay posts to finances automatically.'], ['funding', 'Funding', 'Track opportunities from eligibility to award.'],
];
const COUNTIES = 'Baringo,Bomet,Bungoma,Busia,Elgeyo-Marakwet,Embu,Garissa,Homa Bay,Isiolo,Kajiado,Kakamega,Kericho,Kiambu,Kilifi,Kirinyaga,Kisii,Kisumu,Kitui,Kwale,Laikipia,Lamu,Machakos,Makueni,Mandera,Marsabit,Meru,Migori,Mombasa,Murang’a,Nairobi,Nakuru,Nandi,Narok,Nyamira,Nyandarua,Nyeri,Samburu,Siaya,Taita-Taveta,Tana River,Tharaka-Nithi,Trans Nzoia,Turkana,Uasin Gishu,Vihiga,Wajir,West Pokot'.split(',');

const readSetting = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSetting = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
// The existing schema has Kenyan farms and no per-workspace timezone column.
const today = () => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (key) => parts.find((p) => p.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};
const savedMonth = readSetting('fw-month');
const S = { profile: null, ws: null, role: null, memberships: [], farms: [], farmId: 'all',
  month: /^\d{4}-(0[1-9]|1[0-2])$/.test(savedMonth || '') ? savedMonth : today().slice(0, 7), route: 'overview' };
const canWrite = () => S.role === 'owner' || S.role === 'manager';
const app = $('#app');

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 3500); }
const brand = () => `<span class="brand">${I('livestock')}fieldwork.</span>`;
const money = (minor, cur = S.ws.currency) => {
  const f = new Intl.NumberFormat('en-KE', { style: 'currency', currency: cur });
  return f.format(minor / 10 ** f.resolvedOptions().maximumFractionDigits);
};
const monthRange = () => { const [y, m] = S.month.split('-').map(Number); const n = new Date(y, m, 1);
  return [`${S.month}-01`, `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`]; };
const monthLabel = () => new Date(`${S.month}-01T00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

/* ───── boot ───── */
async function boot() {
  try { const redirect = await init(); if (redirect?.type === 'recovery') return renderResetPassword(); }
  catch (e) { return renderLoadError('Couldn’t start fieldwork.', e); }
  if (!session()) return renderAuth();
  try { await load(); } catch (e) { if (!session()) return renderAuth(); renderLoadError('Couldn’t load your data', e); }
}
function renderLoadError(title, error) {
  app.innerHTML = `<div class="center"><main class="panel" id="view" tabindex="-1"><h1>${esc(title)}</h1><p class="err" role="alert">${esc(error.message)}</p><div class="actions"><button class="btn ghost" id="retry-out">Sign out</button><button class="btn" id="retry">Try again</button></div></main></div>`;
  $('#retry').onclick = boot;
  $('#retry-out').onclick = async () => { await auth.signOut(); renderAuth(); };
}
async function load() {
  const uid = session().user.id;
  const profile = (await db.select('profiles', `id=eq.${uid}`))[0] || { id: uid };
  const mem = await db.select('workspace_members', `user_id=eq.${uid}&select=role,workspaces(id,name,currency)`);
  const memberships = mem.filter((m) => m.workspaces);
  if (!memberships.length) { S.profile = profile; return renderCreateWs(); }
  const pick = memberships.find((m) => m.workspaces.id === profile.active_workspace) || memberships[0];
  const farms = await db.select('farms', `workspace_id=eq.${pick.workspaces.id}&order=created_at`);
  if (session()?.user.id !== uid) return;
  Object.assign(S, { profile, memberships, ws: pick.workspaces, role: pick.role, farms });
  const savedFarm = readSetting(`fw-farm:${uid}:${S.ws.id}`);
  S.farmId = farms.some((f) => f.id === savedFarm) ? savedFarm : 'all';
  if (profile.theme_pref && profile.theme_pref !== getPref()) setPref(profile.theme_pref);
  renderShell();
}

/* ───── auth + workspace ───── */
function renderAuth(mode = 'in') {
  window.onhashchange = null;
  const up = mode === 'up';
  app.innerHTML = `<div class="center"><form class="panel" id="auth">${brand()}
    <h1>${up ? 'Create your account' : 'Welcome back'}</h1><p class="muted">Run every farm from one calm place.</p>
    <div class="tabs" role="tablist"><button type="button" class="tab" role="tab" data-mode="in" aria-selected="${!up}">Sign in</button><button type="button" class="tab" role="tab" data-mode="up" aria-selected="${up}">Create account</button></div>
    ${up ? '<label class="field">Your name<input name="name" required autocomplete="name"></label>' : ''}
    <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="field">Password<input name="password" type="password" required ${up ? 'minlength="8"' : ''} autocomplete="${up ? 'new-password' : 'current-password'}"></label>
    <p class="err" id="msg" role="alert"></p>
    <button class="btn" style="width:100%;justify-content:center">${up ? 'Create account' : 'Sign in'}</button>
    ${up ? '' : '<p style="text-align:center"><a href="#" id="forgot">Forgot your password?</a></p>'}</form></div>`;
  $('#auth').onclick = (e) => { const m = e.target.dataset?.mode; if (m) renderAuth(m); };
  $('#forgot')?.addEventListener('click', async (e) => { e.preventDefault(); const em = $('#auth [name=email]').value;
    if (!em) return ($('#msg').textContent = 'Enter your email above first.');
    if (!$('#auth [name=email]').reportValidity()) return;
    const link = e.currentTarget; if (link.getAttribute('aria-disabled') === 'true') return; link.setAttribute('aria-disabled', 'true');
    try { await auth.reset(em.trim()); $('#msg').textContent = 'Check your email for a reset link.'; } catch (x) { $('#msg').textContent = x.message; }
    finally { link.removeAttribute('aria-disabled'); } });
  $('#auth').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target), msg = $('#msg'); msg.textContent = '';
    const btn = e.target.querySelector('button:not([type=button])'); if (btn.disabled) return;
    if (up && !f.get('name').trim()) { msg.textContent = 'Enter your name.'; return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      if (up) { const r = await auth.signUp(f.get('email').trim(), f.get('password'), f.get('name').trim()); if (!r.signedIn) return (msg.textContent = 'Account created. Confirm your email, then sign in.'); }
      else await auth.signIn(f.get('email').trim(), f.get('password'));
      await load();
    } catch (x) { msg.textContent = x.message; }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); } };
}

function renderResetPassword() {
  window.onhashchange = null;
  app.innerHTML = `<div class="center"><form class="panel" id="reset">${brand()}<h1>Choose a new password</h1><p class="muted">Enter and confirm your new password to finish resetting your account.</p><label class="field">New password<input type="password" name="password" required minlength="8" autocomplete="new-password"></label><label class="field">Confirm new password<input type="password" name="confirm" required minlength="8" autocomplete="new-password"></label><p class="err" id="msg" role="alert"></p><button class="btn">Save new password</button></form></div>`;
  $('#reset').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target), btn = e.target.querySelector('button'), msg = $('#msg');
    if (btn.disabled) return;
    if (f.get('password') !== f.get('confirm')) { msg.textContent = 'The two passwords don’t match.'; return; }
    msg.textContent = ''; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try { await auth.updatePassword(f.get('password')); toast('Password updated'); await load(); }
    catch (error) { msg.textContent = error.message; }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  };
}

async function renderCreateWs() {
  window.onhashchange = null;
  let created = null, uncertain = false;
  const draftId = crypto.randomUUID();
  let cur = [{ code: 'KES', name: 'Kenyan shilling' }];
  try { cur = await db.select('currencies', 'order=code'); } catch {}
  app.innerHTML = `<div class="center"><form class="panel" id="ws">${brand()}<h1>Name your workspace</h1>
    <p class="muted">A workspace holds all your farms. You can add them next.</p>
    <label class="field">Workspace name<input name="name" required placeholder="e.g. Kamau Family Farms"></label>
    <label class="field">Base currency<select name="currency">${cur.map((c) => `<option value="${c.code}" ${c.code === 'KES' ? 'selected' : ''}>${c.code} · ${esc(c.name)}</option>`).join('')}</select></label>
    <p class="muted" style="font-size:var(--fs-sm)">Reports total in this currency. It can’t change once you record transactions.</p>
    <p class="err" id="msg" role="alert"></p><button class="btn">Create workspace</button>
    <button type="button" class="btn ghost" id="out" style="margin-left:var(--sp-2)">Sign out</button></form></div>`;
  $('#out').onclick = async () => { await auth.signOut(); renderAuth(); };
  $('#ws').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target);
    const btn = e.target.querySelector('button:not([type=button])'); if (btn.disabled) return;
    if (!f.get('name').trim()) { $('#msg').textContent = 'Enter a workspace name.'; return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); $('#msg').textContent = '';
    try {
      if (!created && uncertain) created = (await db.select('workspaces', `id=eq.${draftId}&created_by=eq.${session().user.id}`))[0] || null;
      if (!created) {
        try { created = await db.insert('workspaces', { id: draftId, name: f.get('name').trim(), currency: f.get('currency'), created_by: session().user.id }); }
        catch (error) { if (error.status === 0) uncertain = true; throw error; }
      }
      await db.update('profiles', session().user.id, { active_workspace: created.id });
      await load();
    } catch (x) { $('#msg').textContent = x.message; }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); } };
}

/* ───── shell ───── */
function renderShell() {
  const pref = getPref(), initial = (S.profile?.full_name || session().user.email || '?')[0].toUpperCase();
  app.innerHTML = `<div class="shell"><aside class="side" id="side" aria-label="Farm navigation"><div class="side-head">${brand()}<button class="icon-btn side-close" id="close-menu" aria-label="Close menu">×</button></div>
      <nav class="nav" aria-label="Modules">${MODULES.map(([id, l]) => `<a href="#/${id}" data-id="${id}">${I(id)}${l}</a>`).join('')}</nav></aside>
    <div class="scrim" id="scrim"></div>
    <div class="main-column"><header class="top"><button class="icon-btn menu-btn" id="menu" aria-label="Open menu" aria-controls="side" aria-expanded="false">${I('menu')}</button>
        <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav><span class="grow"></span>
        <button class="icon-btn" id="theme" aria-label="Theme: ${pref}. Click to change" title="Theme: ${pref}">${I(pref)}</button>
        <button class="avatar" id="avatar" aria-label="Account menu" aria-haspopup="true">${esc(initial)}</button></header>
      <div id="pop"></div><div class="bar" id="bar"></div><main id="view" tabindex="-1"></main></div></div>
    <dialog id="dlg"></dialog>`;
  $('#menu').onclick = () => toggleSide(true); $('#scrim').onclick = () => toggleSide(false); $('#close-menu').onclick = () => toggleSide(false);
  $('#theme').onclick = () => { const next = { light: 'dark', dark: 'system', system: 'light' }[getPref()];
    setPref(next, (p) => db.update('profiles', session().user.id, { theme_pref: p }));
    $('#theme').innerHTML = I(next); $('#theme').title = `Theme: ${next}`; $('#theme').setAttribute('aria-label', `Theme: ${next}. Click to change`); toast(`Theme: ${next}`); };
  $('#avatar').onclick = () => { if (!session()) return renderAuth(); const p = $('#pop');
    p.innerHTML = p.innerHTML ? '' : `<div class="pop"><div><b>${esc(S.profile?.full_name || 'You')}</b><br><span class="muted">${esc(session().user.email)}</span><br><span class="badge">${S.role}</span></div>
      <div class="muted">${esc(S.ws.name)} · ${S.ws.currency}</div>
      ${S.memberships.length > 1 ? `<label class="field">Workspace<select id="workspace-switch">${S.memberships.map((m) => `<option value="${esc(m.workspaces.id)}" ${m.workspaces.id === S.ws.id ? 'selected' : ''}>${esc(m.workspaces.name)}</option>`).join('')}</select></label>` : ''}
      <button class="btn ghost" id="signout">Sign out</button></div>`;
    $('#workspace-switch')?.addEventListener('change', async (e) => {
      const select = e.target, id = select.value;
      if (select.disabled || !S.memberships.some((m) => m.workspaces.id === id)) return;
      select.disabled = true;
      try { await db.update('profiles', session().user.id, { active_workspace: id }); await load(); }
      catch (error) { select.value = S.ws.id; select.disabled = false; toast(error.message); }
    });
    $('#signout')?.addEventListener('click', async () => { await auth.signOut(); location.reload(); }); };
  window.onhashchange = route;
  route();
}
const narrow = matchMedia('(max-width: 900px)');
const toggleSide = (o) => {
  const side = $('#side'); if (!side) return;
  side.classList.toggle('open', o); side.inert = narrow.matches && !o;
  $('#scrim').classList.toggle('open', o); $('#menu').setAttribute('aria-expanded', String(o));
  if (o) $('#close-menu').focus();
};
narrow.addEventListener('change', () => toggleSide(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#side')?.classList.contains('open')) { toggleSide(false); $('#menu').focus(); }
});
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  const main = $('#view') || document.querySelector('#app form'); if (main) { e.preventDefault(); main.tabIndex = -1; main.focus(); }
});

function route() {
  if (!session()) return renderAuth();
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  S.route = MODULES.some((m) => m[0] === id) ? id : 'overview';
  $('#dlg')?.close(); if ($('#dlg')) $('#dlg').onclick = null;
  document.title = `${MODULES.find((m) => m[0] === S.route)[1]} · fieldwork.`;
  toggleSide(false); renderBar(); renderView();
}
function renderBar() {
  const mod = MODULES.find((m) => m[0] === S.route);
  $('#crumbs').innerHTML = `<span>${esc(S.ws.name)}</span><span>/</span><b>${mod[1]}</b>`;
  document.querySelectorAll('.nav a').forEach((a) => (a.dataset.id === S.route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('#bar').innerHTML = `<div class="farmtabs" role="tablist" aria-label="Farm">
      <button role="tab" data-farm="all" aria-selected="${S.farmId === 'all'}">All farms</button>
      ${S.farms.map((f) => `<button role="tab" data-farm="${f.id}" aria-selected="${S.farmId === f.id}">${esc(f.name)}</button>`).join('')}</div>
    <label class="muted" style="display:flex;align-items:center;gap:var(--sp-2)">Month <input class="month" type="month" id="month" value="${S.month}" aria-label="Month: ${monthLabel()}"></label>`;
  $('#bar').onclick = (e) => { const id = e.target.closest('[data-farm]')?.dataset.farm; if (!id) return; S.farmId = id; writeSetting(`fw-farm:${session().user.id}:${S.ws.id}`, id); renderBar(); renderView(); };
  $('#month').onchange = (e) => { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) return; S.month = e.target.value; writeSetting('fw-month', S.month); renderView(); };
}

/* ───── views ───── */
const empty = (icon, title, text, action = '') => `<div class="empty">${I(icon)}<h2>${title}</h2><p>${text}</p>${action}</div>`;
async function renderView() {
  if (!session()) return renderAuth();
  const v = document.createElement('main'), mod = MODULES.find((m) => m[0] === S.route);
  v.id = 'view'; v.tabIndex = -1; $('#view').replaceWith(v); v.focus({ preventScroll: true });
  const addRequested = new URLSearchParams(location.hash.split('?')[1] || '').get('add') === '1';
  const X = { S, db, esc, I, toast, money, monthRange, monthLabel, canWrite, today, addRequested,
    consumeAdd: () => history.replaceState(null, '', location.pathname + location.search + `#/${S.route}`), uid: () => session().user.id, dlg: () => $('#dlg') };
  if (M[S.route]) { v.innerHTML = ''; try { await M[S.route](v, X); } catch (e) { if (!session()) return renderAuth(); v.innerHTML = `<p class="err" role="alert">${esc(e.message)}</p>`; } return; }
  if (S.route !== 'overview') {
    v.innerHTML = `<div class="head"><h1>${mod[1]}</h1></div>` + empty(mod[0], 'Coming in the next stage', `${mod[2]} This module is part of stage 2.`); return; }
  v.innerHTML = `<div class="head"><h1>Overview</h1>${canWrite() ? `<button class="btn" id="addrec">${I('plus')}Add a record</button>` : ''}</div><div id="kpis" class="grid"></div>
    <div class="head"><h2>Farms</h2></div><div id="farms"></div>`;
  $('#addrec')?.addEventListener('click', openAddRecord);
  if (S.route === 'overview' && !S.farms.length) v.insertAdjacentHTML('afterbegin', `<p class="banner">Start by adding your farm. Then record tasks, purchases and payments in the sections on the left.</p>`);
  renderFarms(); renderKpis();
}
function renderFarms() {
  const el = $('#farms'); if (!el) return;
  el.innerHTML = S.farms.length ? `<div class="grid">${S.farms.map((f) => `<article class="card farm"><h3>${esc(f.name)}</h3>
      <p class="muted">${esc([f.county && f.county + ' County', f.location_text].filter(Boolean).join(' · ') || 'No location yet')}</p>
      <div class="row"><button class="btn sm ghost" data-open="${f.id}">View</button>
      ${canWrite() ? `<button class="btn sm ghost" data-edit="${f.id}">Edit</button><button class="btn sm ghost" data-del="${f.id}">Delete</button>` : ''}</div></article>`).join('')}</div>`
    : empty('overview', 'Add your first farm', 'Farms hold your tasks, money, workers and records.', canWrite() ? `<p><button class="btn" data-edit="new">${I('plus')}Add farm</button> <button class="btn ghost" data-seed="1">Load demo data</button></p>` : '<p>Ask the workspace owner to add a farm.</p>');
  el.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.seed) { if (b.disabled) return; if (S.ws.currency !== 'KES') return toast('The sample data uses Kenyan shillings. Use a KES workspace for the demo.'); if (!confirm('Add fictional sample records to this workspace? Use a separate workspace to keep them apart from your real farm records.')) return;
      b.disabled = true; b.textContent = 'Loading demo…'; try { await loadDemo({ S, db }); toast('Demo data loaded'); await load(); } catch (x) { toast(x.message); b.disabled = false; b.textContent = 'Load demo data'; } return; }
    if (d.open) { S.farmId = d.open; writeSetting(`fw-farm:${session().user.id}:${S.ws.id}`, d.open); renderBar(); renderView(); toast('Showing this farm'); }
    if (d.edit) openFarm(S.farms.find((f) => f.id === d.edit));
    if (d.del && confirm('Delete this farm and everything recorded against it? This can’t be undone.')) {
      try { await db.remove('farms', d.del); S.farms = S.farms.filter((f) => f.id !== d.del); if (S.farmId === d.del) S.farmId = 'all'; renderBar(); renderFarms(); renderKpis(); toast('Farm deleted'); } catch (x) { toast(x.message); } } };
}
async function renderKpis() {
  const el = $('#kpis'); if (!el) return; const [a, b] = monthRange(), fq = S.farmId === 'all' ? '' : `&farm_id=eq.${S.farmId}`;
  let inc = 0, exp = 0, open = 0;
  try {
    const [t, k] = await Promise.all([db.select('transactions', `workspace_id=eq.${S.ws.id}&select=kind,amount_base&txn_date=gte.${a}&txn_date=lt.${b}${fq}`), db.select('tasks', `workspace_id=eq.${S.ws.id}&select=id,status,cadence,done_at${fq}`)]);
    if (!el.isConnected) return;
    t.forEach((r) => (r.kind === 'income' ? (inc += Number(r.amount_base)) : (exp += Number(r.amount_base))));
    open = k.filter((r) => (M.taskStatus ? M.taskStatus(r, today()) : r.status) === 'open').length;
  } catch (x) { if (el.isConnected) el.innerHTML = `<p class="err" role="alert">Figures couldn’t load. ${esc(x.message)}</p>`; return; }
  const net = inc - exp;
  el.innerHTML = [['Income', money(inc), 'pos'], ['Expenses', money(exp), ''], ['Net cash flow', money(net), net < 0 ? 'neg' : net > 0 ? 'pos' : ''], ['Open tasks', open, '']]
    .map(([l, v, c]) => `<div class="card"><span class="muted">${l} · ${monthLabel()}</span><div class="kpi ${c}">${v}</div></div>`).join('');
}

/* ───── dialogs ───── */
function openAddRecord() {
  if (!canWrite()) return;
  const d = $('#dlg'), choices = [['daily','Task'],['finances','Transaction'],['vendors','Vendor'],['workers','Worker'],['infrastructure','Project'],['livestock','Livestock or crop record'],['funding','Funding opportunity']];
  d.innerHTML = `<h2>Add a record</h2>${!S.farms.length ? '<p class="muted">Add your first farm to start recording its work and money.</p>' : ''}<div class="picker" style="margin-top:var(--sp-4)"><button class="btn" data-k="farm">Farm</button>
    ${choices.map(([id,l]) => `<button class="btn" data-k="${id}" ${!S.farms.length ? 'disabled' : ''}>${l}</button>`).join('')}</div>
    <div class="actions"><button class="btn ghost" value="x">Close</button></div>`;
  d.onclick = (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k === 'farm') openFarm(); else if (choices.some(([id]) => id === k)) { d.close(); location.hash = `/${k}?add=1`; } if (e.target.value === 'x') d.close(); };
  d.showModal();
}
function openFarm(farm) {
  if (!canWrite()) return;
  const d = $('#dlg'), f = farm || {};
  d.onclick = null; const workspaceId = S.ws.id, draftId = farm?.id || crypto.randomUUID();
  let exists = Boolean(farm), uncertain = false;
  d.innerHTML = `<form id="farmf"><h2>${farm ? 'Edit farm' : 'Add farm'}</h2>
    <label class="field" style="margin-top:var(--sp-4)">Farm name<input name="name" required value="${esc(f.name)}" placeholder="e.g. Ol Kalou"></label>
    <label class="field">County<input name="county" list="counties" value="${esc(f.county)}" placeholder="Start typing…"></label>
    <datalist id="counties">${COUNTIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="field">Location notes<input name="location_text" value="${esc(f.location_text)}" placeholder="Town, road or landmark"></label>
    <p class="muted" style="font-size:var(--fs-sm)">Add a nearby town or landmark so your team can identify this farm.</p><p class="err" id="fmsg" role="alert"></p>
    <div class="actions"><button type="button" class="btn ghost" id="cancel">Cancel</button><button class="btn">Save farm</button></div></form>`;
  $('#cancel').onclick = () => d.close();
  $('#farmf').onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector('button:not([type=button])'); if (btn.disabled) return;
    const row = { name: v.name.trim(), county: v.county.trim() || null, location_text: v.location_text.trim() || null };
    if (!row.name) { $('#fmsg').textContent = 'Enter a farm name.'; return; }
    if (!canWrite() || workspaceId !== S.ws.id) { $('#fmsg').textContent = 'Your workspace changed. Reopen this form and try again.'; return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      if (!exists && uncertain) exists = Boolean((await db.select('farms', `id=eq.${draftId}&workspace_id=eq.${workspaceId}`))[0]);
      let saved;
      if (exists) saved = await db.update('farms', draftId, row);
      else {
        try { saved = await db.insert('farms', { ...row, id: draftId, workspace_id: workspaceId }); }
        catch (error) { if (error.status === 0) uncertain = true; throw error; }
      }
      exists = true;
      S.farms = S.farms.some((x) => x.id === draftId) ? S.farms.map((x) => x.id === draftId ? saved : x) : [...S.farms, saved];
      d.close(); renderBar(); renderFarms(); toast(farm ? 'Farm updated' : 'Farm added');
    } catch (x) { $('#fmsg').textContent = x.message; }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); } };
  if (!d.open) d.showModal();
  d.querySelector('input')?.focus();
}

boot();
