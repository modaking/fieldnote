import { resource } from './crud.js';
const digits = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;
const prevMonth = (a) => { const d = new Date(`${a}T00:00`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

/* ── Budget vs actual + closing cash ── */
export async function budget(box, X) {
  const { S, db, esc, money, toast, monthRange } = X, [a, b] = monthRange(), prev = prevMonth(a), base = S.ws.currency, d = digits(base);
  const farm = S.farmId === 'all' ? null : S.farmId, fq = farm ? `&farm_id=eq.${farm}` : '', edit = X.canWrite() && farm;
  const [cats, bud, tx, pc, tc] = await Promise.all([db.select('categories', 'order=kind,name'), db.select('budgets', `month=eq.${a}${fq}`),
    db.select('transactions', `select=category_id,kind,amount_base&txn_date=gte.${a}&txn_date=lt.${b}${fq}`), db.select('month_closings', `month=eq.${prev}${fq}`), db.select('month_closings', `month=eq.${a}${fq}`)]);
  const sum = (arr, f) => arr.reduce((t, r) => t + f(r), 0), act = (k, c) => sum(tx.filter((t) => t.kind === k && t.category_id === c), (t) => t.amount_base), bg = (c) => sum(bud.filter((x) => x.category_id === c), (x) => x.amount);
  const inc = sum(tx.filter((t) => t.kind === 'income'), (t) => t.amount_base), exp = sum(tx.filter((t) => t.kind === 'expense'), (t) => t.amount_base);
  const opening = sum(pc, (r) => r.closing_cash), closing = opening + inc - exp, stored = tc.length ? sum(tc, (r) => r.closing_cash) : null;

  const section = (kind) => {
    const list = cats.filter((c) => c.kind === kind).map((c) => ({ id: c.id, name: c.name })); if (act(kind, null)) list.push({ id: null, name: 'Uncategorised' });
    const tb = sum(list, (c) => (c.id ? bg(c.id) : 0)), ta = sum(list, (c) => act(kind, c.id));
    const rows = list.map((c) => { const B = c.id ? bg(c.id) : 0, A = act(kind, c.id), left = kind === 'expense' ? B - A : A - B, over = kind === 'expense' && B > 0 && A > B;
      return `<tr><td>${esc(c.name)}</td><td class="r">${edit && c.id ? `<input class="bin" type="number" step="any" min="0" data-c="${c.id}" aria-label="Budget for ${esc(c.name)}" value="${B ? B / 10 ** d : ''}" placeholder="0">` : money(B)}</td>
        <td class="r">${money(A)}</td><td class="r ${left < 0 ? 'neg' : ''}">${B ? money(left) : '—'}</td><td>${over ? '<span class="badge neg">Over budget</span>' : B && A ? `<span class="badge ok">${Math.round((A / B) * 100)}% ${kind === 'expense' ? 'used' : 'of target'}</span>` : ''}</td></tr>`; }).join('');
    return `<h2 style="margin:var(--sp-5) 0 var(--sp-3);font-size:var(--fs-lg)">${kind === 'expense' ? 'Expenses' : 'Income'}</h2><div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">Budget</th><th class="r">Actual</th><th class="r">${kind === 'expense' ? 'Left' : 'Ahead'}</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No categories yet. Add some in the Categories tab.</td></tr>`}<tr><td><b>Total</b></td><td class="r"><b>${money(tb)}</b></td><td class="r"><b>${money(ta)}</b></td><td></td><td></td></tr></tbody></table></div>`;
  };
  box.innerHTML = `<div class="grid"><div class="card"><span class="muted">Opening cash</span><div class="kpi">${money(opening)}</div></div>
      <div class="card"><span class="muted">Net this month</span><div class="kpi ${inc - exp < 0 ? 'neg' : 'pos'}">${money(inc - exp)}</div></div>
      <div class="card"><span class="muted">Closing cash</span><div class="kpi ${closing < 0 ? 'neg' : ''}">${money(closing)}</div>${stored !== null ? `<span class="badge ${stored === closing ? 'ok' : 'warn'}">${stored === closing ? 'Month closed' : `Closed at ${money(stored)}`}</span>` : ''}</div></div>
    <div class="btns">${edit ? '<button class="btn" id="close">Close month</button><button class="btn ghost" id="copy">Copy last month’s budget</button>' : ''}</div>
    ${X.canWrite() && !farm ? '<p class="muted">Pick one farm above to edit its budget and close its month. All farms shows the combined totals.</p>' : ''}${section('expense')}${section('income')}`;
  box.onchange = async (e) => { const i = e.target; if (!i.dataset.c) return;
    try { await db.upsert('budgets', { workspace_id: S.ws.id, farm_id: farm, category_id: i.dataset.c, month: a, amount: Math.round(Number(i.value || 0) * 10 ** d) }, 'workspace_id,farm_id,category_id,month'); await budget(box, X); } catch (x) { toast(x.message); } };
  box.onclick = async (e) => { const id = e.target.id; if (!id) return;
    try {
      if (id === 'close') { await db.upsert('month_closings', { workspace_id: S.ws.id, farm_id: farm, month: a, closing_cash: closing }, 'workspace_id,farm_id,month'); toast('Month closed. Next month opens with this balance.'); await budget(box, X); }
      if (id === 'copy') { const old = await db.select('budgets', `month=eq.${prev}&farm_id=eq.${farm}`); if (!old.length) return toast('Last month has no budget to copy');
        if (!bud.length || confirm('Replace this month’s budget lines with last month’s?')) { await db.upsert('budgets', old.map((r) => ({ workspace_id: S.ws.id, farm_id: farm, category_id: r.category_id, month: a, amount: r.amount })), 'workspace_id,farm_id,category_id,month'); await budget(box, X); } }
    } catch (x) { toast(x.message); } };
}

/* ── Recurring payments ── */
const RECUR = { table: 'recurring_payments', title: 'Recurring payments', singular: 'recurring payment', icon: 'finances', multi: true, refs: ['categories', 'vendors'], search: ['name'], order: 'name.asc',
  emptyTitle: 'No recurring payments', emptyText: 'Add rent, loan repayments, subscriptions or regular sales, then post them each month in one click.',
  badges: { income: 'ok', expense: 'warn' },
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] }, { k: 'amount', label: 'Amount', type: 'money', req: true },
    { k: 'category_id', label: 'Category', type: 'ref', ref: 'categories' }, { k: 'vendor_id', label: 'Vendor', type: 'ref', ref: 'vendors' },
    { k: 'day_of_month', label: 'Day of month (1–28)', type: 'number', req: true, def: 1 }, { k: 'active', label: 'Active', type: 'bool', req: true, def: true }],
  cols: [{ k: 'name', label: 'Name' }, { k: 'kind', label: 'Type', t: 'badge' }, { k: 'farm_id', label: 'Farm', t: 'farms' }, { k: 'category_id', label: 'Category', t: 'categories' }, { k: 'day_of_month', label: 'Day' }, { k: 'amount', label: 'Amount', t: 'money' }] };
export async function recurring(box, X) {
  const { S, db, toast } = X;
  box.innerHTML = `${X.canWrite() ? `<div class="banner"><span>Post this month’s recurring payments to the register. Anything already posted is skipped.</span><button class="btn sm" id="postr">Post ${X.monthLabel()}</button></div>` : ''}<div id="rc"></div>`;
  box.querySelector('#postr')?.addEventListener('click', async () => {
    try {
      const [a, b] = X.monthRange(), fq = S.farmId === 'all' ? '' : `&farm_id=eq.${S.farmId}`;
      const [list, done] = await Promise.all([db.select('recurring_payments', `active=eq.true${fq}`), db.select('transactions', `select=source_id&source_type=eq.recurring&source_period=eq.${a}`)]);
      const posted = new Set(done.map((r) => r.source_id)), rows = [], skipped = [];
      for (const r of list.filter((r) => !posted.has(r.id))) {
        let fx = 1; if (r.currency !== S.ws.currency) { const [x] = await db.select('fx_rates', `currency=eq.${r.currency}&order=as_of.desc&limit=1`); if (!x) { skipped.push(r.name); continue; } fx = x.rate; }
        rows.push({ workspace_id: S.ws.id, farm_id: r.farm_id, txn_date: `${a.slice(0, 8)}${String(r.day_of_month).padStart(2, '0')}`, kind: r.kind, amount: r.amount, currency: r.currency, fx_rate: fx,
          category_id: r.category_id, vendor_id: r.vendor_id, description: r.name, source_type: 'recurring', source_id: r.id, source_period: a });
      }
      if (rows.length) await db.insertMany('transactions', rows);
      toast(`${rows.length} posted${skipped.length ? `. No exchange rate for ${skipped.join(', ')}` : ''}${!rows.length && !skipped.length ? ' (all already posted)' : ''}`);
    } catch (x) { toast(x.message); } });
  await resource(box.querySelector('#rc'), X, RECUR);
}

/* ── Categories ── */
export const CAT = { table: 'categories', title: 'Categories', singular: 'category', icon: 'finances', farmScoped: false, search: ['name'], order: 'kind.asc,name.asc', badges: { income: 'ok', expense: 'warn' },
  emptyTitle: 'No categories yet', emptyText: 'Categories sort your income and expenses and drive the budget.',
  fields: [{ k: 'name', label: 'Name', req: true }, { k: 'kind', label: 'Type', type: 'select', req: true, options: ['expense', 'income'] }],
  cols: [{ k: 'name', label: 'Category' }, { k: 'kind', label: 'Type', t: 'badge' }], filters: [{ k: 'kind', label: 'Type', options: ['income', 'expense'] }] };
