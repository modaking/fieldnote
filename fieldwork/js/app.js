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

const now = new Date();
const S = { profile: null, ws: null, role: null, farms: [], farmId: localStorage.getItem('fw-farm') || 'all',
  month: localStorage.getItem('fw-month') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, route: 'overview' };
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
  try { await init(); } catch (e) { app.innerHTML = `<div class="center"><div class="panel"><h1>Setup needed</h1><p class="muted">${esc(e.message)}</p></div></div>`; return; }
  if (!session()) return renderAuth();
  try { await load(); } catch (e) { if (!session()) return renderAuth(); app.innerHTML = `<div class="center"><div class="panel"><h1>Couldn’t load your data</h1><p class="err">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`; }
}
async function load() {
  const uid = session().user.id;
  S.profile = (await db.select('profiles', `id=eq.${uid}`))[0] || { id: uid };
  if (S.profile.theme_pref && S.profile.theme_pref !== getPref()) setPref(S.profile.theme_pref);
  const mem = await db.select('workspace_members', `user_id=eq.${uid}&select=role,workspaces(id,name,currency)`);
  if (!mem.length) return renderCreateWs();
  const pick = mem.find((m) => m.workspaces.id === S.profile.active_workspace) || mem[0];
  S.ws = pick.workspaces; S.role = pick.role;
  S.farms = await db.select('farms', `workspace_id=eq.${S.ws.id}&order=created_at`);
  if (S.farmId !== 'all' && !S.farms.some((f) => f.id === S.farmId)) S.farmId = 'all';
  renderShell();
}

/* ───── auth + workspace ───── */
function renderAuth(mode = 'in') {
  const up = mode === 'up';
  app.innerHTML = `<div class="center"><form class="panel" id="auth">${brand()}
    <h1>${up ? 'Create your account' : 'Welcome back'}</h1><p class="muted">Run every farm from one calm place.</p>
    <div class="tabs" role="tablist"><button type="button" class="tab" role="tab" data-mode="in" aria-selected="${!up}">Sign in</button><button type="button" class="tab" role="tab" data-mode="up" aria-selected="${up}">Create account</button></div>
    ${up ? '<label class="field">Your name<input name="name" required autocomplete="name"></label>' : ''}
    <label class="field">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="field">Password<input name="password" type="password" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
    <p class="err" id="msg" role="alert"></p>
    <button class="btn" style="width:100%;justify-content:center">${up ? 'Create account' : 'Sign in'}</button>
    ${up ? '' : '<p style="text-align:center"><a href="#" id="forgot">Forgot your password?</a></p>'}</form></div>`;
  $('#auth').onclick = (e) => { const m = e.target.dataset?.mode; if (m) renderAuth(m); };
  $('#forgot')?.addEventListener('click', async (e) => { e.preventDefault(); const em = $('#auth [name=email]').value;
    if (!em) return ($('#msg').textContent = 'Enter your email above first.');
    try { await auth.reset(em); $('#msg').textContent = 'Check your email for a reset link.'; } catch (x) { $('#msg').textContent = x.message; } });
  $('#auth').onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target), msg = $('#msg'); msg.textContent = '';
    try {
      if (up) { const r = await auth.signUp(f.get('email'), f.get('password'), f.get('name')); if (!r.signedIn) return (msg.textContent = 'Account created. Confirm your email, then sign in.'); }
      else await auth.signIn(f.get('email'), f.get('password'));
      await load();
    } catch (x) { msg.textContent = x.message; } };
}

async function renderCreateWs() {
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
    try {
      const w = await db.insert('workspaces', { name: f.get('name').trim(), currency: f.get('currency'), created_by: session().user.id });
      await db.update('profiles', session().user.id, { active_workspace: w.id });
      await load();
    } catch (x) { $('#msg').textContent = x.message; } };
}

