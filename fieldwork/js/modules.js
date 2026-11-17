import { resource } from './crud.js';
import { budget, recurring, CAT } from './finance.js';

const tabs = (el, X, list) => {                       // list: [[label, async (box)=>void]]
  el.innerHTML = `<div class="subtabs" role="tablist">${list.map(([l], i) => `<button role="tab" data-i="${i}" aria-selected="${i === 0}">${l}</button>`).join('')}</div><div id="tabbox"></div>`;
  const go = async (i) => { el.querySelectorAll('.subtabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.i == i)); const box = el.querySelector('#tabbox'); box.innerHTML = ''; try { await list[i][1](box); } catch (e) { X.toast(e.message); } };
  el.querySelector('.subtabs').onclick = (e) => e.target.dataset.i && go(e.target.dataset.i);
  go(0);
};

/* ── Daily operations ── */
const TASKS = { table: 'tasks', title: 'Tasks', singular: 'task', icon: 'daily', workerWrite: true, farmOrNull: true, search: ['title', 'notes'],
  emptyTitle: 'No tasks yet', emptyText: 'Add a daily routine, a monthly job or a one-time task.', badges: { open: 'warn', done: 'ok' },
  fields: [{ k: 'title', label: 'Task', req: true }, { k: 'cadence', label: 'Repeats', type: 'select', req: true, options: ['daily', 'monthly', 'once'] },
    { k: 'due_date', label: 'Due date', type: 'date' }, { k: 'status', label: 'Status', type: 'select', req: true, options: ['open', 'done'] }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'title', label: 'Task' }, { k: 'cadence', label: 'Repeats', t: 'badge' }, { k: 'due_date', label: 'Due' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'status', label: 'Status', t: 'badge' }],
  filters: [{ k: 'cadence', label: 'Repeats', options: ['daily', 'monthly', 'once'] }, { k: 'status', label: 'Status', options: ['open', 'done'] }],
  quick: (r) => (r.status === 'open' ? { label: 'Mark done', patch: { status: 'done', done_at: new Date().toISOString() } } : { label: 'Reopen', patch: { status: 'open', done_at: null } }) };

async function checklists(box, X) {
  const { S, db, esc, toast } = X, today = new Date().toISOString().slice(0, 10), farm = S.farmId === 'all' ? null : S.farmId;
  const fq = farm ? `farm_id=eq.${farm}` : 'farm_id=is.null';
  const load = async () => {
    const [lists, runs] = await Promise.all([db.select('checklists', 'select=id,name,checklist_items(id,label,position)&order=name'),
      db.select('checklist_runs', `select=id,checklist_id,checklist_run_items(item_id,done)&run_date=eq.${today}&${fq}`)]);
    box.innerHTML = `${S.farmId === 'all' ? '<p class="muted">Showing shared ticks for all farms. Pick a farm tab to tick items for one farm.</p>' : ''}
      ${X.canWrite() ? '<p><button class="btn ghost" id="newcl">Add checklist</button></p>' : ''}
      ${lists.length ? `<div class="grid">${lists.map((l) => { const run = runs.find((r) => r.checklist_id === l.id), items = [...l.checklist_items].sort((a, b) => a.position - b.position);
        const done = (id) => run?.checklist_run_items.some((i) => i.item_id === id && i.done);
        return `<section class="card"><h3>${esc(l.name)}</h3><p class="muted">${items.filter((i) => done(i.id)).length} of ${items.length} done today</p>
          ${items.map((i) => `<label class="check ${done(i.id) ? 'done' : ''}"><input type="checkbox" data-l="${l.id}" data-i="${i.id}" ${done(i.id) ? 'checked' : ''}><span>${esc(i.label)}</span></label>`).join('')}
          ${X.canWrite() ? `<p><button class="btn sm ghost" data-add="${l.id}" data-n="${items.length}">Add item</button> <button class="btn sm ghost" data-del="${l.id}">Delete</button></p>` : ''}</section>`; }).join('')}</div>`
        : `<div class="empty">${X.I('daily')}<h2>No checklists yet</h2><p>Create one, like “Daily opening” or “Monthly close”.</p></div>`}`;
  };
  box.onchange = async (e) => { const c = e.target; if (c.type !== 'checkbox') return;
    try { let [run] = await db.select('checklist_runs', `select=id&checklist_id=eq.${c.dataset.l}&run_date=eq.${today}&${fq}`);
      if (!run) run = await db.insert('checklist_runs', { workspace_id: S.ws.id, checklist_id: c.dataset.l, farm_id: farm, run_date: today });
      await db.upsert('checklist_run_items', { workspace_id: S.ws.id, run_id: run.id, item_id: c.dataset.i, done: c.checked, done_by: X.uid(), done_at: new Date().toISOString() }, 'run_id,item_id');
      await load(); } catch (x) { toast(x.message); c.checked = !c.checked; } };
  box.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'newcl') { const n = prompt('Checklist name'); if (n?.trim()) { await db.insert('checklists', { workspace_id: S.ws.id, name: n.trim() }); await load(); } }
      if (b.dataset.add) { const n = prompt('Checklist item'); if (n?.trim()) { await db.insert('checklist_items', { workspace_id: S.ws.id, checklist_id: b.dataset.add, label: n.trim(), position: Number(b.dataset.n) }); await load(); } }
      if (b.dataset.del && confirm('Delete this checklist and its history?')) { await db.remove('checklists', b.dataset.del); await load(); }
    } catch (x) { toast(x.message); } };
  await load();
}
export const daily = (el, X) => tabs(el, X, [['Tasks', (b) => resource(b, X, TASKS)], ['Checklists', (b) => checklists(b, X)]]);

