import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const routeNames = ['daily', 'finances', 'vendors', 'infrastructure', 'livestock', 'workers', 'funding'];
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

async function harness(viewOverrides = {}) {
  const nodes = new Map();
  const requests = [];
  const calls = [];
  const storage = new Map([['fw-month', '2026-11']]);
  const events = new Map();
  let activeElement;
  class Element {
    constructor(id = '') {
      this.id = id; this.dataset = {}; this.innerHTML = ''; this.isConnected = true;
      this.attributes = new Map(); this.listeners = new Map(); this.closed = false;
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
    querySelector(selector) { return get(selector); }
    querySelectorAll() { return []; }
    replaceWith(next) { this.isConnected = false; next.isConnected = true; nodes.set(`#${next.id}`, next); }
    append() {}
    remove() { this.isConnected = false; }
    close() { this.closed = true; }
    showModal() { this.closed = false; }
    focus() { activeElement = this; }
    closest() { return this; }
    click() { return this.onclick?.({ target: this }) ?? this.listeners.get('click')?.({ target: this }); }
  }
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector.startsWith('#') ? selector.slice(1) : selector));
    return nodes.get(selector);
  };
  const links = ['overview', ...routeNames].map((name) => {
    const el = new Element(); el.dataset.id = name; return el;
  });
  const document = {
    querySelector: get,
    querySelectorAll: (selector) => selector === '.nav a' ? links : [],
    createElement: () => new Element(),
    getElementById: (id) => get(`#${id}`),
    addEventListener: (type, handler) => events.set(type, handler),
    get activeElement() { return activeElement; },
  };
  let hash = '#/overview';
  const location = {
    get hash() { return hash; },
    set hash(value) { hash = value && !String(value).startsWith('#') ? `#${value}` : String(value); },
    pathname: '/', search: '', reload() {},
  };
  const history = { replaceState(_state, _title, url) { location.hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : ''; } };
  const db = {
    async select(table, query = '') {
      requests.push({ table, query });
      return [];
    },
    async update() {},
  };
  const views = Object.fromEntries(routeNames.map((name) => [name, viewOverrides[name] || ((el, X) => {
    calls.push({ name, X, el }); el.innerHTML = `${name} ready`;
  })]));
  const dependencies = new Map([
    ['./supabase.js', { init: () => new Promise(() => {}), session: () => ({ user: { id: 'user-1', email: 'farmer@example.test' } }), auth: {}, db }],
    ['./theme.js', { getPref: () => 'light', setPref() {} }],
    ['./modules.js', views],
    ['./seed.js', { loadDemo() {} }],
  ]);
  const context = vm.createContext({
    document, location, history, console, URLSearchParams, Event,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    setTimeout: () => 0,
    window: { location, addEventListener: (type, handler) => events.set(type, handler), matchMedia: () => ({ matches: true }) },
  });
  // Expose private entry points only inside this isolated test module. The real
  // functions, UI event handlers and asynchronous rendering logic remain intact.
  const module = new vm.SourceTextModule(`${source}\nexport { S, route, renderView, renderShell, openAddRecord };`, { context, identifier: 'app.js' });
  await module.link((specifier) => {
    const values = dependencies.get(specifier);
    assert.ok(values, `Unexpected app dependency ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  Object.assign(module.namespace.S, {
    ws: { id: 'workspace-a', name: 'Test workspace', currency: 'KES' }, role: 'owner',
    profile: { full_name: 'Test farmer' },
    farms: [{ id: 'farm-a', name: 'First farm' }, { id: 'farm-b', name: 'Second farm' }],
    farmId: 'all', month: '2026-11', route: 'overview',
  });
  return { api: module.namespace, document, location, requests, calls, get, links, storage, Element, events };
}

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
  assert.equal(h.links.find((link) => link.dataset.id === 'daily').getAttribute('aria-current'), 'page');
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

test('View farm refreshes dashboard figures using that farm and workspace', async () => {
  const h = await harness();
  h.api.route(); await settle();
  h.requests.length = 0;
  const button = new h.Element(); button.dataset.open = 'farm-b';
  await h.get('#farms').onclick({ target: button });
  await settle();
  const financial = h.requests.find((request) => request.table === 'transactions');
  assert.ok(financial, 'Selecting View must fetch the farm’s current figures.');
  assert.ok(financial.query.includes('farm_id=eq.farm-b'));
  assert.ok(financial.query.includes('workspace_id=eq.workspace-a'));
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
  assert.match(h.location.hash, /^#\/daily\?add=1$/);
  assert.equal(dialog.closed, true);
});

test('Skip to content moves focus without changing the current navigation route', async () => {
  const h = await harness();
  h.location.hash = '#/daily'; h.api.route(); await settle();
  let prevented = false;
  h.get('.skip-link').listeners.get('click')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.location.hash, '#/daily');
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
