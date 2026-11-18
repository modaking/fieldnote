import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as components from '../js/components.js';
import * as permissions from '../js/permissions.js';
import { createReport } from '../js/reports.js';
import * as invites from '../js/invites.js';
import * as navigation from '../js/navigation.js';
import * as pagination from '../js/read-all.js';

const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const memberSource = await readFile(new URL('../js/members.js', import.meta.url), 'utf8');
const feedbackSource = await readFile(new URL('../js/feedback.js', import.meta.url), 'utf8');
const routeNames = ['daily', 'finances', 'vendors', 'infrastructure', 'livestock', 'workers', 'funding'];
const settle = async () => { await new Promise(setImmediate); };

async function harness(viewOverrides = {}, { initialHash = '#/overview',initialInvite='',authOverrides={},initialRedirect } = {}) {
  const nodes = new Map();
  const requests = [];
  const calls = [];
  const messages = [];
  const confirmations = [], confirmationAnswers = [];
  const storage = new Map([['fw-month', '2026-11']]);
  const tabStorage=new Map(initialInvite?[['fw-invite',initialInvite]]:[]);
  const events = new Map();
  let currentSession = { user: { id: 'user-1', email: 'farmer@example.test' } };
  let activeElement;
  class Element {
    constructor(id = '') {
      this.id = id; this.dataset = {}; this.innerHTML = ''; this.isConnected = true;
      this.attributes = new Map(); this.listeners = new Map(); this.closed = false; this.open = false;
      const classes = new Set();
      this.classList = {
        toggle(name, force) { const on = force ?? !classes.has(name); if (on) classes.add(name); else classes.delete(name); return on; },
        add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
      };
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
    querySelector(selector) { return get(selector); }
    querySelectorAll(selector) { return this.id === 'dlg' && selector === 'button,input,select,textarea'
      ? [get('[data-drawer-close]'), get('#cancel-farm'), get('[type=submit]')] : []; }
    replaceWith(next) { this.isConnected = false; next.isConnected = true; nodes.set(`#${next.id}`, next); }
    replaceChildren(...children) { this.children = children; this.innerHTML = ''; }
    append() {}
    remove() { this.isConnected = false; }
    close() { this.closed = true; this.open = false; }
    showModal() { this.closed = false; this.open = true; }
    focus() { activeElement = this; }
    closest() { return this; }
    click() { if (this.disabled) return; return this.onclick?.({ target: this, currentTarget: this }) ?? this.listeners.get('click')?.({ target: this, currentTarget: this }); }
  }
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector.startsWith('#') ? selector.slice(1) : selector));
    return nodes.get(selector);
  };
  const links = navigation.PAGES.map(({id:name}) => {
    const el = new Element(); el.dataset.id = name; return el;
  });
  const document = {
    querySelector: get,
    querySelectorAll: (selector) => ['.nav a','.nav a,.mobile-navigation a'].includes(selector) ? links : [],
    createElement: () => new Element(),
    getElementById: (id) => get(`#${id}`),
    addEventListener: (type, handler) => events.set(type, handler),
    get activeElement() { return activeElement; },
  };
  let hash = initialHash, historyIndex=0;const historyEntries=[hash];
  const urlHash=value=>String(value).includes('#')?String(value).slice(String(value).indexOf('#')):'';
  const location = {
    get hash() { return hash; },
    set hash(value) { const next=value&&!String(value).startsWith('#')?`#${value}`:String(value);if(next===hash)return;hash=next;historyEntries.splice(++historyIndex);historyEntries.push(hash); },
    origin: 'http://localhost', pathname: '/', search: '', reload() {},
  };
  const browserWindow={location,addEventListener:(type,handler)=>events.set(type,handler),matchMedia:()=>({matches:true})};
  const history = {
    replaceState(_state,_title,url){hash=urlHash(url);historyEntries[historyIndex]=hash;},
    pushState(_state,_title,url){hash=urlHash(url);historyEntries.splice(++historyIndex);historyEntries.push(hash);},
    back(){if(historyIndex>0){hash=historyEntries[--historyIndex];return browserWindow.onhashchange?.();}},
    forward(){if(historyIndex<historyEntries.length-1){hash=historyEntries[++historyIndex];return browserWindow.onhashchange?.();}},
  };
  const db = {
    async select(table, query = '') {
      requests.push({ table, query });
      return [];
    },
    async update() {}, async rpc(name,args) { requests.push({rpc:name,args});return {}; },
  };
  const views = Object.fromEntries(routeNames.map((name) => [name, viewOverrides[name] || ((el, X) => {
    calls.push({ name, X, el }); el.innerHTML = `${name} ready`;
  })]));
  views.taskStatus = (row) => row.status || 'open';
  views.moduleViews=Object.fromEntries(navigation.SECTIONS.filter(s=>s.module!=='members').map(s=>[s.id,viewOverrides[s.id]||views[s.module]]));
  let contextualMembers;
  const dependencies = new Map([
    ['./supabase.js', { init: () => initialRedirect===undefined?new Promise(() => {}):Promise.resolve(initialRedirect), session: () => currentSession, auth: authOverrides, db,
      networkState:()=>({online:true,pending:0}),subscribeNetwork:()=>()=>{},subscribeSession:()=>()=>{} }],
    ['./theme.js', { getPref: () => 'light', setPref() {} }],
    ['./modules.js', views],
    ['./seed.js', { loadDemo() {} }],
    ['./components.js', { ...components, toast: (message) => messages.push(message), confirmDialog: async options => {
      confirmations.push(options); return confirmationAnswers.shift() ?? false;
    } }],
    ['./permissions.js', permissions],
    ['./crud.js', { resource: async (el,X,cfg) => { calls.push({name:'resource',X,cfg,el}); el.innerHTML='Resource ready'; } }],
    ['./reports.js', { renderReports: async (el,X,{module}) => { calls.push({name:'reports',X,module,el}); await createReport(X,{module}); el.innerHTML=`${module} report ready`; } }],
    ['./members.js', { members: async (el,X,options) => { if(!X.migrationReady)return contextualMembers(el,X,options);calls.push({name:'members',X,el,options}); el.innerHTML='Members ready'; } }],
    ['./invites.js', invites],
    ['./dashboard.js', { dashboard:async(el,X)=>{calls.push({name:'dashboard',X,el});el.innerHTML='Dashboard ready';} }],
    ['./account.js', { account:async()=>{},requireMfa:async()=>false }],
    ['./navigation.js',navigation],
    ['./read-all.js',pagination],
    ['./navigation-ui.js',{renderSectionPage:async(el,X,nav,leafViews,members)=>{
      const section=navigation.SECTIONS.find(item=>item.id===nav.section);assert.ok(section,`Unknown section ${nav.section}`);
      const local={...X,section:section.id,pageTitle:section.label};
      if(section.module==='members')return members(el,local,{tab:section.id==='invitations'?'invites':'members',hideTabs:true});
      assert.equal(typeof leafViews[section.id],'function',`Missing leaf renderer ${section.id}`);return leafViews[section.id](el,local);
    },openCommandPalette:X=>calls.push({name:'command',X}),openMoreNavigation:X=>calls.push({name:'more-navigation',X})}],
    ['./auth-ui.js', { renderAuth: (el) => { calls.push({name:'auth'}); el.innerHTML='Sign in required'; }, renderReset:(el,options)=>calls.push({name:'reset',el,options}),renderInvitationVerification:(el,options)=>calls.push({name:'invitation-verification',el,options}), formErrors:()=>true, busy:(el,value)=>{el.disabled=value;} }],
  ]);
  const context = vm.createContext({
    document, location, history, console, URLSearchParams, Event, crypto: webcrypto,
    FormData: class { constructor(form) { this.values = Object.entries(form.values || {}); } get(name) { return this.values.find(([key]) => key === name)?.[1] ?? null; } [Symbol.iterator]() { return this.values[Symbol.iterator](); } },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: {getItem:key=>tabStorage.get(key)||null,setItem:(key,value)=>tabStorage.set(key,String(value)),removeItem:key=>tabStorage.delete(key)},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    setTimeout: () => 0,
    MutationObserver: class { observe() {} disconnect() {} },
    window: browserWindow,
  });
  // Expose private entry points only inside this isolated test module. The real
  // functions, UI event handlers and asynchronous rendering logic remain intact.
  const dependencyModules=new Map();
  const dependency=(specifier)=>{
    if(dependencyModules.has(specifier))return dependencyModules.get(specifier);
    const values = dependencies.get(specifier);
    assert.ok(values, `Unexpected app dependency ${specifier}`);
    const linked=new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
    dependencyModules.set(specifier,linked);return linked;
  };
  // The real readiness gate must share this VM's location and browser state;
  // importing that function in the Node host would read the host's globals.
  // Keep the real registry/guard isolated too; only the user's confirmation
  // response is supplied by the test instead of opening a second DOM dialog.
  const feedbackModule = new vm.SourceTextModule(feedbackSource,{context,identifier:'feedback.js'});
  await feedbackModule.link(dependency);await feedbackModule.evaluate();
  dependencies.set('./feedback.js',feedbackModule.namespace);
  const memberModule=new vm.SourceTextModule(memberSource,{context,identifier:'members.js'});
  await memberModule.link(dependency);await memberModule.evaluate();contextualMembers=memberModule.namespace.members;
  const module = new vm.SourceTextModule(`${source}\nexport { S, load, route, renderView, renderShell, openAddRecord, openFarm,pendingInvite };`, { context, identifier: 'app.js',importModuleDynamically:async specifier=>{const linked=dependency(specifier);if(linked.status==='unlinked')await linked.link(()=>{});if(linked.status==='linked')await linked.evaluate();return linked;} });
  await module.link(dependency);
  await module.evaluate();
  Object.assign(module.namespace.S, {
    userId: 'user-1', ws: { id: 'workspace-a', name: 'Test workspace', currency: 'KES' }, role: 'owner', memberships: [], accessReady: false, farmIds: null,
    profile: { full_name: 'Test farmer' },
    farms: [{ id: 'farm-a', name: 'First farm' }, { id: 'farm-b', name: 'Second farm' }],
    farmId: 'all', month: '2026-11', route: 'overview',page:'overview',section:null,
  });
  return { api: module.namespace, feedback: feedbackModule.namespace, confirmations, answerConfirmation: answer => confirmationAnswers.push(answer), document, location, history, requests, calls, messages, get, links, storage,tabStorage, Element, events, db,
    setSession: (next) => { currentSession = next; }, replaceNode: (selector, element) => nodes.set(selector, element) };
}

