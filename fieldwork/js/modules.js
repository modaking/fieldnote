import { resource } from './crud.js';
import { budget, recurring, CAT } from './finance.js';
import * as C from './components.js';
import { registerUnsaved, confirmLeave } from './feedback.js';
import { readAll, readRpcAll, calendarMonth } from './read-all.js';

const reportAction = (X, key) => typeof X.report === 'function' && (!X.canReport || X.canReport(key)) ? C.actionMenu({label:'More actions',text:'More actions',items:[{label:'Report',attrs:{'data-module-report':key}}]}) : '';
const bindReports = (el, X) => el.querySelectorAll('[data-module-report]').forEach((button) => button.addEventListener('click', () => X.report(button.dataset.moduleReport)));

const tabs = async (el, X, list, initial = 0, notice = '') => {     // list: [[label, async (box)=>void]]
  const requested=String(X.filters?.tab||'').toLowerCase(),aliases={budget:'budget vs actual',payroll:'post pay',bills:'bills & balances',records:'records',checklists:'checklists',recurring:'recurring',categories:'categories',transactions:'transactions',enterprises:'enterprises',workers:'workers'};
  const requestedIndex=list.findIndex(([label])=>label.toLowerCase()===(aliases[requested]||requested)||label.toLowerCase().replace(/[^a-z0-9]+/g,'-')===requested);if(requestedIndex>=0)initial=requestedIndex;
  el.innerHTML = '<div id="module-heading"></div>' + notice + C.tabs(list.map(([label]) => ({ label })), { active: initial }) + '<div id="tabbox"></div>';
  const controls=el.querySelector('.subtabs'),heading=el.querySelector('#module-heading');
  let headerObserver,activeTab=null,switchSequence=0;
  const go = async (i) => {const my=++switchSequence;if(activeTab!==null&&activeTab!==i&&!(await confirmLeave()))return;if(my!==switchSequence)return;activeTab=i;headerObserver?.disconnect(); controls.querySelectorAll('button').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.i == i)); b.tabIndex = b.dataset.i == i ? 0 : -1; });
    heading.replaceChildren();heading.hidden=true;
    const box = document.createElement('div'); box.setAttribute('role', 'tabpanel'); el.querySelector('#tabbox').replaceChildren(box);
    // Keep actions inside their module's event boundary. Reuse the tab controls
    // after each render rather than moving the module header outside its panel.
    const placeControls = () => { if(!box.isConnected)return;const header=box.querySelector('.ui-page-header');
      if(header){heading.hidden=true;if(header.nextElementSibling!==controls)header.after(controls);}
      else if(box.firstElementChild!==controls)box.prepend(controls);
    };
    if (typeof MutationObserver !== 'undefined') { headerObserver = new MutationObserver(placeControls); headerObserver.observe(box, { childList: true,subtree:true }); }
    box.innerHTML = C.skeletonRows();
    try { await list[i][1](box); placeControls(); }
    catch (e) { if (box.isConnected) { heading.hidden=false;heading.innerHTML = C.pageHeader({ title: X.pageTitle || list[i][0], description: X.pageDescription || '', actions: reportAction(X, X.S.route || 'overview') }); bindReports(heading, X); } box.innerHTML = C.emptyState({ title: 'This section couldn’t load', text: e.message, action: C.button({ label: 'Try again', variant: 'secondary' }) }); box.querySelector('button').onclick = () => go(i);placeControls(); } };
  controls.onclick = (e) => { const button = e.target.closest('button[data-i]'); if (button) go(Number(button.dataset.i)); };
  controls.onkeydown = (event) => { const current = Number(event.target.dataset.i); if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !Number.isInteger(current)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
    controls.querySelectorAll('button')[next].focus(); go(next); };
  await go(initial);
};

/* ── Daily operations ── */
export function taskStatus(task, day) {
  if (task.status !== 'done' || !['daily', 'monthly'].includes(task.cadence)) return task.status || 'open';
  const date = new Date(task.done_at || '');
  if (Number.isNaN(date.getTime())) return 'open';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type).value;
  const completed = `${part('year')}-${part('month')}-${part('day')}`;
  return (task.cadence === 'monthly' ? completed.slice(0, 7) === day.slice(0, 7) : completed === day) ? 'done' : 'open';
}
const TASKS = { table: 'tasks', title: 'Tasks', singular: 'task', icon: 'daily', workerWrite: true, farmOrNull: true, search: ['title', 'notes'],
  normaliseRows: (rows, X) => rows.map((row) => ({ ...row, status: taskStatus(row, X.today?.() || new Date().toISOString().slice(0, 10)) })),
  emptyTitle: 'No tasks yet', emptyText: 'Add a daily routine, a monthly job or a one-time task.', badges: { open: 'warn', done: 'ok' },
  fields: [{ k: 'title', label: 'Task', req: true }, { k: 'cadence', label: 'Repeats', type: 'select', req: true, options: ['daily', 'monthly', 'once'] },
    { k: 'due_date', label: 'Due date', type: 'date' }, { k: 'status', label: 'Status', type: 'select', req: true, options: ['open', 'done'] }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'title', label: 'Task' }, { k: 'cadence', label: 'Repeats', t: 'badge' }, { k: 'due_date', label: 'Due' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'status', label: 'Status', t: 'badge' }],
  filters: [{ k: 'cadence', label: 'Repeats', options: ['daily', 'monthly', 'once'] }, { k: 'status', label: 'Status', options: ['open', 'done'] }],
  quick: (r) => (r.status === 'open' ? { label: 'Mark done', patch: { status: 'done', done_at: new Date().toISOString() } } : { label: 'Reopen', patch: { status: 'open', done_at: null } }) };

