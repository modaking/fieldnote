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
    this.value = attrs.value || ''; this.disabled = false; this.textContent = ''; this.type = attrs.type;
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) this.dataset[key.slice(5)] = value;
    this.id = attrs.id; this.name = attrs.name;
  }
  set innerHTML(html) {
    this.html = html; this.nodes = []; this.map = new Map();
    const attrs = (text) => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']));
    for (const match of html.matchAll(/<(input|select|textarea|button|form|div|span|p|label)\b([^>]*)>/g)) {
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
    return this.map?.get(selector) || null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-f]') return this.nodes?.filter((n) => n.dataset.f) || [];
    if (selector === '.subtabs button') return this.nodes?.filter((n) => n.tag === 'button' && n.dataset.i != null) || [];
    return this.nodes?.filter((n) => ['input', 'button'].includes(n.tag)) || [];
  }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  replaceChildren(...children) { this.children = children; }
  closest() { return this; }
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
}
const context = createContext({ console, Intl, Date, crypto: webcrypto, setTimeout, URL, Blob,
  document: { createElement: (tag) => new Element(tag) },
  FormData: class { constructor(form) { this.form = form; } *[Symbol.iterator]() { for (const el of this.form.elements) if (el.name && !el.disabled) yield [el.name, el.value]; } },
});
async function moduleAt(path, dependencies = {}) {
  const module = new SourceTextModule(await readFile(new URL(path, import.meta.url), 'utf8'), { context });
  await module.link((specifier) => new SyntheticModule(Object.keys(dependencies[specifier]), function () {
    for (const [key, value] of Object.entries(dependencies[specifier])) this.setExport(key, value);
  }, { context }));
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
      if (table === 'currencies') return ['KES', 'USD', 'JPY'].map((code) => ({ code }));
      if (table === 'categories') return [{ id: 'expense-cat', name: 'Feed', kind: 'expense' }, { id: 'income-cat', name: 'Sales', kind: 'income' }];
      if (table === 'transactions') return query.includes('&id=eq.') ? existing.filter((r) => query.includes(`id=eq.${r.id}`)) : existing;
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