test('pending token invitations wait for server mailbox verification before any workspace or acceptance request',async()=>{
  const token='c'.repeat(64),h=await harness({}, {initialInvite:token,authOverrides:{invitationVerification:async()=>({needs_recovery:true,proof_recent:false})}});
  await h.api.load();assert.equal(h.requests.length,0);assert.equal(h.calls.at(-1).name,'invitation-verification');assert.equal(h.calls.at(-1).options.needsRecovery,true);assert.equal(h.tabStorage.get('fw-invite'),token);
});

test('a verified token invitation can accept while a missing proof service never offers acceptance',async()=>{
  const token='d'.repeat(64),h=await harness({}, {initialInvite:token,authOverrides:{invitationVerification:async()=>({needs_recovery:false,proof_recent:true})}});
  await h.api.load();assert.match(h.get('#invite-accept').innerHTML,/Accept invitation/);await h.get('#accept-invite').click();assert.equal(h.requests[0].rpc,'fw_accept_invite');assert.equal(h.requests[0].args.p_token,token);assert.equal(h.tabStorage.has('fw-invite'),false);
  const failed=await harness({}, {initialInvite:token,authOverrides:{invitationVerification:async()=>{throw new Error('Reviewed security upgrade is unavailable');}}});await failed.api.load();assert.match(failed.get('#invite-message').innerHTML,/verification unavailable/);assert.equal(failed.requests.length,0);assert.equal(failed.tabStorage.get('fw-invite'),token);
});