/* ───── shell ───── */
function renderShell() {
  const pref = getPref(), initial = (S.profile?.full_name || session().user.email || '?')[0].toUpperCase();
  app.innerHTML = `<div class="shell"><aside class="side" id="side">${brand()}
      <nav class="nav" aria-label="Modules">${MODULES.map(([id, l]) => `<a href="#/${id}" data-id="${id}">${I(id)}${l}</a>`).join('')}</nav></aside>
    <div class="scrim" id="scrim"></div>
    <div><header class="top"><button class="icon-btn menu-btn" id="menu" aria-label="Open menu">${I('menu')}</button>
        <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav><span class="grow"></span>
        <button class="icon-btn" id="theme" aria-label="Theme: ${pref}. Click to change" title="Theme: ${pref}">${I(pref)}</button>
        <button class="avatar" id="avatar" aria-label="Account menu" aria-haspopup="true">${esc(initial)}</button></header>
      <div id="pop"></div><div class="bar" id="bar"></div><main id="view"></main></div></div>
    <dialog id="dlg"></dialog>`;
  $('#menu').onclick = () => toggleSide(true); $('#scrim').onclick = () => toggleSide(false);
  $('#theme').onclick = () => { const next = { light: 'dark', dark: 'system', system: 'light' }[getPref()];
    setPref(next, (p) => db.update('profiles', session().user.id, { theme_pref: p }));
    $('#theme').innerHTML = I(next); $('#theme').title = `Theme: ${next}`; $('#theme').setAttribute('aria-label', `Theme: ${next}. Click to change`); toast(`Theme: ${next}`); };
  $('#avatar').onclick = () => { const p = $('#pop');
    p.innerHTML = p.innerHTML ? '' : `<div class="pop"><div><b>${esc(S.profile?.full_name || 'You')}</b><br><span class="muted">${esc(session().user.email)}</span><br><span class="badge">${S.role}</span></div>
      <div class="muted">${esc(S.ws.name)} · ${S.ws.currency}</div><button class="btn ghost" id="signout">Sign out</button></div>`;
    $('#signout')?.addEventListener('click', async () => { await auth.signOut(); location.reload(); }); };
  window.onhashchange = route;
  route();
}
const toggleSide = (o) => { $('#side').classList.toggle('open', o); $('#scrim').classList.toggle('open', o); };

function route() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  S.route = MODULES.some((m) => m[0] === id) ? id : 'overview';
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
  $('#bar').onclick = (e) => { const id = e.target.dataset?.farm; if (!id) return; S.farmId = id; localStorage.setItem('fw-farm', id); renderBar(); renderView(); };
  $('#month').onchange = (e) => { if (!e.target.value) return; S.month = e.target.value; localStorage.setItem('fw-month', S.month); renderView(); };
}

