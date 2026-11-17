// Config-driven list + form for one table. Used by every module so each stays ~20 lines.
const digits = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;

// fx_rate is stored per MINOR unit; users see and type the familiar per-major-unit rate (1 USD = 129 KES).
export async function resource(el, X, cfg) {
  const { S, db, esc, I, toast, money, monthRange } = X;
  const base = S.ws.currency, scale = (c) => 10 ** (digits(base) - digits(c)), fix = (x) => Number(x.toPrecision(12)), canAdd = X.canWrite() || (cfg.workerWrite && S.role === 'worker'), canDel = X.canWrite();
  const refs = { farms: S.farms.map((f) => [f.id, f.name]) };
  for (const r of cfg.refs || []) refs[r] = (await db.select(r, `select=${r === 'categories' ? 'id,name,kind' : 'id,name'}&order=name`)).map((x) => [x.id, r === 'categories' ? `${x.name} (${x.kind})` : x.name]);
  const cur = cfg.multi ? (await db.select('currencies', 'order=code')).map((c) => c.code) : [];
  let rows = [], q = '', flt = {};
  const lbl = (rk, id) => (refs[rk] || []).find((r) => r[0] === id)?.[1] || '';

  async function fetchRows() {
    let qs = `select=*&order=${cfg.order || 'created_at.desc'}`;
    if (cfg.farmScoped !== false && S.farmId !== 'all') qs += cfg.farmOrNull ? `&or=(farm_id.eq.${S.farmId},farm_id.is.null)` : `&farm_id=eq.${S.farmId}`;
    if (cfg.monthField) { const [a, b] = monthRange(); qs += `&${cfg.monthField}=gte.${a}&${cfg.monthField}=lt.${b}`; }
    rows = await db.select(cfg.table, qs);
  }
  const cell = (c, r) => {
    const v = r[c.k];
    if (c.t === 'money') return `<td class="r ${c.signed ? (r.kind === 'income' ? 'pos' : 'neg') : ''}">${c.signed && r.kind === 'expense' ? '−' : ''}${v == null ? '' : money(v, r.currency || base)}</td>`;
    if (c.t === 'badge') return `<td><span class="badge ${(cfg.badges || {})[v] || ''}">${esc(v)}</span></td>`;
    if (c.t) return `<td>${esc(lbl(c.t, v))}</td>`;
    return `<td>${esc(v ?? '')}</td>`;
  };
  const visible = () => rows.filter((r) => Object.entries(flt).every(([k, v]) => !v || r[k] === v) &&
    (!q || [...(cfg.search || [])].some((k) => String(r[k] ?? '').toLowerCase().includes(q)) || (cfg.cols.some((c) => c.t && c.t !== 'money' && c.t !== 'badge' && lbl(c.t, r[c.k]).toLowerCase().includes(q)))));

  function paint() {
    const list = visible();
    $t.innerHTML = list.length ? `<table><thead><tr>${cfg.cols.map((c) => `<th class="${c.t === 'money' ? 'r' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
      ${list.map((r) => `<tr>${cfg.cols.map((c) => cell(c, r)).join('')}<td class="acts">${cfg.quick && canAdd ? `<button class="btn sm ghost" data-q="${r.id}">${cfg.quick(r).label}</button> ` : ''}
      ${canAdd ? `<button class="btn sm ghost" data-e="${r.id}">Edit</button>` : ''} ${canDel ? `<button class="btn sm ghost" data-d="${r.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${I(cfg.icon)}<h2>${rows.length ? 'Nothing matches' : cfg.emptyTitle}</h2><p>${rows.length ? 'Try a different search or filter.' : cfg.emptyText}</p></div>`;
    $s.innerHTML = cfg.summary ? cfg.summary(list, X) : '';
  }

  function form(row) {
    const d = X.dlg(), r = row || {}; let c = r.currency || base;
    const inp = (f) => {
      const v = r[f.k] ?? f.def ?? '', req = f.req ? 'required' : '';
      if (f.type === 'select') return `<select name="${f.k}" ${req}>${f.req ? '' : '<option value="">—</option>'}${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      if (f.type === 'bool') return `<select name="${f.k}">${f.req ? '' : '<option value="">Not checked</option>'}<option value="true" ${v === true ? 'selected' : ''}>Yes</option><option value="false" ${v === false ? 'selected' : ''}>No</option></select>`;
      if (f.type === 'ref') return `<select name="${f.k}" ${req}><option value="">—</option>${refs[f.ref].map(([id, n]) => `<option value="${id}" ${id === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      if (f.type === 'money') return `<input name="${f.k}" type="number" step="any" min="0" ${req} value="${row && r[f.k] != null ? r[f.k] / 10 ** digits(c) : ''}">`;
      if (f.type === 'textarea') return `<textarea name="${f.k}">${esc(v)}</textarea>`;
      return `<input name="${f.k}" type="${f.type || 'text'}" ${req} value="${esc(v)}" ${f.type === 'number' ? 'step="any"' : ''}>`;
    };
    const farmDef = r.farm_id ?? (S.farmId !== 'all' ? S.farmId : '');
    d.innerHTML = `<form id="rf"><h2>${row ? 'Edit' : 'Add'} ${cfg.singular}</h2><div style="margin-top:var(--sp-4)">
      ${cfg.farmScoped === false ? '' : `<label class="field">Farm<select name="farm_id" ${cfg.farmOrNull ? '' : 'required'}>${cfg.farmOrNull ? '<option value="">All farms</option>' : ''}${refs.farms.map(([id, n]) => `<option value="${id}" ${id === farmDef ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`}
      ${cfg.fields.map((f) => `<label class="field">${f.label}${inp(f)}</label>`).join('')}
      ${cfg.multi ? `<label class="field">Currency<select name="currency">${cur.map((x) => `<option ${x === c ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field" id="fxw" hidden>Exchange rate (1 ${'<span id="fxc"></span>'} = ? ${base})<input name="fx" type="number" step="any" min="0" value="${r.fx_rate && r.currency !== base ? fix(r.fx_rate / scale(r.currency)) : ''}"></label>` : ''}
      </div><p class="err" id="rmsg" role="alert"></p><div class="actions"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn">Save</button></div></form>`;
    $('#cx', d).onclick = () => d.close();
    const fxw = $('#fxw', d);
    const sync = async () => { if (!fxw) return; const cc = d.querySelector('[name=currency]').value; fxw.hidden = cc === base; $('#fxc', d).textContent = cc;
      const inpFx = d.querySelector('[name=fx]'); inpFx.required = cc !== base;
      if (cc !== base && !inpFx.value) { try { const [x] = await db.select('fx_rates', `currency=eq.${cc}&order=as_of.desc&limit=1`); if (x) inpFx.value = fix(x.rate / scale(cc)); } catch {} } };
    d.querySelector('[name=currency]')?.addEventListener('change', sync); sync();
    $('#rf', d).onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target)), out = {};
      const cc = v.currency || base;
      for (const f of cfg.fields) { let x = v[f.k]; if (f.type === 'money') x = x === '' ? null : Math.round(Number(x) * 10 ** digits(cc)); else if (f.type === 'bool') x = x === '' ? null : x === 'true'; else if (f.type === 'number') x = x === '' ? null : Number(x); else if (x === '') x = null; out[f.k] = x; }
      if (cfg.farmScoped !== false) out.farm_id = v.farm_id || null;
      if (cfg.multi) { out.currency = cc; if (cfg.fx) out.fx_rate = cc === base ? 1 : fix(Number(v.fx) * scale(cc)); }
      try {
        if (row) await db.update(cfg.table, row.id, out); else await db.insert(cfg.table, { ...out, workspace_id: S.ws.id });
        if (cfg.fx && cc !== base) db.upsert('fx_rates', { workspace_id: S.ws.id, currency: cc, rate: out.fx_rate, as_of: new Date().toISOString().slice(0, 10) }, 'workspace_id,currency,as_of').catch(() => {});  // remembers the latest rate for pre-filling
        d.close(); toast(row ? 'Saved' : 'Added'); await reload();
      } catch (x) { $('#rmsg', d).textContent = x.message; } };
    d.showModal();
  }
  const $ = (s, p = el) => p.querySelector(s);
  async function reload() { await fetchRows(); paint(); }
  function csv() {
    const L = visible(), val = (c, r) => (c.t === 'money' ? (r[c.k] ?? 0) / 10 ** digits(r.currency || base) : c.t && c.t !== 'badge' ? lbl(c.t, r[c.k]) : r[c.k] ?? '');
    const t = [cfg.cols.map((c) => c.label), ...L.map((r) => cfg.cols.map((c) => val(c, r)))].map((a) => a.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv' })); a.download = `${cfg.table}-${S.month}.csv`; a.click();
  }

  el.innerHTML = `<div class="head"><h1>${cfg.title}</h1><div class="btns"><button class="btn ghost" id="csv">Export CSV</button>${canAdd ? `<button class="btn" id="add">${I('plus')}Add ${cfg.singular}</button>` : ''}</div></div>
    <div class="toolbar"><input type="search" id="q" placeholder="Search ${cfg.title.toLowerCase()}" aria-label="Search">
    ${(cfg.filters || []).map((f) => `<select data-f="${f.k}" aria-label="${f.label}"><option value="">${f.label}: all</option>${f.ref ? refs[f.ref].map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('') : f.options.map((o) => `<option>${o}</option>`).join('')}</select>`).join('')}</div>
    <div class="sumbar" id="sum"></div><div class="table-wrap" id="tbl"></div>`;
  const $t = $('#tbl'), $s = $('#sum');
  $('#q').oninput = (e) => { q = e.target.value.toLowerCase(); paint(); };
  el.querySelectorAll('[data-f]').forEach((s) => (s.onchange = () => { flt[s.dataset.f] = s.value; paint(); }));
  $('#csv').onclick = csv; $('#add')?.addEventListener('click', () => form());
  $t.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const id = b.dataset.e || b.dataset.d || b.dataset.q, row = rows.find((r) => r.id === id);
    try {
      if (b.dataset.e) form(row);
      if (b.dataset.q) { await db.update(cfg.table, id, cfg.quick(row).patch); await reload(); }
      if (b.dataset.d && confirm(`Delete this ${cfg.singular}? This can’t be undone.`)) { await db.remove(cfg.table, id); toast('Deleted'); await reload(); }
    } catch (x) { toast(x.message); } };
  await reload();
}