test('recovery callback state stops before incoming invitations or workspace reads until the password and attestation finish',async()=>{
  const h=await harness({}, {initialInvite:'e'.repeat(64),authOverrides:{recoveryPending:()=>({invitation:true,passwordSaved:false})}});await h.api.load();assert.equal(h.calls.at(-1).name,'reset');assert.equal(h.calls.at(-1).options.invitationRecovery,true);assert.equal(h.requests.length,0);
});

test('a fresh-tab callback resynchronizes the captured invitation before root recovery or invite rendering',async()=>{
  const token='a'.repeat(64),h=await harness({}, {initialRedirect:{type:'recovery'},authOverrides:{takeInviteIntent:()=>token,recoveryPending:()=>({invitation:true,passwordSaved:false})}});await settle();assert.equal(h.api.pendingInvite,token);assert.equal(h.calls.at(-1).name,'reset');assert.equal(h.requests.length,0);
});

test('accepted membership is retained and reported even when selecting its default workspace fails',async()=>{
  const h=await harness({}, {initialInvite:'b'.repeat(64),authOverrides:{invitationVerification:async()=>({needs_recovery:false,proof_recent:true})}});h.db.rpc=async(name,args)=>{h.requests.push({rpc:name,args});return'joined-workspace';};h.db.update=async()=>{throw new Error('Preference update offline');};
  await h.api.load();await h.get('#accept-invite').click();assert.equal(h.api.pendingInvite,'');assert.equal(h.tabStorage.has('fw-invite'),false);assert.ok(h.messages.some(message=>/Invitation accepted.*My workspaces/.test(message)));assert.equal(h.requests.filter(request=>request.rpc==='fw_accept_invite').length,1);
});