/* ───── views ───── */
const empty = (icon, title, text, action = '') => `<div class="empty">${I(icon)}<h2>${title}</h2><p>${text}</p>${action}</div>`;
async function renderView() {
  const v = $('#view'), mod = MODULES.find((m) => m[0] === S.route);
  const X = { S, db, esc, I, toast, money, monthRange, monthLabel, canWrite, uid: () => session().user.id, dlg: () => $('#dlg') };
  if (M[S.route]) { v.innerHTML = ''; try { await M[S.route](v, X); } catch (e) { v.innerHTML = `<p class="err">${esc(e.message)}</p>`; } return; }
  if (S.route !== 'overview') {
    v.innerHTML = `<div class="head"><h1>${mod[1]}</h1></div>` + empty(mod[0], 'Coming in the next stage', `${mod[2]} This module is part of stage 2.`); return; }
  v.innerHTML = `<div class="head"><h1>Overview</h1>${canWrite() ? `<button class="btn" id="addrec">${I('plus')}Add a record</button>` : ''}</div><div id="kpis" class="grid"></div>
    <div class="head"><h2>Farms</h2></div><div id="farms"></div>`;
  $('#addrec')?.addEventListener('click', openAddRecord);
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
    if (d.seed) { b.disabled = true; b.textContent = 'Loading demo…'; try { await loadDemo({ S, db }); toast('Demo data loaded'); await load(); } catch (x) { toast(x.message); b.disabled = false; b.textContent = 'Load demo data'; } return; }
    if (d.open) { S.farmId = d.open; localStorage.setItem('fw-farm', d.open); renderBar(); toast('Showing this farm'); }
    if (d.edit) openFarm(S.farms.find((f) => f.id === d.edit));
    if (d.del && confirm('Delete this farm and everything recorded against it? This can’t be undone.')) {
      try { await db.remove('farms', d.del); S.farms = S.farms.filter((f) => f.id !== d.del); if (S.farmId === d.del) S.farmId = 'all'; renderBar(); renderFarms(); renderKpis(); toast('Farm deleted'); } catch (x) { toast(x.message); } } };
}
async function renderKpis() {
  const el = $('#kpis'); if (!el) return; const [a, b] = monthRange(), fq = S.farmId === 'all' ? '' : `&farm_id=eq.${S.farmId}`;
  let inc = 0, exp = 0, open = 0;
  try {
    const [t, k] = await Promise.all([db.select('transactions', `select=kind,amount_base&txn_date=gte.${a}&txn_date=lt.${b}${fq}`), db.select('tasks', `select=id&status=eq.open${fq}`)]);
    t.forEach((r) => (r.kind === 'income' ? (inc += r.amount_base) : (exp += r.amount_base))); open = k.length;
  } catch (x) { toast(x.message); }
  const net = inc - exp;
  el.innerHTML = [['Income', money(inc), 'pos'], ['Expenses', money(exp), ''], ['Net cash flow', money(net), net < 0 ? 'neg' : net > 0 ? 'pos' : ''], ['Open tasks', open, '']]
    .map(([l, v, c]) => `<div class="card"><span class="muted">${l} · ${monthLabel()}</span><div class="kpi ${c}">${v}</div></div>`).join('');
}

/* ───── dialogs ───── */
function openAddRecord() {
  const d = $('#dlg'), later = ['Task', 'Transaction', 'Vendor', 'Worker', 'Project', 'Funding opportunity'];
  d.innerHTML = `<h2>Add a record</h2><div class="picker" style="margin-top:var(--sp-4)"><button class="btn" data-k="farm">Farm</button>
    ${later.map((l) => `<button class="btn" disabled>${l}<span class="badge">Stage 2</span></button>`).join('')}</div>
    <div class="actions"><button class="btn ghost" value="x">Close</button></div>`;
  d.onclick = (e) => { if (e.target.dataset?.k === 'farm') openFarm(); if (e.target.value === 'x') d.close(); };
  d.showModal();
}
function openFarm(farm) {
  const d = $('#dlg'), f = farm || {};
  d.innerHTML = `<form id="farmf"><h2>${farm ? 'Edit farm' : 'Add farm'}</h2>
    <label class="field" style="margin-top:var(--sp-4)">Farm name<input name="name" required value="${esc(f.name)}" placeholder="e.g. Ol Kalou"></label>
    <label class="field">County<input name="county" list="counties" value="${esc(f.county)}" placeholder="Start typing…"></label>
    <datalist id="counties">${COUNTIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <label class="field">Location notes<input name="location_text" value="${esc(f.location_text)}" placeholder="Town, road or landmark"></label>
    <p class="muted" style="font-size:var(--fs-sm)">Map pin and GPS arrive in stage 4.</p><p class="err" id="fmsg" role="alert"></p>
    <div class="actions"><button type="button" class="btn ghost" id="cancel">Cancel</button><button class="btn">Save farm</button></div></form>`;
  $('#cancel').onclick = () => d.close();
  $('#farmf').onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const row = { name: v.name.trim(), county: v.county.trim() || null, location_text: v.location_text.trim() || null };
    try {
      if (farm) { const u = await db.update('farms', farm.id, row); S.farms = S.farms.map((x) => (x.id === farm.id ? u : x)); }
      else S.farms.push(await db.insert('farms', { ...row, workspace_id: S.ws.id }));
      d.close(); renderBar(); renderFarms(); toast(farm ? 'Farm updated' : 'Farm added');
    } catch (x) { $('#fmsg').textContent = x.message; } };
  d.showModal();
}

boot();
