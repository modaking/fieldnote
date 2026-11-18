import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

// A small boundary double for this app's existing string-template UI. Production
// event handlers, validation, money conversion and queries execute unchanged.
class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tag = tag; this.attrs = attrs; this.dataset = {}; this.listeners = {}; this.children = [];
    this.value = attrs.value || ''; this.disabled = 'disabled' in attrs;this.checked='checked' in attrs; this.textContent = ''; this.type = attrs.type;
    this.classList = { add: (...values) => { this.attrs.class = `${this.attrs.class || ''} ${values.join(' ')}`; },remove:(name)=>{this.attrs.class=(this.attrs.class||'').split(' ').filter(value=>value!==name).join(' ');} };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    this.id = attrs.id; this.name = attrs.name;
  }
  set innerHTML(html) {
    this.html = html; this.nodes = []; this.map = new Map();
    const attrs = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']));
    for (const match of html.matchAll(/<(input|select|textarea|button|form|div|span|p|label|small|details|summary|table|thead|tbody|tr|td|th|section|header|footer)\b([^>]*)>/g)) {
      const node = new Element(match[1], attrs(match[2])); this.nodes.push(node);
      if (node.id) this.map.set(`#${node.id}`, node);
      if (node.name) { this.map.set(`[name=${node.name}]`, node); this.map.set(`[name="${node.name}"]`, node); }
      if (node.dataset.money) this.map.set(`[data-money="${node.dataset.money}"]`, node);
    }
    for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
      const a = attrs(match[1]), node = this.map.get(`[name=${a.name}]`);
      if (node) {
        const options = [...match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
        const chosen = options.find((o) => /\bselected\b/.test(o[1])) || options[0];
        node.value = chosen ? attrs(chosen[1]).value ?? chosen[2] : '';
      }
    }
    for (const node of this.nodes.filter((n) => n.tag === 'form')) node.elements = this.nodes.filter((n) => ['input', 'select', 'textarea', 'button'].includes(n.tag));
  }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) {
    if (selector === 'button:not([type="button"])') return this.nodes?.find((n) => n.tag === 'button' && n.type !== 'button');
    if (selector === 'button') return this.nodes?.find((n) => n.tag === 'button');
    if(/^[a-z]+$/.test(selector))return this.nodes?.find(node=>node.tag===selector)||null;
    if (this.map?.has(selector)) return this.map.get(selector);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attr) return this.nodes?.find((node) => attr[1] in node.attrs && (attr[2] == null || node.attrs[attr[1]] === attr[2])) || null;
    for(const child of this.nodes||[]){const found=child.querySelector(selector);if(found)return found;}return null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-f]') return this.nodes?.filter((n) => n.dataset.f) || [];
    if (selector.startsWith('details.ui-menu')) return this.nodes?.filter((n) => n.tag === 'details' && (selector.includes('[open]') ? n.open : true)) || [];
    if (selector === '.subtabs button') return this.nodes?.filter((n) => n.tag === 'button' && n.dataset.i != null) || [];
    return this.nodes?.filter((n) => ['input', 'button'].includes(n.tag)) || [];
  }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  removeEventListener(event,fn){if(this.listeners[event]===fn)delete this.listeners[event];}
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return name in this.attrs; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  closest(selector) { return selector.startsWith(this.tag) ? this : null; }
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false;this.listeners.close?.(); }
  focus() { this.focused = true; }
}
const notifications = new Element(), modalHost = new Element(), timers = [];
const context = createContext({ console, Intl, Date, crypto: webcrypto, URL, URLSearchParams, Blob, confirm: () => true,
  setTimeout: (fn, delay) => { const timer = { fn, delay, cancelled: false }; timers.push(timer); return timer; }, clearTimeout: (timer) => { timer.cancelled = true; },
  document: { body: modalHost, createElement: (tag) => new Element(tag), querySelector: (selector) => selector === '#toasts' ? notifications : null },
  FormData: class { constructor(form) { this.form = form; } *[Symbol.iterator]() { for (const el of this.form.elements) if (el.name && !el.disabled) yield [el.name, el.value]; } },
});
async function moduleAt(path, dependencies = {}) {
  const cache=new Map();
  async function readModule(url){
    if(cache.has(url.href))return cache.get(url.href);
    const module=new SourceTextModule(await readFile(url,'utf8'),{context});cache.set(url.href,module);
    await module.link(async (specifier) => {
    if (dependencies[specifier]) return new SyntheticModule(Object.keys(dependencies[specifier]), function () {
      for (const [key, value] of Object.entries(dependencies[specifier])) this.setExport(key, value);
    }, { context });
      return readModule(new URL(specifier,url));
    });return module;
  }
  const module=await readModule(new URL(path,import.meta.url));
  await module.evaluate(); return module.namespace;
}
const crud = await moduleAt('../js/crud.js');
const cfg = { table: 'transactions', title: 'Transactions', singular: 'transaction', icon: 'finances', workerWrite: true, multi: true, fx: true,
  refs: ['categories'], fields: [{ k: 'amount', label: 'Amount', type: 'money', req: true }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] },
    { k: 'category_id', label: 'Category', type: 'ref', ref: 'categories' }], cols: [{ k: 'amount', label: 'Amount', t: 'money' }], emptyTitle: 'Empty' };