test('navigation opens the requested module while retaining farm and month filters', async () => {
  const h = await harness();
  h.api.S.farmId = 'farm-b';
  h.location.hash = '#/daily';
  h.api.route();
  await settle();
  assert.equal(h.get('#view').innerHTML, 'daily ready');
  assert.equal(h.calls[0].name, 'daily');
  assert.equal(h.calls[0].X.S.farmId, 'farm-b');
  assert.equal(h.calls[0].X.S.month, '2026-11');
  assert.equal(h.api.S.route,'daily');assert.equal(h.api.S.page,'operations');assert.equal(h.api.S.section,'tasks');
  assert.equal(h.links.find((link) => link.dataset.id === 'operations').getAttribute('aria-current'), 'page');
});

test('a slow previous module cannot replace the newly selected page', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const h = await harness({ daily: async (el) => { await waiting; el.innerHTML = 'old daily response'; } });
  h.location.hash = '#/daily'; h.api.route();
  h.location.hash = '#/finances'; h.api.route();
  await settle();
  assert.equal(h.get('#view').innerHTML, 'finances ready');
  release(); await settle();
  assert.equal(h.get('#view').innerHTML, 'finances ready');
});

test('selecting the farm bar refreshes the dashboard using that farm and workspace', async () => {
  const h = await harness();
  h.api.route(); await settle();
  h.calls.length = 0;
  const selector=h.get('#farm-selector');selector.value='farm-b';
  await selector.onchange({ target: selector });
  await settle();
  const dashboard = h.calls.find((request) => request.name === 'dashboard');
  assert.ok(dashboard, 'Selecting a farm must refresh its dashboard.');
  assert.equal(dashboard.X.S.farmId,'farm-b');assert.equal(dashboard.X.S.ws.id,'workspace-a');
  assert.equal(h.storage.get('fw-farm:user-1:workspace-a'), 'farm-b');
});

test('Add a record provides an enabled task shortcut into the task module', async () => {
  const h = await harness();
  h.api.openAddRecord();
  const dialog = h.get('#dlg');
  const buttonMatch = [...dialog.innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find((match) => /\btask\b/i.test(match[2]));
  assert.ok(buttonMatch, 'The record menu must provide a task action.');
  assert.equal(/\bdisabled\b/.test(buttonMatch[1]), false);
  const button = new h.Element();
  for (const attribute of buttonMatch[1].matchAll(/data-([\w-]+)="([^"]*)"/g)) {
    button.dataset[attribute[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = attribute[2];
  }
  button.value = /\bvalue="([^"]*)"/.exec(buttonMatch[1])?.[1] || '';
  await dialog.onclick({ target: button });
  const destination=navigation.resolveNavigation(h.location.hash);assert.equal(destination.section,'tasks');assert.equal(destination.params.get('add'),'1');
  assert.equal(dialog.closed, true);
});

test('Skip to content moves focus without changing the current navigation route', async () => {
  const h = await harness();
  h.location.hash = '#/daily'; h.api.route(); await settle();
  const route=h.location.hash;
  let prevented = false;
  h.get('.skip-link').listeners.get('click')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.location.hash, route);
  assert.equal(h.api.S.route, 'daily');
  assert.equal(h.get('#view').tabIndex, -1);
  assert.equal(h.document.activeElement, h.get('#view'));
});