async function checklists(box, X) {
  const { S, db, esc, toast } = X, workspace = S.ws.id, scope = `workspace_id=eq.${workspace}`, today = X.today?.() || new Date().toISOString().slice(0, 10), farm = S.farmId === 'all' ? null : S.farmId;
  let busy = false;
  const pendingTemplates = new Set(), actor = X.uid?.();
  const current=()=>S.ws?.id===workspace&&(!actor||X.uid?.()===actor);
  const templates = (X.permissions?.has?.('operations.templates') ?? X.canWrite()) && S.farmIds == null;
  const ticks = (X.permissions?.has?.('operations.write') ?? (X.canWrite() || S.role === 'worker')) && (S.farmIds == null || farm != null);
  const fq = farm ? `farm_id=eq.${farm}` : 'farm_id=is.null';
  const load = async () => {
    if(!current())return;
    const [loadedLists, runs] = await Promise.all([readAll(db,'checklists', `${scope}&select=id,name,checklist_items(id,label,position)&order=name`,{active:current}),
      readAll(db,'checklist_runs', `${scope}&select=id,checklist_id,checklist_run_items(item_id,done)&run_date=eq.${today}&${fq}`,{active:current})]);
    if(!current())return;
    const lists = loadedLists.filter((row) => !pendingTemplates.has(row.id));
    box.innerHTML = C.pageHeader({ title: 'Checklists', description: 'Small routines that keep the farm running.', actions: reportAction(X, 'daily') + (templates ? C.button({ label: 'Add checklist', attrs: { id: 'newcl' } }) : '') }) + `${S.farmId === 'all' ? C.notice({ text: S.farmIds != null ? 'Choose an assigned farm to tick its checklist items.' : 'Showing shared ticks for all farms. Pick a farm tab to tick items for one farm.' }) : ''}
      ${lists.length ? `<div class="grid">${lists.map((l) => { const run = runs.find((r) => r.checklist_id === l.id), items = [...l.checklist_items].sort((a, b) => a.position - b.position);
        const done = (id) => run?.checklist_run_items.some((i) => i.item_id === id && i.done);
        return `<section class="card"><h3>${esc(l.name)}</h3><p class="muted">${items.filter((i) => done(i.id)).length} of ${items.length} done today</p>
          ${items.map((i) => `<label class="check ${done(i.id) ? 'done' : ''}"><input type="checkbox" data-l="${l.id}" data-i="${i.id}" ${done(i.id) ? 'checked' : ''}${ticks ? '' : ' disabled'}><span>${esc(i.label)}</span></label>`).join('')}
          ${templates ? `<p>${C.button({ label: 'Add item', size: 'sm', variant: 'ghost', attrs: { 'data-add': l.id, 'data-n': items.length } })} ${C.button({ label: 'Delete', size: 'sm', variant: 'ghost', attrs: { 'data-del': l.id } })}</p>` : ''}</section>`; }).join('')}</div>`
        : C.emptyState({ icon: X.I('daily'), title: 'No checklists yet', text: 'Create a reusable routine, such as Daily opening or Monthly close.' })}`;
    bindReports(box, X);
    box.querySelector('#newcl')?.addEventListener('click', (event) => { event.stopPropagation(); box.onclick?.(event); });
  };
  const pending = (value) => { busy = value; box.setAttribute('aria-busy', String(value)); box.querySelectorAll('input,button').forEach((control) => { control.disabled = value; }); };
  const definitionDrawer = (checklistId = null, position = 0) => {
    const dialog = X.dlg(); let saving = false,dirty=false;
    const drawer = C.openDrawer(dialog, { title: checklistId ? 'Add checklist item' : 'Add checklist', description: checklistId ? 'Add a clear, repeatable step for your team.' : 'Create a reusable routine for your farms.',
      body: `<form id="checklist-edit-form" novalidate>${C.field({ label: checklistId ? 'Checklist item' : 'Checklist name', name: 'name', required: true, hint: checklistId ? 'For example, Check water levels.' : 'For example, Daily opening.' })}<div id="checklist-form-message" class="ui-form-message" role="alert"></div></form>`,
      actions: C.button({ label: 'Cancel', variant: 'ghost', attrs: { 'data-checklist-cancel': true } }) + C.button({ label: 'Save', type: 'submit', attrs: { form: 'checklist-edit-form' } }) });
    const form=dialog.querySelector('form'),name=dialog.querySelector('[name=name]'),error=dialog.querySelector('[data-error-for="name"]'),message=dialog.querySelector('#checklist-form-message');
    const sameForm=()=>dialog.querySelector('form')===form,current=()=>S.ws?.id===workspace&&(!actor||X.uid?.()===actor)&&sameForm();
    const unregister=registerUnsaved({element:form,isDirty:()=>dirty,isSaving:()=>saving,isActive:()=>dialog.open&&sameForm()});
    const close=async()=>{if(!saving&&(!dirty||await confirmLeave())){dirty=false;unregister();drawer.close();}};
    const closeButton=dialog.querySelector('[data-drawer-close]');closeButton?.removeEventListener('click',drawer.close);closeButton?.addEventListener('click',close);
    dialog.querySelector('[data-checklist-cancel]').onclick = close;
    dialog.oncancel = (event) => {event.preventDefault();close();};
    name.addEventListener('input',()=>{dirty=true;const invalid=!name.value.trim();name.setAttribute('aria-invalid',String(invalid));error.textContent=invalid?'Enter a name.':'';error.hidden=!invalid;});
    form.onsubmit = async (event) => {
      event.preventDefault(); if (saving || !templates || S.ws.id !== workspace) return;
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); error.textContent = 'Enter a name.'; error.hidden = false; name.focus(); return; }
      const controls=[...dialog.querySelectorAll('button,input')];saving = true;controls.forEach((control) => { control.disabled = true; });
      try {
        await db.insert(checklistId ? 'checklist_items' : 'checklists', { workspace_id: workspace, ...(checklistId ? { checklist_id: checklistId, label: name.value.trim(), position } : { name: name.value.trim() }) });
        dirty=false;unregister();if(!current())return;drawer.close();toast(checklistId ? 'Checklist item added.' : 'Checklist added.'); await load();
      } catch (failure) {if(current())message.textContent = failure.message;}
      finally {saving=false;controls.forEach((control) => { control.disabled = false; });}
    };
    dialog.querySelector('[name=name]').focus();
  };
  const deleteTemplate = async (id) => {
    if (!templates || pendingTemplates.has(id)) return;
    if (!(await C.confirmDialog({ title: 'Delete this checklist?', text: 'Its checklist items and completion history will also be removed. You can undo for 6 seconds before anything is deleted.', confirmLabel: 'Delete checklist', danger: true }))) return;
    pendingTemplates.add(id); await load(); let cancelled = false;
    const undo = () => { if (cancelled) return; cancelled = true; clearTimeout(timer); pendingTemplates.delete(id); load().catch((error) => toast(error.message)); toast('Deletion cancelled.'); };
    const notification = C.toast('Checklist scheduled for deletion', { action: 'Undo', onAction: undo, timeout: 6000 });
    const timer = setTimeout(async () => {
      if (cancelled) return;
      if (S.ws?.id !== workspace || (actor && X.uid?.() !== actor) || !(X.permissions?.has?.('operations.templates') ?? X.canWrite())) { undo(); return; }
      try { await db.remove('checklists', id); toast('Checklist deleted.'); }
      catch (error) { toast(error.message); }
      finally { pendingTemplates.delete(id); notification.dismiss(); await load().catch((error) => toast(error.message)); }
    }, 6000);
  };
  box.onchange = async (e) => { const c = e.target; if (c.type !== 'checkbox' || busy || !current() || !ticks) return;
    const wanted = c.checked; pending(true);
    try { let [run] = await db.select('checklist_runs', `${scope}&select=id&checklist_id=eq.${c.dataset.l}&run_date=eq.${today}&${fq}`);
      if(!current())return;
      if (!run) run = await db.insert('checklist_runs', { workspace_id: workspace, checklist_id: c.dataset.l, farm_id: farm, run_date: today });
      if(!current())return;
      await db.upsert('checklist_run_items', { workspace_id: workspace, run_id: run.id, item_id: c.dataset.i, done: wanted, done_by: X.uid(), done_at: wanted ? new Date().toISOString() : null }, 'run_id,item_id');
      if(current())await load(); } catch (x) {if(current()){toast(x.message); c.checked = !wanted;}} finally { pending(false); } };
  box.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return;
    if (busy || !templates || S.ws.id !== workspace) return;
    if (b.id === 'newcl') { definitionDrawer(); return; }
    if (b.dataset.add) { definitionDrawer(b.dataset.add, Number(b.dataset.n)); return; }
    pending(true);
    try {
      if (b.dataset.del) await deleteTemplate(b.dataset.del);
    } catch (x) { toast(x.message); } finally { pending(false); } };
  await load();
}
export const daily = (el, X) => tabs(el, X, [['Tasks', (b) => resource(b, X, TASKS)], ['Checklists', (b) => checklists(b, X)]]);