/* ── Monthly finances ── */
const STD = { income: ['Milk sales', 'Crop sales', 'Livestock sales', 'Other income'], expense: ['Feed', 'Seed', 'Fertiliser', 'Agrochemicals', 'Veterinary', 'Labour', 'Fuel', 'Repairs', 'Transport', 'Utilities', 'Other'] };
const TXN = { table: 'transactions', title: 'Transactions', singular: 'transaction', icon: 'finances', workerWrite: true, multi: true, fx: true, monthField: 'txn_date', order: 'txn_date.desc',
  refs: ['categories', 'vendors'], search: ['description'], emptyTitle: 'No transactions this month', emptyText: 'Record income and expenses as they happen. Pick another month above to see past records.',
  fields: [{ k: 'txn_date', label: 'Date', type: 'date', req: true, def: new Date().toISOString().slice(0, 10) }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] },
    { k: 'amount', label: 'Amount', type: 'money', req: true }, { k: 'category_id', label: 'Category', type: 'ref', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' }, { k: 'description', label: 'Description' }],
  cols: [{ k: 'txn_date', label: 'Date' }, { k: 'description', label: 'Description' }, { k: 'category_id', label: 'Category', t: 'categories' }, { k: 'vendor_id', label: 'Vendor', t: 'vendors' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'amount', label: 'Amount', t: 'money', signed: true }],
  filters: [{ k: 'kind', label: 'Type', options: ['income', 'expense'] }, { k: 'category_id', label: 'Category', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', ref: 'vendors' }],
  summary: (rows, X) => { const s = (k) => rows.filter((r) => r.kind === k).reduce((a, r) => a + r.amount_base, 0), i = s('income'), e = s('expense');
    return `<span>Income <b class="pos">${X.money(i)}</b></span><span>Expenses <b>${X.money(e)}</b></span><span>Net <b class="${i - e < 0 ? 'neg' : 'pos'}">${X.money(i - e)}</b></span>`; } };
export async function finances(el, X) {
  const n = (await X.db.select('categories', 'select=id&limit=1')).length;
  el.innerHTML = `${!n && X.canWrite() ? '<div class="banner"><span>Set up categories so you can sort what you earn and spend.</span><button class="btn sm" id="stdcat">Add standard categories</button></div>' : ''}<div id="fin"></div>`;
  el.querySelector('#stdcat')?.addEventListener('click', async () => { try {
    await X.db.insert('categories', Object.entries(STD).flatMap(([kind, a]) => a.map((name) => ({ workspace_id: X.S.ws.id, kind, name }))));
    X.toast('Categories added'); finances(el, X); } catch (x) { X.toast(x.message); } });
  tabs(el.querySelector('#fin'), X, [['Transactions', (b) => resource(b, X, TXN)], ['Budget vs actual', (b) => budget(b, X)], ['Recurring', (b) => recurring(b, X)], ['Categories', (b) => resource(b, X, CAT)]]);
}

/* ── Vendors ── */
const VEND = { table: 'vendors', title: 'Vendors', singular: 'vendor', icon: 'vendors', farmOrNull: true, search: ['name', 'phone', 'kind'], emptyTitle: 'No vendors yet',
  emptyText: 'Add the suppliers and buyers you deal with, or pick a registered seed merchant.', order: 'name.asc',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'What they supply' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Name' }, { k: 'kind', label: 'Supplies' }, { k: 'phone', label: 'Phone' }, { k: 'farm_id', label: 'Farm', t: 'farms' }] };
async function merchants(box, X) {
  const { db, S, esc, toast } = X; const list = await db.select('seed_merchants', 'order=name');
  if (!list.length) { box.innerHTML = `<div class="empty">${X.I('vendors')}<h2>Seed merchant list not loaded</h2><p>Import the KEPHIS register into the <code>seed_merchants</code> table (see <code>db/seed-merchants.README.md</code>).</p></div>`; return; }
  const mine = new Set((await db.select('vendors', 'select=seed_merchant_id&seed_merchant_id=not.is.null')).map((v) => v.seed_merchant_id));
  box.innerHTML = `<div class="toolbar"><input type="search" id="mq" placeholder="Search merchants or county" aria-label="Search merchants"></div><div class="table-wrap" id="mt"></div>`;
  const paint = (q = '') => { box.querySelector('#mt').innerHTML = `<table><thead><tr><th>Merchant</th><th>County</th><th>Licence</th><th></th></tr></thead><tbody>${list.filter((m) => `${m.name} ${m.county}`.toLowerCase().includes(q))
    .map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.county || '')}</td><td>${esc(m.licence_no || '')}</td><td class="acts">${mine.has(m.id) ? '<span class="badge ok">In my vendors</span>' : X.canWrite() ? `<button class="btn sm ghost" data-m="${m.id}">Add to my vendors</button>` : ''}</td></tr>`).join('')}</tbody></table>`; };
  paint(); box.querySelector('#mq').oninput = (e) => paint(e.target.value.toLowerCase());
  box.onclick = async (e) => { const id = e.target.dataset?.m; if (!id) return; const m = list.find((x) => x.id === id);
    try { await db.insert('vendors', { workspace_id: S.ws.id, name: m.name, phone: m.phone, kind: 'Seed merchant', seed_merchant_id: id, farm_id: S.farmId === 'all' ? null : S.farmId }); mine.add(id); paint(); toast('Added to your vendors'); } catch (x) { toast(x.message); } };
}
export const vendors = (el, X) => tabs(el, X, [['My vendors', (b) => resource(b, X, VEND)], ['Seed merchants (KEPHIS)', (b) => merchants(b, X)]]);

/* ── Infrastructure ── */
const PROJ = { table: 'projects', title: 'Infrastructure', singular: 'project', icon: 'infrastructure', multi: true, search: ['name', 'notes'], badges: { planned: 'info', active: 'warn', paused: '', done: 'ok' },
  emptyTitle: 'No projects yet', emptyText: 'Track fences, barns, boreholes and other builds with their cost and dates.',
  fields: [{ k: 'name', label: 'Project', req: true }, { k: 'status', label: 'Status', type: 'select', req: true, options: ['planned', 'active', 'paused', 'done'] }, { k: 'cost', label: 'Cost', type: 'money', req: true },
    { k: 'start_date', label: 'Start', type: 'date' }, { k: 'end_date', label: 'End', type: 'date' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Project' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'status', label: 'Status', t: 'badge' }, { k: 'start_date', label: 'Start' }, { k: 'end_date', label: 'End' }, { k: 'cost', label: 'Cost', t: 'money' }],
  filters: [{ k: 'status', label: 'Status', options: ['planned', 'active', 'paused', 'done'] }] };
export const infrastructure = (el, X) => resource(el, X, PROJ);

/* ── Livestock & crops ── */
const ENT = { table: 'enterprises', title: 'Enterprises', singular: 'enterprise', icon: 'livestock', search: ['name', 'notes'], badges: { livestock: 'info', crop: 'ok' },
  emptyTitle: 'No enterprises yet', emptyText: 'An enterprise is one line of production, like dairy, maize or potatoes.',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'type', label: 'Type', type: 'select', req: true, options: ['livestock', 'crop'] }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'name', label: 'Enterprise' }, { k: 'type', label: 'Type', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'notes', label: 'Notes' }], filters: [{ k: 'type', label: 'Type', options: ['livestock', 'crop'] }] };
const REC = { table: 'enterprise_records', title: 'Records', singular: 'record', icon: 'livestock', farmScoped: false, refs: ['enterprises'], search: ['notes', 'record_type'], order: 'record_date.desc',
  emptyTitle: 'No records yet', emptyText: 'Log milk yield, feeding, health, planting or harvests against an enterprise.',
  fields: [{ k: 'enterprise_id', label: 'Enterprise', type: 'ref', ref: 'enterprises', req: true }, { k: 'record_date', label: 'Date', type: 'date', req: true, def: new Date().toISOString().slice(0, 10) },
    { k: 'record_type', label: 'What happened', type: 'select', req: true, options: ['milk yield', 'feeding', 'breeding', 'health', 'weight', 'planting', 'fertiliser', 'spraying', 'harvest', 'other'] },
    { k: 'quantity', label: 'Quantity', type: 'number' }, { k: 'unit', label: 'Unit (litres, kg, bags…)' }, { k: 'notes', label: 'Notes', type: 'textarea' }],
  cols: [{ k: 'record_date', label: 'Date' }, { k: 'enterprise_id', label: 'Enterprise', t: 'enterprises' }, { k: 'record_type', label: 'Type' }, { k: 'quantity', label: 'Qty' }, { k: 'unit', label: 'Unit' }, { k: 'notes', label: 'Notes' }],
  filters: [{ k: 'record_type', label: 'Type', options: ['milk yield', 'feeding', 'breeding', 'health', 'weight', 'planting', 'fertiliser', 'spraying', 'harvest', 'other'] }] };
export const livestock = (el, X) => tabs(el, X, [['Enterprises', (b) => resource(b, X, ENT)], ['Records', (b) => resource(b, X, REC)]]);

/* ── Workers ── */
const ROLES = ['farm_manager', 'herdsman', 'milker', 'field_hand', 'driver', 'security', 'casual', 'other'];
const WORK = { table: 'workers', title: 'Workers', singular: 'worker', icon: 'workers', multi: true, farmOrNull: true, search: ['full_name', 'phone', 'role'], order: 'full_name.asc', badges: { true: 'ok', false: '' },
  emptyTitle: 'No workers yet', emptyText: 'Add your team with their role and pay. Pay can then post to finances each month.',
  fields: [{ k: 'full_name', label: 'Name', req: true }, { k: 'role', label: 'Role', type: 'select', req: true, options: ROLES }, { k: 'pay_amount', label: 'Pay', type: 'money', req: true },
    { k: 'pay_frequency', label: 'Paid', type: 'select', req: true, options: ['monthly', 'weekly', 'daily'] }, { k: 'start_date', label: 'Start date', type: 'date' }, { k: 'end_date', label: 'End date', type: 'date' }, { k: 'phone', label: 'Phone', type: 'tel' }],
  cols: [{ k: 'full_name', label: 'Name' }, { k: 'role', label: 'Role', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'pay_frequency', label: 'Paid' }, { k: 'pay_amount', label: 'Pay', t: 'money' }],
  filters: [{ k: 'role', label: 'Role', options: ROLES }] };
export async function workers(el, X) {
  const { S, db, toast } = X;
  el.innerHTML = `${X.canWrite() ? `<div class="banner"><span>Post ${X.monthLabel()} pay to finances. Weekly pay counts 4 weeks and daily pay 26 days. Running it twice never double-posts.</span><button class="btn sm" id="post">Post pay</button></div>` : ''}<div id="wk"></div>`;
  el.querySelector('#post')?.addEventListener('click', async () => {
    try {
      const [a, b] = X.monthRange(), last = new Date(new Date(b).getTime() - 864e5).toISOString().slice(0, 10), fq = S.farmId === 'all' ? '' : `&farm_id=eq.${S.farmId}`;
      const [ws, done, cat] = await Promise.all([db.select('workers', `active=eq.true&pay_amount=gt.0${fq}`), db.select('transactions', `select=source_id&source_type=eq.worker_pay&source_period=eq.${a}`),
        db.select('categories', 'select=id&kind=eq.expense&name=eq.Labour&limit=1')]);
      const posted = new Set(done.map((d) => d.source_id)), rows = [], skipped = [];
      for (const w of ws.filter((w) => !posted.has(w.id) && (!w.start_date || w.start_date < b) && (!w.end_date || w.end_date >= a))) {
        let fx = 1;
        if (w.currency !== S.ws.currency) { const [r] = await db.select('fx_rates', `currency=eq.${w.currency}&order=as_of.desc&limit=1`); if (!r) { skipped.push(w.full_name); continue; } fx = r.rate; }
        rows.push({ workspace_id: S.ws.id, farm_id: w.farm_id, txn_date: last, kind: 'expense', amount: Math.round(w.pay_amount * { monthly: 1, weekly: 4, daily: 26 }[w.pay_frequency]), currency: w.currency, fx_rate: fx,
          category_id: cat[0]?.id ?? null, description: `Pay: ${w.full_name}`, source_type: 'worker_pay', source_id: w.id, source_period: a });
      }
      if (rows.length) await db.insertMany('transactions', rows);
      toast(`${rows.length} payment${rows.length === 1 ? '' : 's'} posted${skipped.length ? `. No exchange rate for ${skipped.join(', ')}` : ''}${!rows.length && !skipped.length ? ' (all already posted)' : ''}`);
    } catch (x) { toast(x.message); } });
  await resource(el.querySelector('#wk'), X, WORK);
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