test('the mobile menu is inert while closed and Escape restores focus to its opener', async () => {
  const h = await harness();
  h.api.renderShell(); await settle();
  assert.equal(h.get('#side').inert, true);
  await h.get('#menu').click();
  assert.equal(h.get('#side').inert, false);
  assert.equal(h.get('#menu').getAttribute('aria-expanded'), 'true');
  assert.equal(h.document.activeElement, h.get('#close-menu'));
  h.events.get('keydown')({ key: 'Escape' });
  assert.equal(h.get('#side').inert, true);
  assert.equal(h.get('#menu').getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.activeElement, h.get('#menu'));
});

test('direct financial and member routes deny a worker before calling protected views', async () => {
  const h=await harness();h.api.S.role='worker';
  for(const route of ['finances','members']){
    h.location.hash=`#/${route}`;h.api.route();await settle();
    assert.match(h.get('#view').innerHTML,/unavailable for your role/);
  }
  assert.equal(h.calls.length,0);
  assert.equal(h.requests.length,0);
});

test('a direct financial statement URL carries worker restrictions into the real report gate', async () => {
  const h=await harness();h.api.S.role='worker';h.location.hash='#/reports?module=finances';h.api.route();await settle();
  const report=h.calls.find((call)=>call.name==='reports');
  assert.equal(report.module,'finances');assert.equal(report.X.canReport('finances'),false);
  assert.equal(report.X.permissions.has('finance.read'),false);
  assert.match(h.get('#view').innerHTML,/role cannot open this statement/);
  assert.equal(h.requests.length,0,'Denied reports must not query protected data.');
});

test('dedicated Reports routes preserve the selected module, scope and upgrade readiness', async () => {
  const h=await harness();h.api.S.farmId='farm-b';h.api.S.farmIds=['farm-b'];h.api.S.accessReady=false;
  h.location.hash='#/reports?module=daily';h.api.route();await settle();
  const report=h.calls.find((call)=>call.name==='reports');
  assert.equal(report.module,'daily');assert.equal(report.X.migrationReady,false);
  assert.deepEqual([...report.X.permissions.farmIds],['farm-b']);assert.equal(report.X.S.farmId,'farm-b');
  assert.equal(h.get('#view').innerHTML,'daily report ready');
  assert.ok(h.requests.every((request)=>request.query.includes('workspace_id=eq.workspace-a')));
});

test('member routing displays upgrade guidance until the database contract is ready', async () => {
  const h=await harness();h.location.hash='#/members';h.api.route();await settle();
  assert.match(h.get('#view').innerHTML,/access upgrade required/i);
  assert.equal(h.calls.some((call)=>call.name==='members'),false);
  assert.equal(h.requests.length,0,'Upgrade guidance must appear before member RPC reads.');
  h.api.S.accessReady=true;h.api.route();await settle();
  const members=h.calls.find((call)=>call.name==='members');
  assert.equal(members.X.migrationReady,true);assert.equal(h.get('#view').innerHTML,'Members ready');
});

test('farm save cannot be dismissed while pending and a late response cannot close a replacement drawer', async () => {
  const h = await harness(); let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  h.db.insert = async (_table, row) => { await waiting; return row; };
  h.api.openFarm();
  const dialog = h.get('#dlg'), form = h.get('#farm-form');
  form.values = { name: 'Saved farm', county: 'Kajiado', location_text: 'Sample location' };
  const saving = form.onsubmit({ preventDefault() {} });
  assert.equal(h.get('#cancel-farm').disabled, true);
  h.get('#cancel-farm').click(); h.get('[data-drawer-close]').click();
  let prevented = false; dialog.oncancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(dialog.open, true);
  // A programmatic route/account flow can replace the shared drawer even while
  // the original network request is pending. Its completion must leave it alone.
  components.openDrawer(dialog,{title:'Replacement record picker',body:'Replacement'}); h.replaceNode('#farm-form', null);
  const replacement = dialog.innerHTML;
  release(); await saving; await settle();
  assert.equal(dialog.open, true); assert.equal(dialog.innerHTML, replacement);
  assert.equal(h.messages.includes('Farm saved'), false);
});

test('a farm response from a previous account cannot update the next account in the same workspace', async () => {
  const h = await harness(); let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  h.db.insert = async (_table, row) => { await waiting; return row; };
  h.api.openFarm(); const form = h.get('#farm-form');
  form.values = { name: 'Previous account farm', county: '', location_text: '' };
  const saving = form.onsubmit({ preventDefault() {} });
  h.setSession({ user: { id: 'user-2', email: 'next@example.test' } });
  h.api.S.userId = 'user-2'; h.api.S.farms = [{ id: 'next-farm', name: 'Next account farm' }];
  release(); await saving;
  assert.deepEqual([...h.api.S.farms].map((farm) => farm.id), ['next-farm']);
  assert.equal(h.messages.includes('Farm saved'), false);
});