/* ── Monthly finances ── */
const STD = { income: ['Milk sales', 'Crop sales', 'Livestock sales', 'Other income'], expense: ['Feed', 'Seed', 'Fertiliser', 'Agrochemicals', 'Veterinary', 'Labour', 'Fuel', 'Repairs', 'Transport', 'Utilities', 'Other'] };
const TXN = { table: 'transactions', title: 'Transactions', singular: 'transaction', icon: 'finances', workerWrite: true, multi: true, fx: true, monthField: 'txn_date', order: 'txn_date.desc',
  summaryRpc:'fw_transaction_totals',
  refs: ['categories', 'vendors'], search: ['description'], emptyTitle: 'No transactions this month', emptyText: 'Record income and expenses as they happen. Pick another month above to see past records.',
  fields: [{ k: 'txn_date', label: 'Date', type: 'date', req: true, def: (X) => X.today?.() || new Date().toISOString().slice(0, 10) }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] },
    { k: 'amount', label: 'Amount', type: 'money', req: true }, { k: 'category_id', label: 'Category', type: 'ref', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' }, { k: 'description', label: 'Description' }],
  cols: [{ k: 'txn_date', label: 'Date' }, { k: 'description', label: 'Description' }, { k: 'category_id', label: 'Category', t: 'categories' }, { k: 'vendor_id', label: 'Vendor', t: 'vendors' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'amount', label: 'Amount', t: 'money', signed: true }],
  filters: [{ k: 'kind', label: 'Type', options: ['income', 'expense'] }, { k: 'category_id', label: 'Category', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', ref: 'vendors' }],
  summary: (rows, X) => { const s = (k) => rows.filter((r) => r.kind === k).reduce((a, r) => a + r.amount_base, 0), i = s('income'), e = s('expense');
    return `<span>Income <b class="pos">${X.money(i)}</b></span><span>Expenses <b>${X.money(e)}</b></span><span>Net <b class="${i - e < 0 ? 'neg' : 'pos'}">${X.money(i - e)}</b></span>`; } };
export async function finances(el, X) {
  const workspace = X.S.ws.id, n = (await X.db.select('categories', `workspace_id=eq.${workspace}&select=id&limit=1`)).length;
  const categoryWrite = () => (X.permissions?.canWriteModule?.('finances') ?? X.canWrite()) && X.S.farmIds == null;
  const setup = !n && categoryWrite() ? C.notice({ title: 'Organise your income and spending', text: 'Start with common farm categories, then adjust them to your needs.', action: C.button({ label: 'Add standard categories', size: 'sm', attrs: { id: 'stdcat' } }) }) : '';
  const transactionConfig = X.migrationReady ? { ...TXN, refs: [...TXN.refs, 'enterprises'], fields: [...TXN.fields, { k: 'enterprise_id', label: 'Enterprise', type: 'ref', ref: 'enterprises', hint: 'Optional. Link this entry to the enterprise on the chosen farm.' }], cols: [...TXN.cols, { k: 'enterprise_id', label: 'Enterprise', t: 'enterprises' }] } : TXN;
  el.innerHTML = '<div id="fin"></div>';
  await tabs(el.querySelector('#fin'), X, [['Transactions', (b) => resource(b, X, transactionConfig)], ['Budget vs actual', (b) => budget(b, X)], ['Recurring', (b) => recurring(b, X)], ['Categories', (b) => resource(b, X, CAT)]], 0, setup);
  el.querySelector('#stdcat')?.addEventListener('click', async (event) => { const button = event.currentTarget; if (button.disabled || !categoryWrite() || X.S.ws.id !== workspace) return; button.disabled = true; try {
    await X.db.insertMany('categories', Object.entries(STD).flatMap(([kind, a]) => a.map((name) => ({ workspace_id: workspace, kind, name }))));
    X.toast('Categories added'); await finances(el, X); } catch (x) { X.toast(x.message); } finally { button.disabled = false; } });
}

/* ── Vendors ── */
const VEND = { table: 'vendors', title: 'Vendors', singular: 'vendor', icon: 'vendors', farmOrNull: true, search: ['name', 'phone', 'kind'], emptyTitle: 'No vendors yet',
  basicFields:['kind','phone'],
  emptyText: 'Add the suppliers and buyers you deal with, or pick a registered seed merchant.', order: 'name.asc',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'What they supply' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Name' }, { k: 'kind', label: 'Supplies' }, { k: 'phone', label: 'Phone' }, { k: 'farm_id', label: 'Farm', t: 'farms' }] };
async function merchants(box, X) {
  const { db, S, esc, toast } = X,workspace=S.ws.id,actor=X.uid?.(),active=()=>S.ws?.id===workspace&&(!actor||X.uid?.()===actor)&&box.isConnected!==false;const list=await readAll(db,'seed_merchants','order=name',{active});
  if (!list.length) { box.innerHTML = C.pageHeader({ title: 'Seed merchants', actions: reportAction(X, 'vendors') }) + C.emptyState({ icon: X.I('vendors'), title: 'Seed merchant list not loaded', text: 'Ask a workspace admin to add the current registered merchant list.' }); bindReports(box, X); return; }
  const mine = new Set((await readAll(db,'vendors', `workspace_id=eq.${workspace}&select=id,seed_merchant_id&seed_merchant_id=not.is.null`,{active})).map((v) => v.seed_merchant_id));
  box.innerHTML = C.pageHeader({ title: 'Seed merchants', description: 'Find registered seed suppliers and add them to your directory.', actions: reportAction(X, 'vendors') }) + `<div class="ui-resource-toolbar">${C.input({ id: 'mq', type: 'search', attrs: { placeholder: 'Search merchants or county', 'aria-label': 'Search merchants' } })}</div><div class="ui-table-scroller" id="mt"></div>`;
  bindReports(box, X);
  const paint = (q = '') => { box.querySelector('#mt').innerHTML = C.dataTable({ columns: [{ key: 'name', label: 'Merchant' }, { key: 'county', label: 'County' }, { key: 'licence_no', label: 'Licence' }], rows: list.filter((m) => `${m.name} ${m.county}`.toLowerCase().includes(q)),
    actions: (m) => mine.has(m.id) ? C.badge({ label: 'In my vendors', tone: 'positive' }) : X.canWrite() ? C.button({ label: 'Add to my vendors', size: 'sm', variant: 'secondary', attrs: { 'data-m': m.id } }) : '' }); };
  paint(); box.querySelector('#mq').oninput = (e) => paint(e.target.value.toLowerCase());
  box.onclick = async (e) => { const button = e.target.closest('button'), id = button?.dataset.m; if (!id || button.disabled || mine.has(id) || !X.canWrite() || S.ws.id !== workspace) return; const m = list.find((x) => x.id === id); button.disabled = true;
    try { await db.insert('vendors', { workspace_id: workspace, name: m.name, phone: m.phone, kind: 'Seed merchant', seed_merchant_id: id, farm_id: S.farmId === 'all' ? null : S.farmId }); mine.add(id); paint(); toast('Added to your vendors'); } catch (x) { toast(x.message); } finally { button.disabled = false; } };
}
const BILLS = { table: 'vendor_bills', module: 'finances', report: 'vendors', title: 'Bills & balances', singular: 'bill', icon: 'vendors', multi: true, farmOrNull: true, order: 'due_on.asc.nullslast', refs: ['vendors'], search: ['description', 'reference'],
  description: 'Track supplier bills and outstanding amounts separately from recorded cash transactions.', emptyTitle: 'No supplier bills yet', emptyText: 'Add a bill to track its due date, amount paid and outstanding balance.',
  fields: [{ k: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors', req: true }, { k: 'reference', label: 'Bill reference' }, { k: 'issued_on', label: 'Issued on', type: 'date', req: true, def: (X) => X.today?.() || new Date().toISOString().slice(0, 10) }, { k: 'due_on', label: 'Due on', type: 'date' },
    { k: 'amount', label: 'Bill amount', type: 'money', req: true }, { k: 'paid_amount', label: 'Amount paid', type: 'money', req: true, def: 0 }, { k: 'description', label: 'Description', type: 'textarea' }],
  cols: [{ k: 'vendor_id', label: 'Vendor', t: 'vendors' }, { k: 'reference', label: 'Reference' }, { k: 'issued_on', label: 'Issued' }, { k: 'due_on', label: 'Due' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'amount', label: 'Bill amount', t: 'money' }, { k: 'paid_amount', label: 'Paid', t: 'money' },
    { k: 'outstanding', label: 'Outstanding', sortValue: (r) => r.amount - r.paid_amount, render: (r, X) => `<span class="${r.amount > r.paid_amount ? 'neg' : 'pos'}">${X.money(r.amount - r.paid_amount, r.currency)}</span>`, exportValue: (r) => (r.amount - r.paid_amount) / 10 ** new Intl.NumberFormat('en', { style: 'currency', currency: r.currency }).resolvedOptions().maximumFractionDigits }],
  filters: [{ k: 'vendor_id', label: 'Vendor', ref: 'vendors' }] };
export const vendors = (el, X) => tabs(el, X, [['My vendors', (b) => resource(b, X, VEND)], ...(X.migrationReady && (X.permissions?.canReadModule?.('finances') ?? true) ? [['Bills & balances', (b) => resource(b, X, BILLS)]] : []), ['Seed merchants (KEPHIS)', (b) => merchants(b, X)]]);

/* ── Infrastructure ── */
const PROJ = { table: 'projects', title: 'Infrastructure', singular: 'project', icon: 'infrastructure', multi: true, order: 'name.asc', search: ['name', 'notes'], badges: { planned: 'info', active: 'warn', paused: '', done: 'ok' },
  emptyTitle: 'No projects yet', emptyText: 'Track fences, barns, boreholes and other builds with their cost and dates.',
  fields: [{ k: 'name', label: 'Project', req: true }, { k: 'status', label: 'Status', type: 'select', req: true, options: ['planned', 'active', 'paused', 'done'] }, { k: 'budget', label: 'Budget', type: 'money', hint: 'Optional total budget for this project.' }, { k: 'cost', label: 'Actual cost', type: 'money', req: true },
    { k: 'start_date', label: 'Start', type: 'date' }, { k: 'end_date', label: 'End', type: 'date' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Project' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'status', label: 'Status', t: 'badge' }, { k: 'start_date', label: 'Start' }, { k: 'end_date', label: 'End' }, { k: 'budget', label: 'Budget', t: 'money' }, { k: 'cost', label: 'Actual cost', t: 'money' },
    { k: 'remaining', label: 'Budget remaining', sortValue: (r) => r.budget == null ? null : r.budget - r.cost, render: (r, X) => r.budget == null ? '—' : `<span class="${r.cost > r.budget ? 'neg' : 'pos'}">${X.money(r.budget - r.cost, r.currency)}</span>` }],
  filters: [{ k: 'status', label: 'Status', options: ['planned', 'active', 'paused', 'done'] }] };
export const infrastructure = (el, X) => {
  const workspace=X.S.ws.id,actor=X.uid?.(),active=()=>el.isConnected!==false&&X.S.ws?.id===workspace&&(!actor||X.uid?.()===actor);
  const config = X.migrationReady ? PROJ : { ...PROJ, fields: PROJ.fields.filter((f) => f.k !== 'budget'), cols: PROJ.cols.filter((c) => !['budget', 'remaining'].includes(c.k)) };
  return resource(el, X, (X.permissions?.has?.('finance.read') ?? true) ? config : { ...config, module: 'infrastructure', multi: false,
    load: () => readRpcAll(X.db,'fw_operational_projects',{p_workspace_id:workspace},'',{order:'name.asc',active}), fields: config.fields.filter((f) => !['cost', 'budget'].includes(f.k)), cols: config.cols.filter((c) => !['cost', 'budget', 'remaining'].includes(c.k)) });
};

/* ── Livestock & crops ── */
const ENT = { table: 'enterprises', title: 'Enterprises', singular: 'enterprise', icon: 'livestock', order: 'name.asc', search: ['name', 'notes'], badges: { livestock: 'info', crop: 'ok' },
  emptyTitle: 'No enterprises yet', emptyText: 'An enterprise is one line of production, like dairy, maize or potatoes.',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'type', label: 'Type', type: 'select', req: true, options: ['livestock', 'crop'] }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Enterprise' }, { k: 'type', label: 'Type', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'notes', label: 'Notes' }], filters: [{ k: 'type', label: 'Type', options: ['livestock', 'crop'] }] };
const REC = { table: 'enterprise_records', title: 'Records', singular: 'record', icon: 'livestock', workerWrite: true, farmScoped: false, refs: ['enterprises'], search: ['notes', 'record_type'], order: 'record_date.desc',
  emptyTitle: 'No records yet', emptyText: 'Log milk yield, feeding, health, planting or harvests against an enterprise.',
  fields: [{ k: 'enterprise_id', label: 'Enterprise', type: 'ref', ref: 'enterprises', req: true }, { k: 'record_date', label: 'Date', type: 'date', req: true, def: (X) => X.today?.() || new Date().toISOString().slice(0, 10) },
    { k: 'record_type', label: 'What happened', type: 'select', req: true, options: ['milk yield', 'feeding', 'breeding', 'health', 'weight', 'planting', 'fertiliser', 'spraying', 'harvest', 'other'] },
    { k: 'quantity', label: 'Quantity', type: 'number', min: 0 }, { k: 'unit', label: 'Unit (litres, kg, bags…)' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'record_date', label: 'Date' }, { k: 'enterprise_id', label: 'Enterprise', t: 'enterprises' }, { k: 'record_type', label: 'Type' }, { k: 'quantity', label: 'Qty' }, { k: 'unit', label: 'Unit' }, { k: 'notes', label: 'Notes' }],
  filters: [{ k: 'record_type', label: 'Type', options: ['milk yield', 'feeding', 'breeding', 'health', 'weight', 'planting', 'fertiliser', 'spraying', 'harvest', 'other'] }] };
export const livestock = (el, X) => tabs(el, X, [['Enterprises', (b) => resource(b, X, ENT)], ['Records', (b) => resource(b, X, REC)]], X.addRequested ? 1 : 0);

/* ── Workers ── */
const ROLES = ['farm_manager', 'herdsman', 'milker', 'field_hand', 'driver', 'security', 'casual', 'other'];
const WORK = { table: 'workers', title: 'Workers', singular: 'worker', icon: 'workers', multi: true, farmOrNull: true, search: ['full_name', 'phone', 'role'], order: 'full_name.asc', badges: { true: 'ok', false: '' },
  emptyTitle: 'No workers yet', emptyText: 'Add your team with their role and pay. Pay can then post to finances each month.',
  fields: [{ k: 'full_name', label: 'Name', req: true }, { k: 'role', label: 'Role', type: 'select', req: true, options: ROLES }, { k: 'pay_amount', label: 'Pay', type: 'money', req: true },
    { k: 'pay_frequency', label: 'Paid', type: 'select', req: true, options: ['monthly', 'weekly', 'daily'] }, { k: 'start_date', label: 'Start date', type: 'date' }, { k: 'end_date', label: 'End date', type: 'date' }, { k: 'phone', label: 'Phone', type: 'tel' }],
  cols: [{ k: 'full_name', label: 'Name' }, { k: 'role', label: 'Role', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'pay_frequency', label: 'Paid' }, { k: 'pay_amount', label: 'Pay', t: 'money' }],
  filters: [{ k: 'role', label: 'Role', options: ROLES }] };
export async function workers(el, X) {
  const { S, db, toast } = X, workspace = S.ws.id, scope = `workspace_id=eq.${workspace}`, base = S.ws.currency;
  const selectedMonth=S.month,selectedFarm=S.farmId,period=calendarMonth(selectedMonth),actor=X.uid?.(),current=()=>S.ws?.id===workspace&&S.month===selectedMonth&&S.farmId===selectedFarm&&(!actor||X.uid?.()===actor)&&X.canWrite(),all=(table,query)=>readAll(db,table,query,{active:current});
  el.innerHTML = `${X.canWrite() ? C.notice({ title: `Record ${period.label} wages`, text: `Use More actions to post ${period.label} only. Weekly pay counts 4 weeks and daily pay 26 days. Previously posted payments are skipped.` }) : ''}<div id="wk"></div>`;
  const postPay=async (event) => {
    const button = event.currentTarget; if (button.disabled || !current()) return; button.disabled = true;
    try {
      const a=period.from,b=period.to,last=new Date(new Date(b).getTime()-864e5).toISOString().slice(0,10),fq=selectedFarm==='all'?'':`&farm_id=eq.${selectedFarm}`;
      const [ws, done, cat] = await Promise.all([all('workers', `${scope}&active=eq.true&pay_amount=gt.0${fq}`), all('transactions', `${scope}&select=id,source_id&source_type=eq.worker_pay&source_period=eq.${a}`),
        db.select('categories', `${scope}&select=id&kind=eq.expense&name=eq.Labour&limit=1`)]);
      const posted = new Set(done.map((d) => d.source_id)), rows = [], skipped = [];
      for (const w of ws.filter((w) => !posted.has(w.id) && (!w.start_date || w.start_date < b) && (!w.end_date || w.end_date >= a))) {
        if(!current())return;
        let fx = 1;
        if (w.currency !== base) { const [r] = await db.select('fx_rates', `${scope}&currency=eq.${w.currency}&order=as_of.desc&limit=1`); if (!r) { skipped.push(w.full_name); continue; } fx = r.rate; }
        rows.push({ workspace_id: workspace, farm_id: w.farm_id, txn_date: last, kind: 'expense', amount: Math.round(w.pay_amount * { monthly: 1, weekly: 4, daily: 26 }[w.pay_frequency]), currency: w.currency, fx_rate: fx,
          category_id: cat[0]?.id ?? null, description: `Pay: ${w.full_name}`, source_type: 'worker_pay', source_id: w.id, source_period: a });
      }
      if (!current())return;
      if (rows.some((r) => !Number.isSafeInteger(r.amount) || !Number.isFinite(Number(r.fx_rate)) || Number(r.fx_rate) <= 0)) throw new Error('A pay amount or exchange rate is invalid. Review the worker records before posting.');
      if (rows.length) await db.insertMany('transactions', rows);
      if(!current())return;
      toast(`${rows.length} payment${rows.length === 1 ? '' : 's'} posted${skipped.length ? `. No exchange rate for ${skipped.join(', ')}` : ''}${!rows.length && !skipped.length ? ' (all already posted)' : ''}`);
    } catch (x) {if(current())toast(x.message);} finally { button.disabled = false; } };
  const pay = X.permissions?.has?.('pay.read') ?? true;
  await resource(el.querySelector('#wk'), X, pay ? {...WORK,moreActions:X.canWrite()?[{label:`Post ${period.label} pay`,attrs:{id:'post'}}]:[]} : { ...WORK, module: 'workers', multi: false,
    load: () => readRpcAll(X.db,'fw_operational_workers',{p_workspace_id:workspace},'',{order:'full_name.asc',active:()=>el.isConnected!==false&&S.ws?.id===workspace&&(!actor||X.uid?.()===actor)}), search: ['full_name', 'role'],
    fields: WORK.fields.filter((f) => !['pay_amount', 'pay_frequency', 'phone'].includes(f.k)), cols: WORK.cols.filter((c) => !['pay_amount', 'pay_frequency'].includes(c.k)) });
  el.querySelector('#post')?.addEventListener('click',postPay);
  const header = el.querySelector('.ui-page-header'); if (header) el.prepend(header);
}

/* ── Funding ── */
const FUND = { table: 'funding_opportunities', title: 'Funding', singular: 'opportunity', icon: 'funding', farmScoped: false, multi: true, search: ['name', 'source', 'eligibility_notes'], order: 'deadline.asc.nullslast',
  badges: { identified: 'info', eligible: 'info', preparing: 'warn', submitted: 'warn', awarded: 'ok', declined: 'neg' }, emptyTitle: 'No funding opportunities yet',
  emptyText: 'Track grants, loans and programmes from first spotting them to the final decision.',
  fields: [{ k: 'name', label: 'Opportunity', req: true }, { k: 'source', label: 'Source (who funds it)' }, { k: 'eligible', label: 'Meets eligibility?', type: 'bool' }, { k: 'eligibility_notes', label: 'Eligibility notes', type: 'textarea' },
    { k: 'deadline', label: 'Deadline', type: 'date' }, { k: 'status', label: 'Status', type: 'select', req: true, options: ['identified', 'eligible', 'preparing', 'submitted', 'awarded', 'declined'] },
    { k: 'amount', label: 'Amount', type: 'money' }, { k: 'link', label: 'Link', type: 'url' }],
  cols: [{ k: 'name', label: 'Opportunity' }, { k: 'source', label: 'Source' }, { k: 'deadline', label: 'Deadline' }, { k: 'status', label: 'Status', t: 'badge' }, { k: 'amount', label: 'Amount', t: 'money' }],
  filters: [{ k: 'status', label: 'Status', options: ['identified', 'eligible', 'preparing', 'submitted', 'awarded', 'declined'] }] };
export const funding = (el, X) => resource(el, X, FUND);

// Grouped navigation renders these leaves directly; legacy module exports above
// retain their existing tabbed routes for shared links and integrations.
const tasksView=(el,X)=>resource(el,X,TASKS);
const enterprisesView=(el,X)=>resource(el,X,ENT);
const recordsView=(el,X)=>resource(el,X,REC);
const transactionsView=(el,X)=>resource(el,X,X.migrationReady?{...TXN,refs:[...TXN.refs,'enterprises'],fields:[...TXN.fields,{k:'enterprise_id',label:'Enterprise',type:'ref',ref:'enterprises',hint:'Optional. Link this entry to the enterprise on the chosen farm.'}],cols:[...TXN.cols,{k:'enterprise_id',label:'Enterprise',t:'enterprises'}]}:TXN);
const categoriesView=async(el,X)=>{
  const workspace=X.S.ws.id,canSetup=(X.permissions?.canWriteModule?.('finances')??X.canWrite())&&X.S.farmIds==null;
  const empty=!(await X.db.select('categories',`workspace_id=eq.${workspace}&select=id&limit=1`)).length;
  await resource(el,X,{...CAT,moreActions:empty&&canSetup?[{label:'Add standard categories',attrs:{id:'stdcat'}}]:[]});
  el.querySelector('#stdcat')?.addEventListener('click',async event=>{const button=event.currentTarget;if(button.disabled||X.S.ws?.id!==workspace)return;button.disabled=true;try{await X.db.insertMany('categories',Object.entries(STD).flatMap(([kind,names])=>names.map(name=>({workspace_id:workspace,kind,name}))));X.toast('Categories added');await categoriesView(el,X);}catch(error){X.toast(error.message);}finally{button.disabled=false;}});
};
const vendorsView=(el,X)=>resource(el,X,VEND);
const billsView=(el,X)=>X.migrationReady?resource(el,X,BILLS):Promise.resolve(el.innerHTML=C.notice({title:'Workspace access upgrade required',text:'Bills and balances become available after the reviewed workspace upgrade.'}));
export const moduleViews=Object.freeze({tasks:tasksView,checklists,enterprises:enterprisesView,records:recordsView,infrastructure,transactions:transactionsView,budgets:budget,recurring,categories:categoriesView,vendors:vendorsView,bills:billsView,merchants,workers,funding});