const escape = (s) => String(s ?? '').replace(/"/g, '&quot;');
function fixture({ role = 'manager', existing = [] } = {}) {
  const calls = [], dialog = new Element('dialog'), el = new Element(), messages = [];
  const X = { S: { ws: { id: 'workspace-a', currency: 'KES' }, role, farms: [{ id: 'farm-a', name: 'Farm A' }], farmId: 'all', month: '2026-11' },
    canWrite: () => role !== 'worker', esc: escape, I: () => '', toast: (text) => messages.push(text), money: (minor, code) => `${code}:${minor}`,
    today: () => '2026-11-18', monthRange: () => ['2026-11-01', '2026-12-01'], dlg: () => dialog,
    db: { select: async (table, query) => {
      calls.push(['select', table, query]);
      const params=new URLSearchParams(query),page=rows=>rows.slice(Number(params.get('offset')||0),Number(params.get('offset')||0)+Math.min(1000,Number(params.get('limit')||1000)));
      if (table === 'currencies') return ['KES', 'USD', 'JPY'].map((code) => ({ code }));
      if (table === 'categories') return page([{ id: 'expense-cat', name: 'Feed', kind: 'expense' }, { id: 'income-cat', name: 'Sales', kind: 'income' }]);
      if (table === 'transactions') return page(query.includes('&id=eq.') ? existing.filter((r) => query.includes(`id=eq.${r.id}`)) : existing);
      if (table === 'fx_rates') return [{ rate: 90 }];
      return [];
    }, insert: async (table, payload) => { calls.push(['insert', table, payload]); return payload; },
    update: async (table, id, payload) => { calls.push(['update', table, id, payload]); return payload; },
    upsert: async (table, payload) => { calls.push(['upsert', table, payload]); }, remove: async () => {} } };
  return { X, el, dialog, calls, messages, existing };
}
const change = (dialog, key, value) => { dialog.querySelector(`[name=${key}]`).value = value; };
const submit = (dialog) => dialog.querySelector('#rf').onsubmit({ preventDefault() {}, target: dialog.querySelector('#rf') });
const open = (f) => f.el.querySelector('#add').listeners.click();

test('minor-unit conversion preserves KES cents and zero-decimal currencies', () => {
  assert.equal(crud.minorAmount('12.34', 'KES'), 1234);
  assert.equal(crud.minorAmount('.01', 'USD'), 1);
  assert.equal(crud.minorAmount('123.00', 'UGX'), 123);
  assert.equal(crud.minorAmount('0', 'JPY'), 0);
  for (const [value, currency] of [['1.001', 'KES'], ['1.5', 'JPY'], ['-1', 'KES'], ['1e309', 'KES'], ['9007199254740993', 'UGX']]) assert.throws(() => crud.minorAmount(value, currency));
});
test('reference and register reads are explicitly scoped to the active workspace', async () => {
  const f = fixture(); await crud.resource(f.el, f.X, cfg);
  for (const [, table, query] of f.calls) if (table !== 'currencies') assert.match(query, /workspace_id=eq\.workspace-a/);
});
test('a worker can add transactions while manager-only resources remain read-only', async () => {
  const f = fixture({ role: 'worker' }); await crud.resource(f.el, f.X, cfg);
  assert.ok(f.el.querySelector('#add'));
  await crud.resource(f.el, f.X, { ...cfg, workerWrite: false });
  assert.equal(f.el.querySelector('#add'), null);
});
test('save persists exact minor units and ignores a repeated submit while pending', async () => {
  const f = fixture(); let finish; const wait = new Promise((resolve) => { finish = resolve; });
  f.X.db.insert = async (table, payload) => { f.calls.push(['insert', table, payload]); await wait; return payload; };
  await crud.resource(f.el, f.X, cfg); open(f); change(f.dialog, 'amount', '12.34');
  const saving = submit(f.dialog); await submit(f.dialog);
  assert.equal(f.calls.filter(([type]) => type === 'insert').length, 1);
  assert.equal(f.calls.find(([type]) => type === 'insert')[2].amount, 1234);
  finish(); await saving;
});
test('manual retry recovers only this form’s exact client ID after a lost response', async () => {
  const f = fixture(); f.X.db.insert = async (table, payload) => { f.calls.push(['insert', table, payload]); f.existing.push(payload); throw new Error('Connection lost'); };
  await crud.resource(f.el, f.X, cfg); open(f); change(f.dialog, 'amount', '10');
  await submit(f.dialog); await submit(f.dialog);
  assert.equal(f.calls.filter(([type]) => type === 'insert').length, 1);
  const inserted = f.calls.find(([type]) => type === 'insert')[2];
  assert.equal(f.calls.find(([type]) => type === 'update')[2], inserted.id);
  assert.ok(f.calls.some(([type, table, query]) => type === 'select' && table === 'transactions' && query.includes(`workspace_id=eq.workspace-a&id=eq.${inserted.id}`)));
});
test('invalid amounts, mismatched categories and workspace changes block writes', async () => {
  const f = fixture(); await crud.resource(f.el, f.X, cfg); open(f);
  change(f.dialog, 'amount', '1.001'); await submit(f.dialog); assert.match(f.dialog.querySelector('#rmsg').textContent, /decimal/);
  change(f.dialog, 'amount', '12'); change(f.dialog, 'category_id', 'income-cat'); await submit(f.dialog); assert.match(f.dialog.querySelector('#rmsg').textContent, /expense category/);
  change(f.dialog, 'category_id', 'expense-cat'); f.X.S.ws = { id: 'workspace-b', currency: 'USD' }; await submit(f.dialog);
  assert.match(f.dialog.querySelector('#rmsg').textContent, /workspace or permissions changed/);
  assert.equal(f.calls.filter(([type]) => ['insert', 'update'].includes(type)).length, 0);
});
test('currency changes clear stale FX and retain minor-unit exponent scaling', async () => {
  const f = fixture({ existing: [{ id: 'tx-1', amount: 10000, currency: 'USD', fx_rate: 129, kind: 'expense', category_id: 'expense-cat', farm_id: 'farm-a' }] });
  await crud.resource(f.el, f.X, cfg);
  const button = new Element('button', { 'data-e': 'tx-1' }); await f.el.querySelector('#tbl').onclick({ target: button });
  change(f.dialog, 'currency', 'JPY'); await f.dialog.querySelector('[name=currency]').listeners.change();
  assert.equal(f.dialog.querySelector('[name=fx]').value, 0.9);
  change(f.dialog, 'amount', '100'); await submit(f.dialog);
  const update = f.calls.find(([type]) => type === 'update')[3];
  assert.equal(update.amount, 100); assert.equal(update.fx_rate, 90);
  assert.ok(f.calls.some(([type, table, query]) => type === 'select' && table === 'fx_rates' && query.includes('workspace_id=eq.workspace-a')));
});

const modules = await moduleAt('../js/modules.js', { './crud.js': { resource: async () => {} }, './finance.js': { budget: async () => {}, recurring: async () => {}, CAT: {} } });
test('daily and monthly routines reopen by Nairobi calendar without changing one-time tasks', () => {
  const task = { status: 'done', done_at: '2026-11-17T22:00:00Z' }; // 18 Nov in Nairobi
  assert.equal(modules.taskStatus({ ...task, cadence: 'daily' }, '2026-11-18'), 'done');
  assert.equal(modules.taskStatus({ ...task, cadence: 'daily' }, '2026-11-19'), 'open');
  assert.equal(modules.taskStatus({ ...task, cadence: 'monthly' }, '2026-11-30'), 'done');
  assert.equal(modules.taskStatus({ ...task, cadence: 'monthly' }, '2026-12-01'), 'open');
  assert.equal(modules.taskStatus({ status: 'done', cadence: 'once' }, '2026-12-01'), 'done');
  assert.equal(modules.taskStatus({ status: 'done', cadence: 'daily' }, '2026-11-18'), 'open');
});
test('budget reads stay in one workspace and invalid fractional minor units never write', async () => {
  const finance = await moduleAt('../js/finance.js', { './crud.js': { resource: async () => {}, minorAmount: crud.minorAmount } });
  const f = fixture(); f.X.S.farmId = 'farm-a'; await finance.budget(f.el, f.X);
  for (const [type, , query] of f.calls) if (type === 'select') assert.match(query, /workspace_id=eq\.workspace-a/);
  const input = new Element('input', { 'data-c': 'expense-cat' }); input.value = '1.001';
  await f.el.onchange({ target: input });
  assert.equal(f.calls.filter(([type]) => type === 'upsert').length, 0);
  assert.match(f.messages.at(-1), /decimal/);
});

test('resource pages, sorts numeric amounts, searches and selects rows across the shared table', async () => {
  const existing = Array.from({ length: 60 }, (_, index) => ({ id: `row-${index + 1}`, amount: 60 - index, currency: 'KES', description: `Note ${index + 1}` }));
  const f = fixture({ existing }); await crud.resource(f.el, f.X, { ...cfg, search: ['description'], cols: [...cfg.cols, { k: 'description', label: 'Description' }] });
  assert.match(f.el.querySelector('#pagination').innerHTML, /1–25 of 60 records/);
  assert.ok(f.el.querySelector('#tbl').innerHTML.includes('data-row="row-25"'));
  assert.ok(!f.el.querySelector('#tbl').innerHTML.includes('data-row="row-26"'));
  f.el.onclick({ target: new Element('button', { 'data-page': '2' }) });
  assert.match(f.el.querySelector('#pagination').innerHTML, /26–50 of 60 records/);
  await f.el.querySelector('#tbl').onclick({ target: new Element('button', { 'data-sort': 'amount' }) });
  const check = new Element('input', { 'data-select-row': 'row-40' }); check.checked = true;
  f.el.querySelector('#tbl').onchange({ target: check });
  assert.equal(f.el.querySelector('#bulkbar').hidden, false);
  assert.match(f.el.querySelector('#bulkbar').innerHTML, /1 selected/);
  f.el.querySelector('#q').oninput({ target: { value: 'Note 40' } });
  assert.match(f.el.querySelector('#pagination').innerHTML, /1–1 of 1 records/);
  assert.ok(f.el.querySelector('#tbl').innerHTML.includes('data-row="row-40"'));
  assert.equal(f.el.querySelector('#bulkbar').hidden, true);
  assert.match(f.el.querySelector('#chips').innerHTML, /Search: note 40/);
});
test('read-only record details use a drawer without exposing edit or submit actions', async () => {
  const f = fixture({ existing: [{ id: 'row-1', amount: 1000, currency: 'KES' }] });
  f.X.permissions = { canReadModule: () => true, canWriteModule: () => false, canDeleteModule: () => false };
  await crud.resource(f.el, f.X, cfg);
  await f.el.querySelector('#tbl').onclick({ target: new Element('button', { 'data-v': 'row-1' }) });
  assert.match(f.dialog.attrs.class, /ui-drawer/);
  assert.equal(f.dialog.querySelector('[name=amount]').disabled, true);
  assert.equal(f.dialog.querySelector('#edit-detail'), null);
  assert.equal(f.dialog.querySelector('button:not([type="button"])'), undefined);
});
test('duplicate pre-fills a new drawer and creates a fresh ID rather than editing the source', async () => {
  const f = fixture({ existing: [{ id: 'row-1', farm_id: 'farm-a', amount: 1234, currency: 'KES', kind: 'expense' }] });
  await crud.resource(f.el, f.X, cfg);
  await f.el.querySelector('#tbl').onclick({ target: new Element('button', { 'data-copy': 'row-1' }) });
  assert.equal(Number(f.dialog.querySelector('[name=amount]').value), 12.34);
  await submit(f.dialog);
  const insert = f.calls.find(([type]) => type === 'insert');
  assert.ok(insert); assert.notEqual(insert[2].id, 'row-1'); assert.equal(insert[2].amount, 1234);
  assert.equal(f.calls.some(([type]) => type === 'update'), false);
});
test('delete Undo cancels before a destructive database request is sent', async () => {
  const f = fixture({ existing: [{ id: 'row-1', amount: 100, currency: 'KES' }] }); let deletes = 0;
  f.X.db.remove = async () => { deletes += 1; };
  await crud.resource(f.el, f.X, cfg);
  const start = timers.length;
  const deleting = f.el.querySelector('#tbl').onclick({ target: new Element('button', { 'data-d': 'row-1' }) });
  const modal = modalHost.children.at(-1); modal.querySelector('[data-confirm-yes]').listeners.click(); await deleting;
  assert.equal(deletes, 0);
  const notification = notifications.children.at(-1);
  notification.querySelector('[data-toast-action]').listeners.click();
  for (const timer of timers.slice(start)) if (!timer.cancelled) await timer.fn();
  assert.equal(deletes, 0);
  assert.ok(f.el.querySelector('#tbl').innerHTML.includes('data-row="row-1"'));
});
test('shared report buttons call the module report entry point only when allowed', async () => {
  const f = fixture(); let report;
  f.X.report = (key) => { report = key; }; f.X.canReport = () => true;
  await crud.resource(f.el, f.X, cfg); f.el.querySelector('#module-report').listeners.click();
  assert.equal(report, 'finances');
  f.X.canReport = () => false; await crud.resource(f.el, f.X, cfg);
  assert.equal(f.el.querySelector('#module-report'), null);
});
test('shared controls escape text, merge classes and retain accessible tab/field relationships', async () => {
  const c = await moduleAt('../js/components.js');
  const button = c.button({ label: '<Save>', attrs: { class: 'menu-button', onclick: 'alert(1)', 'aria-label': 'Save "record"' } });
  assert.match(button, /menu-button/); assert.equal((button.match(/ class=/g) || []).length, 1);
  assert.ok(!button.includes('onclick=')); assert.ok(button.includes('&lt;Save&gt;')); assert.ok(button.includes('&quot;record&quot;'));
  const field = c.field({ id: 'email', name: 'email', label: 'Email', required: true, error: 'Check email' });
  assert.ok(field.includes('for="email"')); assert.ok(field.includes('aria-describedby="email-error"')); assert.ok(field.includes('aria-invalid="true"'));
  const tabs = c.tabs([{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }], { active: 'two' });
  assert.match(tabs, /data-tab="two" aria-selected="true" tabindex="0"/);
  const table = c.dataTable({ columns: [{ key: 'name', label: 'Name' }], rows: [{ id: 'r', name: '<img src=x>' }] });
  assert.ok(table.includes('&lt;img src=x&gt;')); assert.ok(table.includes('data-label="Name"'));
});
test('worker module permissions do not grant enterprise definition writes without workerWrite', async () => {
  const f = fixture({ role: 'worker' });
  f.X.permissions = { canReadModule: () => true, canWriteModule: () => true, canDeleteModule: () => false };
  await crud.resource(f.el, f.X, { ...cfg, table: 'enterprises', module: 'livestock', workerWrite: false, multi: false, refs: [] });
  assert.equal(f.el.querySelector('#add'), null);
  await crud.resource(f.el, f.X, { ...cfg, table: 'enterprise_records', module: 'livestock', workerWrite: true, multi: false, refs: [] });
  assert.ok(f.el.querySelector('#add'));
});
test('a farm-scoped manager can edit assigned farms but cannot add or duplicate farms', async () => {
  const f = fixture(); f.X.S.farmIds = ['farm-a'];
  f.X.permissions = { canReadModule: () => true, canWriteModule: () => true, canDeleteModule: () => true };
  f.X.db.select = async (_table,query) => Number(new URLSearchParams(query).get('offset')||0)?[]:[{ id: 'farm-a', name: 'Farm A', workspace_id: 'workspace-a' }];
  await crud.resource(f.el, f.X, { table: 'farms', module: 'farms', farmScoped: false, title: 'Farms', singular: 'farm', fields: [{ k: 'name', label: 'Name', req: true }], cols: [{ k: 'name', label: 'Name' }] });
  assert.equal(f.el.querySelector('#add'), null);
  assert.ok(f.el.querySelector('#tbl').innerHTML.includes('data-e="farm-a"'));
  assert.ok(!f.el.querySelector('#tbl').innerHTML.includes('data-copy='));
});
test('enterprise-linked transactions reject a link on a different farm before saving', async () => {
  const f = fixture(), select = f.X.db.select;
  f.X.db.select = (table, query) => table === 'enterprises' ? Number(new URLSearchParams(query).get('offset')||0)?[]:[{ id: 'enterprise-b', name: 'Other farm crops', farm_id: 'farm-b' }] : select(table, query);
  await crud.resource(f.el, f.X, { ...cfg, refs: [...cfg.refs, 'enterprises'], fields: [...cfg.fields, { k: 'enterprise_id', label: 'Enterprise', type: 'ref', ref: 'enterprises' }] });
  open(f); change(f.dialog, 'amount', '10'); change(f.dialog, 'enterprise_id', 'enterprise-b'); await submit(f.dialog);
  assert.match(f.dialog.querySelector('#rmsg').textContent, /enterprise on the selected farm/);
  assert.equal(f.calls.some(([operation]) => operation === 'insert'), false);
});

test('typing validates money, required text, email, numeric limits and calendar dates inline',async()=>{
  const f=fixture();
  await crud.resource(f.el,f.X,{...cfg,fx:false,fields:[{k:'name',label:'Name',req:true},{k:'email',label:'Email',type:'email'},{k:'amount',label:'Amount',type:'money'},
    {k:'day',label:'Day',type:'number',min:1,max:28,step:1},{k:'date',label:'Date',type:'date'}]});open(f);
  const form=f.dialog.querySelector('#rf');
  for(const [key,value,expected] of [['name','   ',/Enter name/],['email','invalid@',/email address/],['amount','1.001',/decimal/],['day','29',/between 1 and 28/],['date','2026-02-31',/valid date/]]){
    change(f.dialog,key,value);form.listeners.input({target:f.dialog.querySelector(`[name=${key}]`)});
    const error=f.dialog.querySelector(`[data-error-for="${key}"]`);assert.match(error.textContent,expected);assert.equal(error.hidden,false);
  }
  change(f.dialog,'amount','1.00');form.listeners.input({target:f.dialog.querySelector('[name=amount]')});
  assert.equal(f.dialog.querySelector('[data-error-for="amount"]').hidden,true);
  assert.equal(f.calls.some(([type])=>type==='insert'),false);
});

test('quick task changes appear immediately, reject duplicate clicks and roll back after a failed save',async()=>{
  const f=fixture({existing:[{id:'task-a',status:'open',name:'Check water'}]});let reject;
  const waiting=new Promise((_resolve,rejection)=>{reject=rejection;});
  f.X.db.update=async(table,id,patch)=>{f.calls.push(['update',table,id,patch]);await waiting;};
  await crud.resource(f.el,f.X,{table:'tasks',title:'Tasks',singular:'task',icon:'daily',load:async()=>f.existing,fields:[],cols:[{k:'name',label:'Name'},{k:'status',label:'Status',t:'badge'}],
    quick:r=>r.status==='open'?{label:'Mark done',patch:{status:'done'}}:{label:'Reopen',patch:{status:'open'}}});
  const control=new Element('button',{'data-q':'task-a'}),table=f.el.querySelector('#tbl');
  const saving=table.onclick({target:control});
  assert.match(table.innerHTML,/>done</);assert.match(table.innerHTML,/Saving…/);
  await table.onclick({target:control});assert.equal(f.calls.filter(([type])=>type==='update').length,1);
  reject(new Error('No connection'));await saving;
  assert.match(table.innerHTML,/>open</);assert.match(table.innerHTML,/Mark done/);assert.match(f.messages.at(-1),/wasn’t saved.*No connection/);
});

test('quick task success keeps its confirmed patch without another list read',async()=>{
  const f=fixture({existing:[{id:'task-a',status:'open',name:'Check water'}]});
  await crud.resource(f.el,f.X,{table:'tasks',title:'Tasks',singular:'task',icon:'daily',load:async()=>f.existing,fields:[],cols:[{k:'status',label:'Status',t:'badge'}],quick:()=>({label:'Mark done',patch:{status:'done'}})});
  const reads=f.calls.filter(([type])=>type==='select').length;
  await f.el.querySelector('#tbl').onclick({target:new Element('button',{'data-q':'task-a'})});
  assert.match(f.el.querySelector('#tbl').innerHTML,/>done</);assert.equal(f.calls.filter(([type])=>type==='select').length,reads);assert.match(f.messages.at(-1),/Task updated/);
});

test('dashboard drill filters scope exact records and completion dates before loading and can be cleared',async()=>{
  const f=fixture(),id='650e8400-e29b-41d4-a716-446655440000';f.X.filters={id,completed_on:'2026-11-18',q:'water',status:'done'};
  await crud.resource(f.el,f.X,{table:'tasks',title:'Tasks',singular:'task',icon:'daily',fields:[],cols:[{k:'status',label:'Status'}],filters:[{k:'status',label:'Status',options:['open','done']}]});
  const query=f.calls.find(([type,table])=>type==='select'&&table==='tasks')[2];
  assert.match(query,/id=eq\.650e8400/);assert.match(decodeURIComponent(query),/done_at=gte\.2026-11-17T21:00:00\.000Z&done_at=lt\.2026-11-18T21:00:00\.000Z/);
  assert.equal(f.el.querySelector('#q').value,'water');assert.match(f.el.querySelector('#chips').innerHTML,/Completed on: 2026-11-18/);
  f.el.onclick({target:new Element('button',{'data-remove-filter':'__server_completed_on'})});
  await new Promise(setImmediate);
  const latest=f.calls.filter(([type,table])=>type==='select'&&table==='tasks').at(-1)[2];assert.doesNotMatch(latest,/done_at=/);assert.match(latest,/id=eq/);
});

test('untrusted drill identifiers and unsupported source filters never enter REST queries',async()=>{
  const f=fixture();f.X.filters={id:'other&workspace_id=neq.current',enterprise_id:'bad',source_type:'not-a-source',status:'not-a-status'};
  await crud.resource(f.el,f.X,cfg);
  const query=f.calls.find(([type,table])=>type==='select'&&table==='transactions')[2];
  assert.doesNotMatch(query,/source_type|enterprise_id|&id=|neq.current/);
});

test('secondary resource features remain reachable from More actions and filter and column sheets',async()=>{
  const f=fixture({existing:[{id:'tx-1',amount:100,currency:'KES',kind:'expense'}]});
  await crud.resource(f.el,f.X,{...cfg,filters:[{k:'kind',label:'Type',options:['income','expense']}]});
  assert.match(f.el.innerHTML,/ui-menu-text/);assert.ok(f.el.querySelector('#csv'));assert.ok(f.el.querySelector('#columns-open'));assert.ok(f.el.querySelector('#add'));
  f.el.querySelector('#filters-open').listeners.click();assert.match(f.dialog.attrs.class,/ui-panel-sheet/);
  const form=f.dialog.querySelector('form'),kind=f.dialog.querySelector('[name=kind]');kind.value='income';form.onsubmit({preventDefault(){},target:form});
  assert.match(f.el.querySelector('#chips').innerHTML,/Type: income/);assert.equal(f.dialog.open,false);
  f.el.onclick({target:new Element('button',{'data-remove-filter':'kind'})});assert.doesNotMatch(f.el.querySelector('#chips').innerHTML,/Type: income/);assert.match(f.el.querySelector('#tbl').innerHTML,/tx-1/);
  f.el.querySelector('#columns-open').listeners.click();assert.match(f.dialog.innerHTML,/data-panel-column/);
  assert.match(f.dialog.innerHTML,/Amount/);assert.equal(f.dialog.open,true);
});

test('all optional fields remain in More options and a saved advanced value opens them on edit',async()=>{
  const f=fixture({existing:[{id:'tx-1',amount:100,currency:'KES',notes:'Keep this detail'}]});
  await crud.resource(f.el,f.X,{...cfg,fields:[...cfg.fields,{k:'notes',label:'Notes',type:'textarea'}]});
  open(f);assert.match(f.dialog.innerHTML,/<details class="ui-disclosure"><summary>More options/);
  assert.ok(f.dialog.querySelector('[name=notes]'));assert.ok(f.dialog.querySelector('[name=currency]'));assert.ok(f.dialog.querySelector('[name=amount]'));
  await f.el.querySelector('#tbl').onclick({target:new Element('button',{'data-e':'tx-1'})});
  assert.match(f.dialog.innerHTML,/<details class="ui-disclosure" open="">/);assert.match(f.dialog.innerHTML,/Keep this detail/);
});

test('an exact accessible recent record opens details and records the viewed row without creating one',async()=>{
  const id='650e8400-e29b-41d4-a716-446655440000',f=fixture({existing:[{id,amount:100,currency:'KES'}]}),views=[];
  f.X.filters={id,view:'1'};f.X.onViewed=view=>views.push(view);await crud.resource(f.el,f.X,cfg);
  assert.equal(f.dialog.open,true);assert.match(f.dialog.innerHTML,/View transaction/);assert.equal(views[0].row.id,id);assert.equal(views[0].mode,'view');
  assert.equal(f.calls.some(([type])=>type==='insert'),false);
});

test('CSV neutralizes spreadsheet formulas in text while preserving real negative numbers',async()=>{
  const c=await moduleAt('../js/components.js');
  for(const value of ['=HYPERLINK("bad")','+SUM(1,2)','-1+2','@SUM(A1)','\tformula','\rformula','  =1+1'])assert.ok(c.csvCell(value).startsWith('"\''));
  assert.equal(c.csvCell(-1250),'-1250');assert.equal(c.csvCell('Milk sales'),'"Milk sales"');assert.equal(c.csvCell('a"b'),'"a""b"');
});

test('the shared panel changes presentation cleanly and external close resolves confirmations',async()=>{
  const c=await moduleAt('../js/components.js'),dialog=new Element('dialog');
  c.openPanel(dialog,{presentation:'sheet',title:'Filters',body:'Content'});assert.match(dialog.attrs.class,/ui-panel-sheet/);
  c.openPanel(dialog,{presentation:'drawer',title:'Record',body:'Content'});assert.doesNotMatch(dialog.attrs.class,/ui-panel-sheet/);assert.match(dialog.attrs.class,/ui-drawer/);
  const confirmation=c.confirmDialog({title:'Discard?',text:'Unsaved record'});modalHost.children.at(-1).close();assert.equal(await confirmation,false);
});

test('bulk deletion stops before the next record when the account changes during a request',async()=>{
  const f=fixture({existing:[{id:'row-1',amount:100,currency:'KES'},{id:'row-2',amount:200,currency:'KES'}]}),removed=[];let uid='first',release;
  f.X.uid=()=>uid;const waiting=new Promise(resolve=>{release=resolve;});f.X.db.remove=async(_table,id)=>{removed.push(id);await waiting;};
  await crud.resource(f.el,f.X,cfg);const table=f.el.querySelector('#tbl');
  for(const id of ['row-1','row-2']){const checkbox=new Element('input',{'data-select-row':id});checkbox.checked=true;table.onchange({target:checkbox});}
  f.el.onclick({target:new Element('button',{'data-bulk-delete':''})});modalHost.children.at(-1).querySelector('[data-confirm-yes]').listeners.click();await new Promise(setImmediate);
  const timer=timers.filter(timer=>timer.delay===6000&&!timer.cancelled).at(-1),deleting=timer.fn();assert.deepEqual(removed,['row-1']);uid='second';release();await deleting;
  assert.deepEqual(removed,['row-1']);assert.equal(f.messages.length,0,'A stale account action must not announce changes in the new account.');
});

test('Workers and Recurring do not post prepared payments after switching account in the same workspace',async()=>{
  const c=await moduleAt('../js/components.js');
  for(const kind of ['workers','recurring']){
    const f=fixture();let uid='first',release;f.X.uid=()=>uid;f.X.monthLabel=()=> 'November 2026';let inserted=0;
    const waiting=new Promise(resolve=>{release=resolve;});
    f.X.db.select=async(table,query)=>Number(new URLSearchParams(query).get('offset')||0)?[]:table==='fx_rates'?(await waiting,[{rate:129}]):table==='workers'?[{id:'worker-1',full_name:'A',pay_amount:100,pay_frequency:'monthly',currency:'USD'}]:table==='recurring_payments'?[{id:'recurring-1',name:'Rent',amount:100,day_of_month:1,currency:'USD'}]:[];
    f.X.db.insertMany=async()=>{inserted++;};
    const resource=async(el,_X,config)=>{el.innerHTML=c.actionMenu({items:config.moreActions||[]});};
    const view=kind==='workers'?await moduleAt('../js/modules.js',{'./crud.js':{resource},'./finance.js':{budget:async()=>{},recurring:async()=>{},CAT:{}}}):await moduleAt('../js/finance.js',{'./crud.js':{resource,minorAmount:crud.minorAmount}});
    await view[kind](f.el,f.X);const button=f.el.querySelector(kind==='workers'?'#post':'#postr'),posting=button.listeners.click({currentTarget:button});
    await new Promise(setImmediate);uid='second';release();await posting;assert.equal(inserted,0,kind);assert.equal(f.messages.length,0,kind);
  }
});

test('a checklist run created for the previous account is not followed by a new-account tick',async()=>{
  const f=fixture();let uid='first',release;f.X.uid=()=>uid;f.X.db.select=async()=>[];const waiting=new Promise(resolve=>{release=resolve;});let ticks=0;
  f.X.db.insert=async()=>{await waiting;return{id:'run-1'};};f.X.db.upsert=async()=>{ticks++;};
  await modules.moduleViews.checklists(f.el,f.X);const checkbox=new Element('input',{type:'checkbox','data-l':'list-1','data-i':'item-1'});checkbox.checked=true;
  const saving=f.el.onchange({target:checkbox});await new Promise(setImmediate);uid='second';release();await saving;assert.equal(ticks,0);assert.equal(f.messages.length,0);
});

test('a1001-row register and its references load completely even when the server returns only127 rows',async()=>{
  const f=fixture({existing:Array.from({length:1001},(_,i)=>({id:`tx-${i}`,amount:100,currency:'KES'}))}),select=f.X.db.select;
  f.X.db.select=async(table,query)=>(await select(table,query)).slice(0,127);
  await crud.resource(f.el,f.X,{...cfg,summary:rows=>`Complete count ${rows.length}`});
  assert.match(f.el.querySelector('#pagination').innerHTML,/of 1001 records/);assert.equal(f.el.querySelector('#sum').innerHTML,'Complete count 1001');
  assert.ok(f.calls.some(([,table,q])=>table==='transactions'&&new URLSearchParams(q).get('offset')==='1001'));
});

test('a10001-row capped register never presents its loaded subset as a financial total',async()=>{
  const f=fixture({existing:Array.from({length:10001},(_,i)=>({id:`tx-${i}`,amount:100,currency:'KES'}))});let summed=0;
  await crud.resource(f.el,f.X,{...cfg,summary:()=>{summed++;return 'Wrong complete total';}});
  assert.equal(summed,0);assert.match(f.el.querySelector('#sum').innerHTML,/Totals unavailable/);assert.match(f.el.querySelector('#pagination').innerHTML,/First 10,000 loaded/);
  assert.equal(f.el.querySelector('#csv').textContent,'Export loaded CSV (partial)');
});

test('a reference beyond the first1000 options remains selected when another field is edited',async()=>{
  const f=fixture({existing:[{id:'tx',amount:100,currency:'KES',kind:'expense',vendor_id:'vendor-1000'}]}),select=f.X.db.select,vendors=Array.from({length:1001},(_,i)=>({id:`vendor-${i}`,name:`Vendor ${i}`}));
  f.X.db.select=async(table,query)=>{if(table!=='vendors')return select(table,query);const p=new URLSearchParams(query),offset=Number(p.get('offset')||0);return vendors.slice(offset,offset+Math.min(333,Number(p.get('limit')||1000)));};
  await crud.resource(f.el,f.X,{...cfg,refs:['vendors'],fields:[...cfg.fields.filter(field=>field.k!=='category_id'),{k:'vendor_id',label:'Vendor',type:'ref',ref:'vendors'}]});
  await f.el.querySelector('#tbl').onclick({target:new Element('button',{'data-e':'tx'})});assert.equal(f.dialog.querySelector('[name=vendor_id]').value,'vendor-1000');change(f.dialog,'amount','2');await submit(f.dialog);
  assert.equal(f.calls.find(([type])=>type==='update')[3].vendor_id,'vendor-1000');
});

test('legacy month closing uses every matching transaction and never leaves a stale Close action after a failed page',async()=>{
  const finance=await moduleAt('../js/finance.js',{'./crud.js':{resource:async()=>{},minorAmount:crud.minorAmount}});
  const f=fixture({existing:Array.from({length:1001},(_,i)=>({id:`tx-${i}`,kind:'income',category_id:'income-cat',amount_base:100,currency:'KES'}))});f.X.S.farmId='farm-a';
  await finance.budget(f.el,f.X);assert.match(f.el.innerHTML,/:100100/);await f.el.onclick({target:new Element('button',{id:'close'})});
  assert.equal(f.calls.find(([type,table])=>type==='upsert'&&table==='month_closings')[2].closing_cash,100100);
  const failed=fixture({existing:f.existing}),select=failed.X.db.select;failed.X.S.farmId='farm-a';failed.el.innerHTML='<button id="close">Old close</button>';failed.el.onclick=()=>{throw new Error('Stale close');};
  failed.X.db.select=async(table,query)=>{if(table==='transactions'&&Number(new URLSearchParams(query).get('offset'))>=1000)throw new Error('Second page failed');return select(table,query);};
  await assert.rejects(finance.budget(failed.el,failed.X),/Second page failed/);assert.equal(failed.el.querySelector('#close'),null);assert.equal(failed.el.onclick,null);assert.equal(failed.calls.some(([type])=>type==='upsert'),false);
});

function monthResult(){return{schema_version:'20261118-finance',period:{from:'2026-11-01',to:'2026-12-01'},currency:'KES',totals:{income:123456,expenses:50000,net:73456,opening:1000,calculated_closing:74456,saved_closing:null,opening_recorded:true},categories:[{id:'expense-cat',name:'Feed',kind:'expense',budget:40000,actual:50000,variance:-10000,pct:125,over_budget:true,can_budget:true},{id:'legacy',name:'Legacy category',kind:'unknown',budget:70,actual:0,variance:null,pct:null,over_budget:false,can_budget:false}],sections:{income:{budget:0,actual:123456},expense:{budget:40000,actual:50000},unknown:{budget:70,actual:0}}};}
test('upgraded budgets render database figures and close atomically without sending a calculated balance',async()=>{
  const finance=await moduleAt('../js/finance.js',{'./crud.js':{resource:async()=>{},minorAmount:crud.minorAmount}}),f=fixture(),rpc=[];f.X.S.farmId='farm-a';f.X.migrationReady=true;let data=monthResult();
  f.X.db.select=async()=>{throw new Error('Must not calculate upgraded balances from REST rows');};
  f.X.db.rpc=async(name,args)=>{rpc.push({name,args});if(name==='fw_close_month')data={...data,totals:{...data.totals,net:80000,calculated_closing:81000,saved_closing:81000}};return data;};
  await finance.budget(f.el,f.X);assert.match(f.el.innerHTML,/:74456/);assert.match(f.el.innerHTML,/Unclassified records/);assert.equal(f.el.querySelector('[data-c="legacy"]'),null);
  await f.el.onclick({target:new Element('button',{id:'close'})});const close=rpc.find(call=>call.name==='fw_close_month');assert.equal(close.args.p_month,'2026-11-01');assert.equal('closing_cash' in close.args,false);assert.match(f.el.innerHTML,/:81000/);assert.equal(f.calls.some(([type])=>type==='upsert'),false);
});
test('failed upgraded month RPC has no browser-calculated fallback and broader direct ranges cannot close a month',async()=>{
  const finance=await moduleAt('../js/finance.js',{'./crud.js':{resource:async()=>{},minorAmount:crud.minorAmount}}),f=fixture();f.X.S.farmId='farm-a';f.X.migrationReady=true;
  f.X.db.rpc=async()=>{throw new Error('Database offline');};await assert.rejects(finance.budget(f.el,f.X),/Database offline/);assert.equal(f.el.querySelector('#close'),null);assert.equal(f.calls.length,0);
  f.X.monthRange=()=>['2026-09-01','2026-12-01'];f.X.db.rpc=async(_name,args)=>{assert.equal(args.p_month,'2026-11-01');return monthResult();};await finance.budget(f.el,f.X);
  assert.match(f.el.innerHTML,/November 2026 only/);assert.equal(f.el.querySelector('#close'),null);assert.equal(f.el.querySelector('#copy'),null);
});

test('pay and recurring posting page both source and posted IDs and use only the selected calendar month',async()=>{
  const c=await moduleAt('../js/components.js');
  for(const kind of ['workers','recurring']){
    const f=fixture(),sources=Array.from({length:1002},(_,i)=>({id:`source-${i}`,full_name:`Worker ${i}`,name:`Payment ${i}`,pay_amount:100,pay_frequency:'monthly',amount:100,currency:'KES',kind:'expense',day_of_month:1})),done=sources.slice(0,1001).map((r,i)=>({id:`posted-${i}`,source_id:r.id})),inserted=[];
    f.X.monthRange=()=>['2026-09-01','2026-12-01'];f.X.db.select=async(table,query)=>{const p=new URLSearchParams(query),offset=Number(p.get('offset')||0),rows=table==='transactions'?done:['workers','recurring_payments'].includes(table)?sources:[];return rows.slice(offset,offset+Math.min(250,Number(p.get('limit')||1000)));};
    f.X.db.insertMany=async(_table,rows)=>inserted.push(...rows);const resource=async(el,_X,config)=>{el.innerHTML=c.actionMenu({items:config.moreActions||[]});};
    const view=kind==='workers'?await moduleAt('../js/modules.js',{'./crud.js':{resource},'./finance.js':{budget:async()=>{},recurring:async()=>{},CAT:{}}}):await moduleAt('../js/finance.js',{'./crud.js':{resource,minorAmount:crud.minorAmount}});
    await view[kind](f.el,f.X);const button=f.el.querySelector(kind==='workers'?'#post':'#postr');await button.listeners.click({currentTarget:button});assert.equal(inserted.length,1,kind);assert.equal(inserted[0].source_id,'source-1001');assert.equal(inserted[0].source_period,'2026-11-01');assert.equal(inserted[0].txn_date,kind==='workers'?'2026-11-30':'2026-11-01');
  }
});

test('database transaction totals follow current filters, cache unchanged views and ignore stale search responses',async()=>{
  const f=fixture({existing:[{id:'tx',amount:100,currency:'KES',description:'beta'}]}),pending=[];f.X.migrationReady=true;
  f.X.db.rpc=(name,args)=>new Promise((resolve,reject)=>pending.push({name,args,resolve,reject}));
  await crud.resource(f.el,f.X,{...cfg,summaryRpc:'fw_transaction_totals',summary:()=>{throw new Error('Do not sum upgraded rows');},search:['description']});
  for(const value of ['alpha','beta'])f.el.querySelector('#q').oninput({target:{value}});
  const result=value=>({schema_version:'20261118-finance',income:value,expenses:0,net:value,count:1});pending[2].resolve(result(222));await new Promise(setImmediate);pending[1].resolve(result(111));pending[0].resolve(result(333));await new Promise(setImmediate);
  assert.match(f.el.querySelector('#sum').innerHTML,/:222/);assert.doesNotMatch(f.el.querySelector('#sum').innerHTML,/:111|:333/);assert.equal(pending[2].args.p_filters.q,'beta');
  await f.el.querySelector('#tbl').onclick({target:new Element('button',{'data-sort':'amount'})});assert.equal(pending.length,3);
  f.el.querySelector('#q').oninput({target:{value:'error'}});pending[3].reject(new Error('RPC failed'));await new Promise(setImmediate);assert.match(f.el.querySelector('#sum').innerHTML,/Totals unavailable/);assert.doesNotMatch(f.el.querySelector('#sum').innerHTML,/:222/);
  f.el.onclick({target:new Element('button',{'data-summary-retry':''})});pending[4].resolve(result(999));await new Promise(setImmediate);assert.match(f.el.querySelector('#sum').innerHTML,/:999/);
});

test('operational module lists retain all1001 redacted TABLE RPC rows without reading protected base tables',async()=>{
  const views=await moduleAt('../js/modules.js',{'./crud.js':{resource:crud.resource},'./finance.js':{budget:async()=>{},recurring:async()=>{},CAT:{}}});
  for(const key of ['workers','infrastructure']){const f=fixture({role:'worker'}),rows=Array.from({length:1001},(_,i)=>({id:`record-${i}`,workspace_id:'workspace-a',farm_id:'farm-a',full_name:`Worker ${i}`,name:`Project ${i}`,role:'field_hand',status:'active',active:true})),calls=[];
    f.X.migrationReady=true;f.X.permissions={has:()=>false};f.X.db.select=async()=>{throw new Error('Protected base table must not be read');};f.X.db.rpc=async(name,args,query)=>{const p=new URLSearchParams(query),offset=Number(p.get('offset')||0);calls.push({name,args,offset});return rows.slice(offset,offset+Math.min(250,Number(p.get('limit')||1000)));};
    await views[key](f.el,f.X);assert.match(f.el.querySelector('#pagination').innerHTML,/of 1001 records/);assert.equal(calls.at(-1).offset,1001);assert.equal(calls[0].args.p_workspace_id,'workspace-a');
  }
});