test('clearing account storage immediately removes workspace data and privileges', async () => {
  const h = await harness(); h.get('#dlg').showModal();
  h.setSession(null); h.events.get('storage')({ key: 'fw-session' });
  assert.equal(h.api.S.userId, null); assert.equal(h.api.S.ws, null); assert.equal(h.api.S.role, null);
  assert.equal(h.api.S.profile, null); assert.equal(h.api.S.accessReady, false);
  assert.equal(h.api.S.farms.length, 0); assert.equal(h.api.S.memberships.length, 0);
  assert.equal(h.get('#dlg').open, false); assert.equal(h.get('#app').innerHTML, 'Sign in required');
});

test('switching account storage clears old permissions before the new context finishes loading', async () => {
  const h = await harness(); let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  h.db.select = async (table,query='') => {
    if (table === 'profiles') { await waiting; return [{ id: 'user-2', full_name: 'Next farmer', active_workspace: 'workspace-next' }]; }
    if (table === 'workspace_members') return [{ role: 'viewer', workspaces: { id: 'workspace-next', name: 'Next workspace', currency: 'KES' } }];
    if (table === 'farms') return new URLSearchParams(query).get('offset')==='0'?[{ id: 'next-farm', name: 'Next farm' }]:[];
    return [];
  };
  h.db.rpc = async () => ({ schema_version: '20261118', role: 'viewer', farm_scope: 'all', farm_ids: [] });
  h.setSession({ user: { id: 'user-2', email: 'next@example.test' } });
  h.events.get('storage')({ key: 'fw-session' });
  assert.equal(h.api.S.ws, null); assert.equal(h.api.S.role, null); assert.equal(h.api.S.farms.length, 0);
  release(); await settle();
  assert.equal(h.api.S.userId, 'user-2'); assert.equal(h.api.S.ws.id, 'workspace-next');
  assert.equal(h.api.S.role, 'viewer'); assert.deepEqual([...h.api.S.farms].map((farm) => farm.id), ['next-farm']);
});

test('document tab navigation does not handle a keyboard event already handled by a component', async () => {
  const h = await harness(); let clicks = 0;
  const first = new h.Element(), second = new h.Element();
  first.parentElement = { querySelectorAll: () => [first, second] }; first.closest = () => first;
  second.click = () => { clicks += 1; };
  h.events.get('keydown')({ key: 'ArrowRight', target: first, defaultPrevented: true, preventDefault() {} });
  assert.equal(clicks, 0);
});

test('back, forward and a fresh URL restore the section, farm, period and record filters',async()=>{
  const h=await harness();h.api.renderShell();await settle();
  h.location.hash='#/operations?section=checklists&farm=farm-b&month=2026-10&q=water';await h.api.route();await settle();
  assert.equal(h.api.S.page,'operations');assert.equal(h.api.S.route,'daily');assert.equal(h.api.S.section,'checklists');
  assert.equal(h.calls.at(-1).X.section,'checklists');assert.equal(h.calls.at(-1).X.filters.q,'water');
  h.location.hash='#/finances?section=recurring&farm=farm-a&month=2026-11&id=payment-1';await h.api.route();await settle();
  assert.equal(h.api.S.section,'recurring');assert.equal(h.calls.at(-1).X.filters.id,'payment-1');
  await h.history.back();await settle();
  assert.equal(h.api.S.section,'checklists');assert.equal(h.api.S.farmId,'farm-b');assert.equal(h.api.S.month,'2026-10');
  assert.equal(new URLSearchParams(h.location.hash.split('?')[1]).get('q'),'water');
  await h.history.forward();await settle();
  assert.equal(h.api.S.section,'recurring');assert.equal(h.api.S.farmId,'farm-a');assert.equal(h.api.S.month,'2026-11');
  const refreshed=await harness({}, {initialHash:h.location.hash});await refreshed.api.route();await settle();
  assert.equal(refreshed.api.S.page,'finances');assert.equal(refreshed.api.S.route,'finances');assert.equal(refreshed.api.S.section,'recurring');
  assert.equal(refreshed.calls.at(-1).X.filters.id,'payment-1');assert.equal(refreshed.api.S.farmId,'farm-a');
});

