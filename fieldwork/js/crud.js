// Config-driven list + form for one table. Used by every module so each stays ~20 lines.
const digits = (cur) => new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits;

// Keep the schema's ISO minor units exact; never silently round money on entry.
export function minorAmount(value, currency) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text), exponent = digits(currency);
  if (!match || !/\d/.test(text)) throw new Error(`Enter a non-negative amount in ${currency}.`);
  const fraction = match[2] || '';
  if (/[1-9]/.test(fraction.slice(exponent))) throw new Error(`${currency} amounts allow ${exponent} decimal place${exponent === 1 ? '' : 's'}.`);
  const amount = Number(match[1] || '0') * 10 ** exponent + Number(fraction.slice(0, exponent).padEnd(exponent, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('This amount is too large to record accurately.');
  return amount;
}

const draftId = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// fx_rate is stored per MINOR unit; users see and type the familiar per-major-unit rate (1 USD = 129 KES).
export async function resource(el, X, cfg) {
  const { S, db, esc, I, toast, money, monthRange } = X;
  const workspace = S.ws.id, scope = `workspace_id=eq.${workspace}`, base = S.ws.currency, scale = (c) => 10 ** (digits(base) - digits(c)), fix = (x) => Number(x.toPrecision(12)), canAdd = X.canWrite() || (cfg.workerWrite && S.role === 'worker'), canDel = X.canWrite();
  const permitted = () => S.ws?.id === workspace && (X.canWrite() || (cfg.workerWrite && S.role === 'worker'));
  const refs = { farms: S.farms.map((f) => [f.id, f.name]) }, referenceRows = {};
  for (const r of cfg.refs || []) {
    referenceRows[r] = await db.select(r, `${scope}&select=${r === 'categories' ? 'id,name,kind' : r === 'enterprises' ? 'id,name,farm_id' : 'id,name'}&order=name`);
    if (r === 'enterprises' && S.farmId !== 'all') referenceRows[r] = referenceRows[r].filter((e) => e.farm_id === S.farmId);
    refs[r] = referenceRows[r].map((x) => [x.id, r === 'categories' ? `${x.name} (${x.kind})` : x.name]);
  }
  const cur = cfg.multi ? (await db.select('currencies', 'order=code')).map((c) => c.code) : [];
  let rows = [], q = '', flt = {}, loaded = false, loadSeq = 0;
  const lbl = (rk, id) => (refs[rk] || []).find((r) => r[0] === id)?.[1] || '';

  async function fetchRows() {
    let qs = `${scope}&select=*&order=${cfg.order || 'created_at.desc'}`;
    if (cfg.farmScoped !== false && S.farmId !== 'all') qs += cfg.farmOrNull ? `&or=(farm_id.eq.${S.farmId},farm_id.is.null)` : `&farm_id=eq.${S.farmId}`;
    if (cfg.monthField) { const [a, b] = monthRange(); qs += `&${cfg.monthField}=gte.${a}&${cfg.monthField}=lt.${b}`; }
    if (cfg.table === 'enterprise_records' && S.farmId !== 'all') {
      if (!refs.enterprises.length) return [];
      qs += `&enterprise_id=in.(${refs.enterprises.map(([id]) => id).join(',')})`;
    }
    return db.select(cfg.table, qs);
  }
  const cell = (c, r) => {
    const v = r[c.k];
    if (c.t === 'money') return `<td data-label="${esc(c.label)}" class="r ${c.signed ? (r.kind === 'income' ? 'pos' : 'neg') : ''}">${c.signed && r.kind === 'expense' ? '−' : ''}${v == null ? '' : money(v, r.currency || base)}</td>`;
    if (c.t === 'badge') return `<td data-label="${esc(c.label)}"><span class="badge ${(cfg.badges || {})[v] || ''}">${esc(v)}</span></td>`;
    if (c.t) return `<td data-label="${esc(c.label)}">${esc(lbl(c.t, v))}</td>`;
    return `<td data-label="${esc(c.label)}">${esc(v ?? '')}</td>`;
  };
  const visible = () => rows.filter((r) => Object.entries(flt).every(([k, v]) => !v || r[k] === v) &&
    (!q || [...(cfg.search || [])].some((k) => String(r[k] ?? '').toLowerCase().includes(q)) || (cfg.cols.some((c) => c.t && c.t !== 'money' && c.t !== 'badge' && lbl(c.t, r[c.k]).toLowerCase().includes(q)))));

  function paint() {
    const list = visible();
    $t.innerHTML = list.length ? `<table class="resource-table"><thead><tr>${cfg.cols.map((c) => `<th class="${c.t === 'money' ? 'r' : ''}">${c.label}</th>`).join('')}<th></th></tr></thead><tbody>
      ${list.map((r) => `<tr>${cfg.cols.map((c) => cell(c, r)).join('')}<td class="acts" data-label="Actions">${cfg.quick && canAdd ? `<button class="btn sm ghost" data-q="${r.id}">${cfg.quick(r).label}</button> ` : ''}
      ${canAdd ? `<button class="btn sm ghost" data-e="${r.id}">Edit</button>` : ''} ${canDel ? `<button class="btn sm ghost" data-d="${r.id}">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${I(cfg.icon)}<h2>${rows.length ? 'Nothing matches' : cfg.emptyTitle}</h2><p>${rows.length ? 'Try a different search or filter.' : cfg.emptyText}</p></div>`;
    $s.innerHTML = cfg.summary ? cfg.summary(list, X) : '';
  }

  function form(row) {
    if (!permitted() || !loaded) return;
    const d = X.dlg(), r = row || {}, id = row?.id || draftId(); let c = r.currency || base, saving = false, fxSeq = 0, attempted = false;
    const inp = (f) => {
      const v = r[f.k] ?? (typeof f.def === 'function' ? f.def(X) : f.def) ?? '', req = f.req ? 'required' : '';
      if (f.type === 'select') return `<select name="${f.k}" ${req}>${f.req ? '' : '<option value="">—</option>'}${f.options.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      if (f.type === 'bool') return `<select name="${f.k}">${f.req ? '' : '<option value="">Not checked</option>'}<option value="true" ${v === true ? 'selected' : ''}>Yes</option><option value="false" ${v === false ? 'selected' : ''}>No</option></select>`;
      if (f.type === 'ref') return `<select name="${f.k}" ${req}><option value="">—</option>${refs[f.ref].map(([id, n]) => `<option value="${id}" ${id === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
      if (f.type === 'money') return `<input name="${f.k}" type="number" step="${10 ** -digits(c)}" min="0" inputmode="decimal" ${req} value="${row && r[f.k] != null ? r[f.k] / 10 ** digits(c) : ''}">`;
      if (f.type === 'textarea') return `<textarea name="${f.k}" ${req}>${esc(v)}</textarea>`;
      return `<input name="${f.k}" type="${f.type || 'text'}" ${req} value="${esc(v)}" ${f.type === 'number' ? `step="${f.step ?? 'any'}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}` : ''}>`;
    };
    const farmDef = r.farm_id ?? (S.farmId !== 'all' ? S.farmId : '');
    d.innerHTML = `<form id="rf"><h2>${row ? 'Edit' : 'Add'} ${cfg.singular}</h2><div style="margin-top:var(--sp-4)">
      ${cfg.farmScoped === false ? '' : `<label class="field">Farm<select name="farm_id" ${cfg.farmOrNull ? '' : 'required'}>${cfg.farmOrNull ? '<option value="">All farms</option>' : ''}${refs.farms.map(([id, n]) => `<option value="${id}" ${id === farmDef ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`}
      ${cfg.fields.map((f) => `<label class="field"><span${f.type === 'money' ? ` data-money="${f.k}"` : ''}>${esc(f.label)}${f.type === 'money' ? ` (${esc(c)})` : ''}</span>${inp(f)}</label>`).join('')}
      ${cfg.multi ? `<label class="field">Currency<select name="currency">${cur.map((x) => `<option ${x === c ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        ${cfg.fx ? `<label class="field" id="fxw" hidden>Exchange rate (1 ${'<span id="fxc"></span>'} = ? ${base})<input name="fx" type="number" step="any" min="0" value="${r.fx_rate && r.currency !== base ? fix(r.fx_rate / scale(r.currency)) : ''}"></label>` : ''}` : ''}
      </div><p class="err" id="rmsg" role="alert"></p><div class="actions"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn">Save</button></div></form>`;
    $('#cx', d).onclick = () => { if (!saving) d.close(); };
    d.oncancel = (e) => { if (saving) e.preventDefault(); };
    const fxw = $('#fxw', d);
    const sync = async () => { const my = ++fxSeq, cc = d.querySelector('[name=currency]')?.value || base;
      for (const f of cfg.fields.filter((f) => f.type === 'money')) { d.querySelector(`[data-money="${f.k}"]`).textContent = `${f.label} (${cc})`; d.querySelector(`[name="${f.k}"]`).step = String(10 ** -digits(cc)); }
      if (!fxw) { c = cc; return; }
      fxw.hidden = cc === base; $('#fxc', d).textContent = cc;
      const inpFx = d.querySelector('[name=fx]'); inpFx.required = cc !== base;
      if (cc !== c) inpFx.value = '';
      c = cc;
      if (cc !== base && !inpFx.value) { try { const [x] = await db.select('fx_rates', `${scope}&currency=eq.${cc}&order=as_of.desc&limit=1`); if (x && my === fxSeq && !inpFx.value) inpFx.value = fix(x.rate / scale(cc)); } catch {} } };
    d.querySelector('[name=currency]')?.addEventListener('change', sync); sync();
    $('#rf', d).onsubmit = async (e) => { e.preventDefault(); if (saving) return;
      const controls = [...e.target.elements], submit = d.querySelector('button:not([type="button"])');
      try {
        if (!permitted()) throw new Error('Your workspace or permissions changed. Close this form and reopen the current list.');
        if (!e.target.reportValidity()) return;
        $('#rmsg', d).textContent = '';
        const v = Object.fromEntries(new FormData(e.target)), out = {}, cc = v.currency || base;
        if (cfg.multi && !cur.includes(cc)) throw new Error('Choose a supported currency.');
        for (const f of cfg.fields) {
          let x = String(v[f.k] ?? '').trim();
          if (f.req && !x) throw new Error(`Enter ${f.label.toLowerCase()}.`);
          if (f.type === 'money') x = minorAmount(x, cc);
          else if (f.type === 'bool') x = x === '' ? null : x === 'true';
          else if (f.type === 'number') { x = x === '' ? null : Number(x); if (x != null && (!Number.isFinite(x) || (f.min != null && x < f.min) || (f.max != null && x > f.max) || (f.step === 1 && !Number.isInteger(x)))) throw new Error(`Enter a valid ${f.label.toLowerCase()}.`); }
          else if (x === '') x = null;
          if (f.type === 'ref' && x && !refs[f.ref].some(([id]) => id === x)) throw new Error(`Choose ${f.label.toLowerCase()} from this workspace.`);
          out[f.k] = x;
        }
        if (cfg.farmScoped !== false) { out.farm_id = v.farm_id || null; if (out.farm_id && !refs.farms.some(([id]) => id === out.farm_id)) throw new Error('Choose a farm from this workspace.'); }
        if (out.category_id && out.kind && referenceRows.categories.find((category) => category.id === out.category_id)?.kind !== out.kind) throw new Error(`Choose an ${out.kind} category for this transaction.`);
        if (out.start_date && out.end_date && out.end_date < out.start_date) throw new Error('The end date must be on or after the start date.');
        if (cfg.table === 'tasks') out.done_at = out.status === 'done' ? (row?.status === 'done' ? row.done_at || new Date().toISOString() : new Date().toISOString()) : null;
        if (cfg.multi) { out.currency = cc; if (cfg.fx) { out.fx_rate = cc === base ? 1 : fix(Number(v.fx) * scale(cc)); if (!Number.isFinite(out.fx_rate) || out.fx_rate < 0.00000001 || out.fx_rate >= 1e10) throw new Error('Enter a valid exchange rate greater than zero.'); if (!Number.isSafeInteger(Math.round(out.amount * out.fx_rate))) throw new Error('The converted amount is too large to record accurately.'); } }
        saving = true; controls.forEach((control) => { control.disabled = true; }); if (submit) submit.textContent = 'Saving…';
        if (row) await db.update(cfg.table, row.id, out);
        else {
          // A lost POST response is ambiguous. On a manual retry, recover only
          // this dialog's exact UUID in this workspace before writing again.
          const existing = attempted ? await db.select(cfg.table, `${scope}&id=eq.${id}&select=id&limit=1`) : [];
          attempted = true;
          if (existing.length) await db.update(cfg.table, id, out);
          else await db.insert(cfg.table, { ...out, id, workspace_id: workspace });
        }
        if (cfg.fx && cc !== base && X.canWrite()) db.upsert('fx_rates', { workspace_id: workspace, currency: cc, rate: out.fx_rate, as_of: X.today?.() || new Date().toISOString().slice(0, 10) }, 'workspace_id,currency,as_of').catch(() => {});
        d.close(); toast(row ? 'Saved' : 'Added'); await reload();
      } catch (x) { $('#rmsg', d).textContent = x.message; }
      finally { saving = false; controls.forEach((control) => { control.disabled = false; }); if (submit) submit.textContent = 'Save'; }
    };
    d.showModal();
  }
  const $ = (s, p = el) => p.querySelector(s);
  async function reload() {
    const my = ++loadSeq; $t.setAttribute('aria-busy', 'true');
    try { const result = await fetchRows(); if (my !== loadSeq) return; rows = cfg.normaliseRows ? cfg.normaliseRows(result, X) : result; loaded = true; paint(); }
    catch (e) { if (my !== loadSeq) return; $t.innerHTML = `<div class="empty"><h2>Couldn’t load ${esc(cfg.title.toLowerCase())}</h2><p role="alert">${esc(e.message)}</p><button class="btn ghost" id="retry">Try again</button></div>`; $('#retry')?.addEventListener('click', reload); }
    finally { if (my === loadSeq) $t.setAttribute('aria-busy', 'false'); }
  }
  function csv() {
    const L = visible(), val = (c, r) => (c.t === 'money' ? (r[c.k] ?? 0) / 10 ** digits(r.currency || base) : c.t && c.t !== 'badge' ? lbl(c.t, r[c.k]) : r[c.k] ?? '');
    const t = [cfg.cols.map((c) => c.label), ...L.map((r) => cfg.cols.map((c) => val(c, r)))].map((a) => a.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv' })); a.download = `${cfg.table}-${S.month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    if (!row || b.disabled || !permitted()) return;
    try {
      if (b.dataset.e) form(row);
      if (b.dataset.q) { b.disabled = true; await db.update(cfg.table, id, cfg.quick(row).patch); await reload(); }
      if (b.dataset.d && canDel && X.canWrite() && confirm(`Delete this ${cfg.singular}? This can’t be undone.`)) { b.disabled = true; await db.remove(cfg.table, id); toast('Deleted'); await reload(); }
    } catch (x) { toast(x.message); } finally { b.disabled = false; } };
  await reload();
  if (loaded && X.addRequested && canAdd) { X.consumeAdd?.(); X.addRequested = false; form(); }
}