test('five-page navigation keeps global keyboard search and the mobile More entry usable',async()=>{
  const h=await harness();h.api.renderShell();await settle();
  assert.deepEqual(h.links.map(link=>link.dataset.id),['overview','operations','finances','people','reports']);
  let prevented=false;h.events.get('keydown')({key:'k',ctrlKey:true,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.calls.at(-1).name,'command');assert.equal(h.calls.at(-1).X.uid(),'user-1');
  await h.get('#mobile-more').click();assert.equal(h.calls.at(-1).name,'more-navigation');assert.equal(h.calls.at(-1).X.S.ws.id,'workspace-a');
});
test('closing Quick add preserves inline Profile dirty and saving registrations',async()=>{
  const h=await harness();h.api.renderShell();await settle();let dirty=true,saving=false;
  h.feedback.registerUnsaved({element:{isConnected:true},isDirty:()=>dirty,isSaving:()=>saving});
  await h.get('#global-add').click();assert.match(h.get('#dlg').innerHTML,/Add a record/);assert.equal(h.feedback.hasUnsavedChanges(),true);
  h.get('[data-drawer-close]').click();dirty=false;assert.equal(h.feedback.hasUnsavedChanges(),false);dirty=true;assert.equal(h.feedback.hasUnsavedChanges(),true);
  dirty=false;saving=true;assert.equal(h.feedback.hasUnsavedChanges(),true,'opening and dismissing a chooser must not unregister a later pending save');
});

test('cancelling Filters preserves later inline budget edits and their navigation prompt',async()=>{
  const h=await harness();h.location.hash='#/finances?section=budgets';await h.api.route();await settle();
  let dirty=true;
  h.feedback.registerUnsaved({element:h.get('#view'),isDirty:()=>dirty});
  await h.get('#top-filters').click();
  assert.match(h.get('#dlg').innerHTML,/Farm and period/);
  assert.equal(h.confirmations.length,0,'Opening a temporary filter sheet must not discard inline changes.');
  h.get('[data-drawer-close]').click();assert.equal(h.get('#dlg').open,false);
  dirty=false;assert.equal(h.feedback.hasUnsavedChanges(),false);
  dirty=true;h.location.hash='#/operations?section=tasks';await h.api.route();await settle();
  assert.equal(h.confirmations.length,1,'Editing the same inline budget after closing Filters must still prompt.');
  assert.equal(h.api.S.section,'budgets');assert.match(h.location.hash,/section=budgets/);
  assert.equal(h.feedback.hasUnsavedChanges(),true);
});

test('Filters cannot replace an existing drawer with unsaved or saving changes',async()=>{
  const h=await harness();await h.api.route();await settle();
  const dialog=h.get('#dlg');components.openDrawer(dialog,{title:'Edit record',body:'<form>Existing record</form>'});
  const existing=dialog.innerHTML;let saving=false;
  h.feedback.registerUnsaved({element:dialog,isDirty:()=>true,isSaving:()=>saving,isActive:()=>dialog.open});
  await h.get('#top-filters').click();
  assert.equal(h.confirmations.length,1);assert.equal(dialog.innerHTML,existing);assert.equal(dialog.open,true);
  saving=true;await h.get('#top-filters').click();
  assert.equal(h.confirmations.length,1,'An active save must block replacement before requesting discard.');
  assert.equal(dialog.innerHTML,existing);assert.match(h.messages.at(-1),/finish saving/);
});

test('applying Filters asks before discarding an inline budget and changes scope only after confirmation',async()=>{
  const h=await harness();h.location.hash='#/finances?section=budgets';await h.api.route();await settle();
  h.feedback.registerUnsaved({element:h.get('#view'),isDirty:()=>true});
  await h.get('#top-filters').click();const form=h.get('#top-filter-form');form.values={farm:'farm-b',month:'2026-10'};
  await form.onsubmit({preventDefault(){},target:form});
  assert.equal(h.confirmations.length,1);assert.equal(h.api.S.farmId,'all');assert.equal(h.api.S.month,'2026-11');
  assert.equal(h.feedback.hasUnsavedChanges(),true);
  await h.get('#top-filters').click();h.answerConfirmation(true);
  await h.get('#top-filter-form').onsubmit({preventDefault(){},target:form});await settle();
  assert.equal(h.confirmations.length,2);assert.equal(h.api.S.farmId,'farm-b');assert.equal(h.api.S.month,'2026-10');
  assert.equal(h.feedback.hasUnsavedChanges(),false);assert.equal(h.api.S.section,'budgets');
});

test('loading a workspace retains all 1,001 permitted farms and the database role context',async()=>{
  const h=await harness(),farms=Array.from({length:1001},(_,index)=>({id:`farm-${index}`,name:`Farm ${index}`,created_at:'2026-11-01T00:00:00Z'})),queries=[];
  h.storage.set('fw-farm:user-1:workspace-a','farm-1000');
  h.db.select=async(table,query='')=>{
    if(table==='profiles')return[{id:'user-1',active_workspace:'workspace-a'}];
    if(table==='workspace_members')return[{role:'owner',workspaces:{id:'workspace-a',name:'Test workspace',currency:'KES'}}];
    if(table==='farms'){const params=new URLSearchParams(query);queries.push(params);return farms.slice(Number(params.get('offset')||0),Number(params.get('offset')||0)+1000);}
    return[];
  };
  h.db.rpc=async()=>({schema_version:'20261118',role:'viewer',farm_scope:'farms',farm_ids:farms.map(farm=>farm.id)});
  await h.api.load();await settle();
  assert.equal(h.api.S.farms.length,1001);assert.equal(h.api.S.farmId,'farm-1000');
  assert.equal(h.api.S.role,'viewer');assert.equal(h.api.S.accessReady,true);assert.equal(h.api.S.farmIds.length,1001);
  assert.deepEqual(queries.map(params=>params.get('offset')),['0','1000','1001']);
  assert.ok(queries.every(params=>params.get('workspace_id')==='eq.workspace-a'&&params.get('order')==='created_at.asc,id.asc'));
});

test('an account change during farm pagination cannot commit the previous workspace context',async()=>{
  const h=await harness();let release;
  const waiting=new Promise(resolve=>{release=resolve;});
  h.db.select=async(table)=>{
    if(table==='profiles')return[{id:'user-1',active_workspace:'workspace-old'}];
    if(table==='workspace_members')return[{role:'owner',workspaces:{id:'workspace-old',name:'Old workspace',currency:'KES'}}];
    if(table==='farms'){await waiting;return[{id:'old-farm',name:'Old farm'}];}
    return[];
  };
  const pending=h.api.load();await settle();
  h.setSession({user:{id:'user-2'}});Object.assign(h.api.S,{userId:'user-2',ws:{id:'workspace-next',currency:'KES'},farms:[{id:'next-farm'}],role:'worker'});
  release();await pending;
  assert.equal(h.api.S.userId,'user-2');assert.equal(h.api.S.ws.id,'workspace-next');assert.equal(h.api.S.role,'worker');
  assert.deepEqual([...h.api.S.farms].map(farm=>farm.id),['next-farm']);
});

test('a Settings farm refresh cannot overwrite farms after its account changes',async()=>{
  const h=await harness(),farms=Array.from({length:1001},(_,index)=>({id:`farm-${index}`,name:`Farm ${index}`}));
  let release,hold=false,started=false;const waiting=new Promise(resolve=>{release=resolve;});
  h.db.select=async(table,query='')=>{
    assert.equal(table,'farms');
    if(hold){started=true;await waiting;return[{id:'old-farm',name:'Old farm'}];}
    const offset=Number(new URLSearchParams(query).get('offset')||0);return farms.slice(offset,offset+1000);
  };
  h.location.hash='#/settings';await h.api.route();await settle();
  const resource=h.calls.find(call=>call.name==='resource');assert.ok(resource);
  h.api.S.farmId='farm-1000';await resource.cfg.afterChange();
  assert.equal(h.api.S.farms.length,1001);assert.equal(h.api.S.farmId,'farm-1000');
  hold=true;
  const pending=resource.cfg.afterChange();await settle();
  assert.equal(started,true,'The refresh must be waiting on the original context before switching accounts.');
  h.setSession({user:{id:'user-2'}});Object.assign(h.api.S,{userId:'user-2',ws:{id:'workspace-next',currency:'KES'},farms:[{id:'next-farm'}],farmId:'next-farm'});
  release();await pending;
  assert.deepEqual([...h.api.S.farms].map(farm=>farm.id),['next-farm']);assert.equal(h.api.S.farmId,'next-farm');
});
