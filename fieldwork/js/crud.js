// Config-driven list + form for one table. Used by every module so each stays ~20 lines.
import * as C from './components.js';
import { registerUnsaved, confirmLeave } from './feedback.js';
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

function fieldError(field,value,currency){
  const text=String(value??'').trim(),label=field.label.toLowerCase();
  if(!text)return field.req?`Enter ${label}.`:'';
  if(field.type==='money'){try{minorAmount(text,currency);}catch(error){return error.message;}}
  if(field.type==='number'){
    const n=Number(text);if(!Number.isFinite(n)||(field.min!=null&&n<field.min)||(field.max!=null&&n>field.max)||(field.step===1&&!Number.isInteger(n)))return `Enter a valid ${label}${field.min!=null&&field.max!=null?` between ${field.min} and ${field.max}`:field.min!=null?` of at least ${field.min}`:field.max!=null?` of at most ${field.max}`:''}.`;
  }
  if(field.type==='date'){
    const date=new Date(`${text}T12:00:00Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==text)return `Enter a valid ${label}.`;
    if(field.min&&text<field.min||field.max&&text>field.max)return `Choose ${label} within the allowed range.`;
  }
  if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return 'Enter a valid email address.';
  return '';
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
  const moduleKey = cfg.module || ({ farms: 'farms', tasks: 'daily', transactions: 'finances', recurring_payments: 'finances', categories: 'finances', projects: 'infrastructure', enterprises: 'livestock', enterprise_records: 'livestock', workers: 'workers', funding_opportunities: 'funding', vendor_bills: 'finances' })[cfg.table] || 'vendors';
  const moduleWrite = () => (S.role !== 'worker' || cfg.workerWrite === true) && !(S.farmIds != null && ['categories', 'fx_rates'].includes(cfg.table))
    && (X.permissions?.canWriteModule ? X.permissions.canWriteModule(moduleKey) : X.canWrite() || (cfg.workerWrite && S.role === 'worker'));
  if (X.permissions?.canReadModule && !X.permissions.canReadModule(moduleKey)) { el.innerHTML = C.emptyState({ title: 'This section is unavailable for your role', text: 'Ask a workspace admin if you need access.', icon: I(cfg.icon) }); return; }
  const workspace = S.ws.id, scope = `workspace_id=eq.${workspace}`, base = S.ws.currency, scale = (c) => 10 ** (digits(base) - digits(c)), fix = (x) => Number(x.toPrecision(12)), canAdd = moduleWrite(), canDel = moduleWrite() && (X.permissions?.canDeleteModule ? X.permissions.canDeleteModule(moduleKey) : X.canWrite());
  const actor = X.uid?.();
  const permitted = () => S.ws?.id === workspace && (!actor || X.uid?.() === actor) && moduleWrite();
  const canCreate = canAdd && cfg.canCreate !== false && !(cfg.table === 'farms' && S.farmIds != null), canDuplicate = canCreate && cfg.canDuplicate !== false;
  const refs = { farms: S.farms.map((f) => [f.id, f.name]) }, referenceRows = {};
  for (const r of cfg.refs || []) {
    referenceRows[r] = await db.select(r, `${scope}&select=${r === 'categories' ? 'id,name,kind' : r === 'enterprises' ? 'id,name,farm_id' : 'id,name'}&order=name`);
    if (r === 'enterprises' && S.farmId !== 'all') referenceRows[r] = referenceRows[r].filter((e) => e.farm_id === S.farmId);
    refs[r] = referenceRows[r].map((x) => [x.id, r === 'categories' ? `${x.name} (${x.kind})` : x.name]);
  }
  const cur = cfg.multi ? (await db.select('currencies', 'order=code')).map((c) => c.code) : [];
  const incoming=X.filters||{},uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const initialFilters=Object.fromEntries((cfg.filters||[]).filter(f=>incoming[f.k]&&(f.ref?(refs[f.ref]||[]).some(([id])=>id===incoming[f.k]):f.options?.includes(incoming[f.k]))).map(f=>[f.k,incoming[f.k]]));
  let serverFilters={...(uuid(incoming.id)?{id:incoming.id}:{}),...(cfg.table==='transactions'&&uuid(incoming.enterprise_id)&&X.migrationReady?{enterprise_id:incoming.enterprise_id}:{}),
    ...(cfg.table==='transactions'&&['recurring','worker_pay'].includes(incoming.source_type)?{source_type:incoming.source_type}:{}),...(cfg.table==='tasks'&&incoming.completed_on&&!fieldError({label:'Completion date',type:'date'},incoming.completed_on,base)?{completed_on:incoming.completed_on}:{})};
  let rows = [], q = String(incoming.q||'').trim().toLowerCase(), flt = initialFilters, loaded = false, loadSeq = 0, page = 1, pageSize = 25, sort = { key: '', direction: 'asc' }, confirmingDelete = false;
  const selected = new Set(), hiddenColumns = new Set(), pendingDeletes = new Map(), pendingQuick = new Set();
  const lbl = (rk, id) => (refs[rk] || []).find((r) => r[0] === id)?.[1] || '';

  async function fetchRows() {
    if (cfg.load) {
      const result = await cfg.load(X);
      return result.filter((row) => (cfg.farmScoped === false || S.farmId === 'all' || row.farm_id === S.farmId || (cfg.farmOrNull && !row.farm_id))&&Object.entries(serverFilters).every(([key,value])=>key==='completed_on'?new Date(row.done_at).toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'})===value:row[key]===value));
    }
    let qs = `${scope}&select=*&order=${cfg.order || 'created_at.desc'}`;
    for(const [key,value] of Object.entries(serverFilters)){
      if(key==='completed_on'){const start=new Date(`${value}T00:00:00+03:00`),end=new Date(+start+86400000);qs+=`&done_at=gte.${encodeURIComponent(start.toISOString())}&done_at=lt.${encodeURIComponent(end.toISOString())}`;}
      else qs+=`&${key}=eq.${encodeURIComponent(value)}`;
    }
    if (cfg.farmScoped !== false && S.farmId !== 'all') qs += cfg.farmOrNull ? `&or=(farm_id.eq.${S.farmId},farm_id.is.null)` : `&farm_id=eq.${S.farmId}`;
    if (cfg.monthField) { const [a, b] = monthRange(); qs += `&${cfg.monthField}=gte.${a}&${cfg.monthField}=lt.${b}`; }
    if (cfg.table === 'enterprise_records' && S.farmId !== 'all') {
      if (!refs.enterprises.length) return [];
      qs += `&enterprise_id=in.(${refs.enterprises.map(([id]) => id).join(',')})`;
    }
    const result = [];
    for (let offset = 0; offset < 10000; offset += 1000) {
      const batch = await db.select(cfg.table, `${qs}&limit=1000&offset=${offset}`); result.push(...batch);
      if (batch.length < 1000) break;
    }
    return result;
  }
  const cellValue = (c, r) => {
    const v = r[c.k];
    if (c.render) return c.render(r, X);
    if (c.t === 'money') return `<span class="${c.signed ? (r.kind === 'income' ? 'pos' : 'neg') : ''}">${c.signed && r.kind === 'expense' ? '−' : ''}${v == null ? '—' : money(v, r.currency || base)}</span>`;
    if (c.t === 'badge') return C.badge({ label: v || 'Not set', tone: ({ ok: 'positive', warn: 'warning', neg: 'negative', info: 'info' })[(cfg.badges || {})[v]] || 'neutral' });
    if (c.t) return esc(lbl(c.t, v) || '—');
    return esc(v ?? '—');
  };
  const visible = () => {
    const list = rows.filter((r) => !pendingDeletes.has(r.id) && Object.entries(flt).every(([k, v]) => !v || String(r[k] ?? '') === v) &&
      (!q || [...(cfg.search || [])].some((k) => String(r[k] ?? '').toLowerCase().includes(q)) || cfg.cols.some((c) => c.t && c.t !== 'money' && c.t !== 'badge' && lbl(c.t, r[c.k]).toLowerCase().includes(q))));
    if (sort.key) {
      const column = cfg.cols.find((c) => c.k === sort.key), value = (row) => column?.sortValue ? column.sortValue(row) : column?.t && !['money', 'badge'].includes(column.t) ? lbl(column.t, row[column.k]) : row[sort.key];
      list.sort((a, b) => { const av = value(a), bv = value(b); const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }); return sort.direction === 'desc' ? -result : result; });
    }
    return list;
  };

  function paint() {
    const list = visible(), pages = Math.max(1, Math.ceil(list.length / pageSize)); page = Math.min(page, pages);
    const slice = list.slice((page - 1) * pageSize, page * pageSize);
    $t.innerHTML = list.length ? C.dataTable({ caption: cfg.title, rows: slice, selectable: canAdd, selected, sort,
      columns: cfg.cols.filter((c) => !hiddenColumns.has(c.k)).map((c) => ({ key: c.k, label: c.label, numeric: c.t === 'money' || c.t === 'number', sortable: true, render: (row) => cellValue(c, row) })),
      actions: (row) => `<div class="ui-row-actions">${cfg.quick && canAdd ? C.button({ label: pendingQuick.has(row.id)?'Saving…':cfg.quick(row).label, size: 'sm', variant: 'secondary', attrs: { 'data-q': row.id,disabled:pendingQuick.has(row.id),'aria-busy':pendingQuick.has(row.id)?'true':null } }) : ''}${C.actionMenu({ label: `Actions for ${cfg.singular}`, items: [
        { label: 'View details', attrs: { 'data-v': row.id } }, ...(canAdd ? [{ label: 'Edit', attrs: { 'data-e': row.id,disabled:pendingQuick.has(row.id) } }] : []), ...(canDuplicate ? [{ label: 'Duplicate', attrs: { 'data-copy': row.id,disabled:pendingQuick.has(row.id) } }] : []), ...(canDel ? [{ label: 'Delete', variant: 'danger', attrs: { 'data-d': row.id,disabled:pendingQuick.has(row.id) } }] : []),
      ] })}</div>` })
      : C.emptyState({ icon: I(cfg.icon), title: rows.length ? 'No matching records' : cfg.emptyTitle, text: rows.length ? 'Try another search or remove a filter.' : cfg.emptyText, action: rows.length ? C.button({ label: 'Clear filters', variant: 'secondary', attrs: { 'data-clear-filters': true } }) : canCreate ? C.button({ label: `Add ${cfg.singular}`, attrs: { 'data-add-record': true } }) : '' });
    $s.innerHTML = cfg.summary ? cfg.summary(list, X) : '';
    const checked = $t.querySelector('[data-select-page]'); if (checked) { checked.checked = slice.length > 0 && slice.every((row) => selected.has(row.id)); checked.indeterminate = !checked.checked && slice.some((row) => selected.has(row.id)); }
    $('#pagination').innerHTML = `<span class="ui-result-count" aria-live="polite">${list.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, list.length)}` : '0'} of ${list.length} records${rows.length >= 10000 ? ' · First 10,000 loaded; narrow the farm or month for more.' : ''}</span><div class="btns">${C.select({ value: String(pageSize), options: ['25', '50', '100'], attrs: { 'data-page-size': true, 'aria-label': 'Records per page' } })}${C.button({ label: 'Previous', size: 'sm', variant: 'ghost', attrs: { 'data-page': page - 1, 'data-page-direction': 'previous', disabled: page <= 1 } })}<span>Page ${page} of ${pages}</span>${C.button({ label: 'Next', size: 'sm', variant: 'ghost', attrs: { 'data-page': page + 1, 'data-page-direction': 'next', disabled: page >= pages } })}</div>`;
    $('#bulkbar').hidden = !selected.size;
    $('#bulkbar').innerHTML = `<strong>${selected.size} selected</strong><div class="btns">${C.button({ label: 'Export selected', size: 'sm', variant: 'secondary', attrs: { 'data-bulk-export': true } })}${canDel ? C.button({ label: 'Delete selected', size: 'sm', variant: 'danger', attrs: { 'data-bulk-delete': true } }) : ''}${C.button({ label: 'Clear selection', size: 'sm', variant: 'ghost', attrs: { 'data-clear-selection': true } })}</div>`;
    $('#chips').innerHTML = [...(q ? [{ key: '__search', label: `Search: ${q}` }] : []), ...Object.entries(flt).filter(([, value]) => value).map(([key, value]) => ({ key, label: `${cfg.filters.find((f) => f.k === key)?.label || key}: ${lbl(cfg.filters.find((f) => f.k === key)?.ref, value) || value}` })),...Object.entries(serverFilters).map(([key,value])=>({key:`__server_${key}`,label:`${({id:'Selected record',enterprise_id:'Enterprise',source_type:'Source',completed_on:'Completed on'})[key]}: ${key==='id'?'From dashboard':key==='enterprise_id'?lbl('enterprises',value)||'Selected enterprise':key==='source_type'?value==='worker_pay'?'Worker pay':'Recurring payment':value}`}))]
      .map((chip) => `<span class="ui-chip">${esc(chip.label)}<button type="button" data-remove-filter="${esc(chip.key)}" aria-label="Remove ${esc(chip.label)}">×</button></span>`).join('');
    bindRowMenus();
  }

  function form(row, mode = row ? 'edit' : 'create') {
    const viewing = mode === 'view', editing = row && mode === 'edit';
    if ((!viewing && (!permitted() || (!editing && !canCreate) || (mode === 'duplicate' && !canDuplicate))) || !loaded) return;
    const d = X.dlg(), r = row || {}, id = editing ? row.id : draftId(); let c = r.currency || base, saving = false, fxSeq = 0, attempted = false, dirty = false;
    if(row&&['view','edit'].includes(mode))X.onViewed?.({table:cfg.table,row,mode});
    const inp = (f) => {
      const v = r[f.k] ?? (typeof f.def === 'function' ? f.def(X) : f.def) ?? '', req = f.req ? 'required' : '';
      let type = f.type || 'text', value = v, options = f.options || [], attrs = { disabled: viewing }, labelHTML;
      if (type === 'bool') { type = 'select'; value = v === '' ? '' : String(v); options = [...(f.req ? [] : [{ value: '', label: 'Not checked' }]), { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]; }
      if (type === 'ref') { type = 'select'; options = [{ value: '', label: `Choose ${f.label.toLowerCase()}` }, ...refs[f.ref].map(([value, label]) => ({ value, label }))]; }
      if (f.type === 'money') { type = 'number'; value = r[f.k] != null ? r[f.k] / 10 ** digits(c) : f.def ?? ''; attrs = { ...attrs, step: 10 ** -digits(c), min: 0, inputmode: 'decimal' }; labelHTML = `<span data-money="${f.k}">${esc(f.label)} (${esc(c)})</span>`; }
      else if (type === 'number') attrs = { ...attrs, step: f.step ?? 'any', min: f.min, max: f.max };
      return `<div${f.type === 'textarea' ? ' class="ui-field-wide"' : ''}>${C.field({ label: f.label, labelHTML, name: f.k, type, value, options, required: f.req, hint: f.hint || '', attrs })}</div>`;
    };
    const farmDef = r.farm_id ?? (S.farmId !== 'all' ? S.farmId : refs.farms.length === 1 ? refs.farms[0][0] : '');
    const basic=new Set(cfg.basicFields||['category_id','description','due_date','quantity','unit']),advanced=cfg.fields.filter(f=>!f.req&&!basic.has(f.k));
    const advancedBody=advanced.map(inp).join('')+(cfg.multi?C.field({label:'Currency',name:'currency',type:'select',value:c,options:cur,attrs:{disabled:viewing}}):'')+
      (cfg.fx?`<div id="fxw" hidden>${C.field({label:'Exchange rate',labelHTML:`Exchange rate (1 <span id="fxc"></span> = ? ${esc(base)})`,name:'fx',type:'number',value:r.fx_rate&&r.currency!==base?fix(r.fx_rate/scale(r.currency)):'',hint:'Use the amount of base currency for one unit of the selected currency.',attrs:{step:'any',min:0,disabled:viewing}})}</div>`:'');
    const body = `<form id="rf" novalidate><div class="ui-form-grid">${cfg.farmScoped === false ? '' : C.field({ label: 'Farm', name: 'farm_id', type: 'select', value: farmDef, required: !cfg.farmOrNull, options: [{ value: '', label: cfg.farmOrNull ? 'All farms' : 'Choose a farm' }, ...refs.farms.map(([value, label]) => ({ value, label }))], attrs: { disabled: viewing } })}${cfg.fields.filter(f=>f.req||basic.has(f.k)).map(inp).join('')}</div>${advancedBody?C.details({label:'More options',open:viewing||c!==base||advanced.some(f=>r[f.k]!=null&&r[f.k]!==''),body:`<div class="ui-form-grid">${advancedBody}</div>`}):''}<p class="ui-form-message" id="rmsg" role="alert"></p></form>`;
    const panel=C.openPanel(d,{presentation:'drawer',title: `${viewing ? 'View' : mode === 'duplicate' ? 'Duplicate' : editing ? 'Edit' : 'Add'} ${cfg.singular}`, description: viewing ? 'Record details in this workspace.' : mode === 'duplicate' ? 'Review these details, then save a new record.' : 'Required fields are marked with an asterisk.', body,
      actions: C.button({ label: viewing ? 'Close' : 'Cancel', variant: 'ghost', attrs: { id: 'cx' } }) + (viewing ? canAdd ? C.button({ label: 'Edit record', attrs: { id: 'edit-detail' } }) : '' : C.button({ label: editing ? 'Save changes' : 'Save record', type: 'submit', attrs: { form: 'rf' } })) });
    const formElement=$('#rf',d), messageElement=$('#rmsg',d), sameForm=()=>d.querySelector('#rf')===formElement,currentForm=()=>permitted()&&sameForm();
    const unregister=registerUnsaved({element:formElement,isDirty:()=>dirty,isSaving:()=>saving,isActive:()=>d.open&&d.querySelector('#rf')===formElement});
    const closeRequested = async () => { if (!saving && (!dirty || await confirmLeave())) {dirty=false;unregister();d.close();} };
    $('#cx', d).onclick = closeRequested;const closeButton=d.querySelector('[data-drawer-close]');closeButton?.removeEventListener('click',panel.close);closeButton?.addEventListener('click', closeRequested);
    $('#edit-detail', d)?.addEventListener('click', () => form(row));
    d.oncancel = (e) => {e.preventDefault();closeRequested();};
    const inlineError = (name, message) => { const control = d.querySelector(`[name="${name}"]`), error = d.querySelector(`[data-error-for="${name}"]`); control?.setAttribute('aria-invalid', message ? 'true' : 'false');if(message&&control?.closest('details'))control.closest('details').open=true; if (error) { error.textContent = message; error.hidden = !message; } };
    const touched=new Set();
    const validate=(name)=>{
      const values=Object.fromEntries(new FormData(formElement)),cc=values.currency||base,f=cfg.fields.find(field=>field.k===name);
      let message=f?fieldError(f,values[name],cc):name==='farm_id'&&!cfg.farmOrNull&&!values.farm_id?'Choose a farm.':'';
      if(!message&&name==='fx'&&cfg.fx&&cc!==base&&(!Number.isFinite(Number(values.fx))||Number(values.fx)<=0))message='Enter an exchange rate greater than zero.';
      if(!message&&name==='category_id'&&values.category_id&&values.kind&&referenceRows.categories?.find(category=>category.id===values.category_id)?.kind!==values.kind)message=`Choose an ${values.kind} category for this transaction.`;
      if(!message&&name==='enterprise_id'&&values.enterprise_id&&referenceRows.enterprises?.find(enterprise=>enterprise.id===values.enterprise_id)?.farm_id!==values.farm_id)message='Choose an enterprise on the selected farm.';
      if(!message&&name==='end_date'&&values.start_date&&values.end_date&&values.end_date<values.start_date)message='The end date must be on or after the start date.';
      if(!message&&name==='due_on'&&values.issued_on&&values.due_on&&values.due_on<values.issued_on)message='The due date must be on or after the issue date.';
      if(!message&&name==='paid_amount'&&values.amount&&values.paid_amount){try{if(minorAmount(values.paid_amount,cc)>minorAmount(values.amount,cc))message='Paid amount cannot exceed the bill amount.';}catch{}}
      inlineError(name,message);return message;
    };
    const changed=(event)=>{dirty=true;if(event.target.name)touched.add(event.target.name);for(const name of touched)validate(name);};
    formElement.addEventListener('input',changed);formElement.addEventListener('change',changed);
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
    $('#rf', d).onsubmit = async (e) => { e.preventDefault(); if (saving || viewing) return;
      const controls = [...d.querySelectorAll('button,input,select,textarea')], submit = d.querySelector('button:not([type="button"])');
      const fail = (name, message) => { throw Object.assign(new Error(message), { field: name }); };
      try {
        if (!permitted()) throw new Error('Your workspace or permissions changed. Close this form and reopen the current list.');
        const native = controls.find((control) => control.willValidate && control.validity && !control.validity.valid);
        if (native) fail(native.name, native.validationMessage || 'Review this field.');
        $('#rmsg', d).textContent = '';
        const v = Object.fromEntries(new FormData(e.target)), out = {}, cc = v.currency || base;
        if (cfg.multi && !cur.includes(cc)) throw new Error('Choose a supported currency.');
        for (const f of cfg.fields) { try {
          let x = String(v[f.k] ?? '').trim();
          const invalid=fieldError(f,x,cc);if(invalid)throw new Error(invalid);
          if (f.type === 'money') x = minorAmount(x, cc);
          else if (f.type === 'bool') x = x === '' ? null : x === 'true';
          else if (f.type === 'number') { x = x === '' ? null : Number(x); if (x != null && (!Number.isFinite(x) || (f.min != null && x < f.min) || (f.max != null && x > f.max) || (f.step === 1 && !Number.isInteger(x)))) throw new Error(`Enter a valid ${f.label.toLowerCase()}.`); }
          else if (x === '') x = null;
          if (f.type === 'ref' && x && !refs[f.ref].some(([id]) => id === x)) throw new Error(`Choose ${f.label.toLowerCase()} from this workspace.`);
          out[f.k] = x;
        } catch (error) { error.field ||= f.k; throw error; } }
        if (cfg.farmScoped !== false) { out.farm_id = v.farm_id || null; if (!cfg.farmOrNull && !out.farm_id) fail('farm_id', 'Choose a farm.'); if (out.farm_id && !refs.farms.some(([id]) => id === out.farm_id)) fail('farm_id', 'Choose a farm from this workspace.'); }
        if (out.category_id && out.kind && referenceRows.categories.find((category) => category.id === out.category_id)?.kind !== out.kind) fail('category_id', `Choose an ${out.kind} category for this transaction.`);
        if (cfg.table === 'transactions' && out.enterprise_id && referenceRows.enterprises.find((enterprise) => enterprise.id === out.enterprise_id)?.farm_id !== out.farm_id) fail('enterprise_id', 'Choose an enterprise on the selected farm.');
        if (out.start_date && out.end_date && out.end_date < out.start_date) fail('end_date', 'The end date must be on or after the start date.');
        if (cfg.table === 'vendor_bills' && out.paid_amount > out.amount) fail('paid_amount', 'Paid amount cannot exceed the bill amount.');
        if (cfg.table === 'vendor_bills' && out.due_on && out.issued_on && out.due_on < out.issued_on) fail('due_on', 'The due date must be on or after the issue date.');
        if (cfg.table === 'tasks') out.done_at = out.status === 'done' ? (editing && row.status === 'done' ? row.done_at || new Date().toISOString() : new Date().toISOString()) : null;
        if (cfg.multi) { out.currency = cc; if (cfg.fx) { out.fx_rate = cc === base ? 1 : fix(Number(v.fx) * scale(cc)); if (!Number.isFinite(out.fx_rate) || out.fx_rate < 0.00000001 || out.fx_rate >= 1e10) fail('fx', 'Enter a valid exchange rate greater than zero.'); if (!Number.isSafeInteger(Math.round(out.amount * out.fx_rate))) fail('amount', 'The converted amount is too large to record accurately.'); } }
        saving = true; controls.forEach((control) => { control.disabled = true; }); if (submit) submit.textContent = 'Saving…';
        if (editing) await db.update(cfg.table, row.id, out);
        else {
          // A lost POST response is ambiguous. On a manual retry, recover only
          // this dialog's exact UUID in this workspace before writing again.
          const existing = attempted ? await db.select(cfg.table, `${scope}&id=eq.${id}&select=id&limit=1`) : [];
          attempted = true;
          if (existing.length) await db.update(cfg.table, id, out);
          else await db.insert(cfg.table, { ...out, id, workspace_id: workspace });
        }
        dirty = false;unregister();if(!currentForm())return;
        if (cfg.fx && cc !== base && X.canWrite() && S.farmIds == null) db.upsert('fx_rates', { workspace_id: workspace, currency: cc, rate: out.fx_rate, as_of: X.today?.() || new Date().toISOString().slice(0, 10) }, 'workspace_id,currency,as_of').catch(() => {});
        d.close(); toast(editing ? 'Saved' : 'Added');
        try { await cfg.afterChange?.({ action: editing ? 'update' : 'insert', id }); } catch (error) {if(permitted())toast(`Record saved. ${error.message}`);}
        if(permitted())await reload();
      } catch (x) { if(sameForm()&&(!saving||permitted())){messageElement.textContent = x.message; if (x.field) { inlineError(x.field, x.message); d.querySelector(`[name="${x.field}"]`)?.focus(); }} }
      finally { saving = false; controls.forEach((control) => { control.disabled = false; }); if (submit) submit.textContent = 'Save'; }
    };
    if (!d.open) d.showModal();
    d.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus();
  }
  const $ = (s, p = el) => p.querySelector(s);
  function bindRowMenus() {
    $t.querySelectorAll('details.ui-menu').forEach((menu) => menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      $t.querySelectorAll('details.ui-menu[open]').forEach((other) => { if (other !== menu) other.open = false; });
      const panel = menu.querySelector('.ui-menu-panel'), rect = menu.querySelector('summary').getBoundingClientRect();
      if (panel) { panel.style.position = 'fixed'; panel.style.right = 'auto'; panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 196, rect.right - 188))}px`; panel.style.top = `${Math.max(8, Math.min(window.innerHeight - panel.offsetHeight - 8, rect.bottom + 4))}px`; }
    }));
  }
  async function scheduleDelete(list) {
    if (!canDel || !permitted() || !list.length || confirmingDelete) return;
    confirmingDelete = true; let confirmed;
    try { confirmed = await C.confirmDialog({ title: `Delete ${list.length === 1 ? `this ${cfg.singular}` : `${list.length} selected records`}?`, text: `${cfg.deleteWarning || 'This record will be removed.'} You can undo for 6 seconds before anything is deleted.`, confirmLabel: 'Delete', danger: true }); }
    finally { confirmingDelete = false; }
    if (!confirmed || !permitted()) return;
    const ids = list.map((row) => row.id); let cancelled = false;
    ids.forEach((id) => { pendingDeletes.set(id, true); selected.delete(id); }); paint();
    const undo = () => { if (cancelled) return; cancelled = true; clearTimeout(timer); ids.forEach((id) => pendingDeletes.delete(id)); paint(); toast('Deletion cancelled.'); };
    const notification = C.toast(`${list.length === 1 ? C.escapeHTML(cfg.singular) : `${list.length} records`} scheduled for deletion`, { action: 'Undo', onAction: undo, timeout: 6000 });
    const timer = setTimeout(async () => {
      if (cancelled) return;
      if (!permitted()) { undo(); return; }
      let removed = 0; const failures = [];
      for (const row of list) {
        if(!permitted())break;
        try { await db.remove(cfg.table, row.id); rows = rows.filter((r) => r.id !== row.id); removed += 1; }
        catch (error) { failures.push(error.message); }
        finally { pendingDeletes.delete(row.id); }
      }
      if(!permitted()){ids.forEach(id=>pendingDeletes.delete(id));notification.dismiss();return;}
      if (removed) { try { await cfg.afterChange?.({ action: 'delete', ids }); } catch (error) { failures.push(error.message); } }
      if(!permitted()){notification.dismiss();return;}
      notification.dismiss(); paint();
      toast(failures.length ? `${removed} deleted. ${failures[0]}` : `${removed === 1 ? 'Record' : `${removed} records`} deleted.`);
    }, 6000);
  }
  async function reload() {
    const my = ++loadSeq; $t.setAttribute('aria-busy', 'true'); if (!loaded) $t.innerHTML = C.skeletonRows({ columns: Math.min(cfg.cols.length, 5) });
    try { const result = await fetchRows(); if (my !== loadSeq) return; rows = cfg.normaliseRows ? cfg.normaliseRows(result, X) : result; loaded = true; paint(); }
    catch (e) { if (my !== loadSeq) return; $t.innerHTML = C.emptyState({ title: `Couldn’t load ${cfg.title.toLowerCase()}`, text: e.message, icon: I(cfg.icon), action: C.button({ label: 'Try again', variant: 'secondary', attrs: { id: 'retry' } }) }); $('#retry')?.addEventListener('click', reload); }
    finally { if (my === loadSeq) $t.setAttribute('aria-busy', 'false'); }
  }
  function csv(selectedOnly = false) {
    const L = visible().filter((row) => !selectedOnly || selected.has(row.id)), columns = cfg.cols.filter((c) => !hiddenColumns.has(c.k)), val = (c, r) => (c.exportValue ? c.exportValue(r, X) : c.t === 'money' ? r[c.k]==null?'':r[c.k] / 10 ** digits(r.currency || base) : c.t && c.t !== 'badge' ? lbl(c.t, r[c.k]) : r[c.k] ?? '');
    const t = [columns.map((c) => c.label), ...L.map((r) => columns.map((c) => val(c, r)))].map((a) => a.map(C.csvCell).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv' })); a.download = `${cfg.table}-${S.month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const reportKey = cfg.report || moduleKey, canReport = typeof X.report === 'function' && (!X.canReport || X.canReport(reportKey));
  const moreItems=[...(canReport?[{label:'Report',attrs:{id:'module-report'}}]:[]),{label:'Export CSV',attrs:{id:'csv'}},{label:'Choose columns',attrs:{id:'columns-open'}},...(cfg.moreActions||[])];
  el.innerHTML = C.pageHeader({ title: cfg.title, eyebrow: 'Farm records', description: cfg.description || cfg.emptyText || '', actions: C.actionMenu({label:'More actions',text:'More actions',items:moreItems})+(canCreate?C.button({label:`Add ${cfg.singular}`,icon:I('plus'),attrs:{id:'add'}}):'') }) + (S.farmIds != null && cfg.table === 'categories' ? C.notice({ text: 'Categories are shared across all farms. A workspace administrator manages changes to this list.' }) : '') + `<div class="sumbar" id="sum"></div><section class="ui-resource-card" aria-label="${esc(cfg.title)}"><div class="ui-resource-toolbar">${C.input({ id: 'q', type: 'search', attrs: { placeholder: `Search ${cfg.title.toLowerCase()}`, 'aria-label': `Search ${cfg.title.toLowerCase()}` } })}${cfg.filters?.length?C.button({label:'Filters',variant:'secondary',attrs:{id:'filters-open'}}):''}</div><div class="ui-filter-chips" id="chips"></div><div class="ui-bulkbar" id="bulkbar" hidden></div><div class="ui-table-scroller" id="tbl"></div><footer class="ui-pagination" id="pagination"></footer></section>`;
  const $t = $('#tbl'), $s = $('#sum');
  $('#q').value=q;
  const resetView = () => { page = 1; selected.clear(); paint(); };
  $('#q').oninput = (e) => { q = e.target.value.trim().toLowerCase(); resetView(); };
  const optionsPanel=(columns=false)=>{
    const d=X.dlg(),panelId='resource-options';
    const body=columns?`<div class="ui-columns-panel">${cfg.cols.map(c=>`<label>${C.input({type:'checkbox',name:c.k,value:c.k,attrs:{checked:!hiddenColumns.has(c.k),'data-panel-column':true}})}${esc(c.label)}</label>`).join('')}</div>`:
      (cfg.filters||[]).map(f=>C.field({label:f.label,name:f.k,type:'select',value:flt[f.k]||'',options:[{value:'',label:'All'},...(f.ref?refs[f.ref].map(([value,label])=>({value,label})):f.options.map(value=>({value,label:value})))]})).join('');
    const panel=C.openPanel(d,{presentation:'sheet',title:columns?'Choose columns':'Filter records',body:`<form id="${panelId}" novalidate>${body}<p data-panel-message role="alert"></p></form>`,actions:C.button({label:'Cancel',variant:'ghost',attrs:{'data-options-cancel':true}})+C.button({label:'Apply',type:'submit',attrs:{form:panelId}})});
    d.querySelector('[data-options-cancel]').onclick=panel.close;
    d.querySelector('form').onsubmit=event=>{event.preventDefault();if(S.ws?.id!==workspace||(actor&&X.uid?.()!==actor))return;
      if(columns){const checked=[...d.querySelectorAll('[data-panel-column]')].filter(control=>control.checked).map(control=>control.value);if(!checked.length){d.querySelector('[data-panel-message]').textContent='Keep at least one column visible.';return;}hiddenColumns.clear();cfg.cols.forEach(c=>{if(!checked.includes(c.k))hiddenColumns.add(c.k);});}
      else{const values=Object.fromEntries(new FormData(event.target));flt=Object.fromEntries((cfg.filters||[]).filter(f=>values[f.k]).map(f=>[f.k,values[f.k]]));}
      panel.close();resetView();};
  };
  $('#filters-open')?.addEventListener('click',()=>optionsPanel());$('#columns-open')?.addEventListener('click',()=>optionsPanel(true));
  el.querySelectorAll('[data-f]').forEach((s) => (s.onchange = () => { flt[s.dataset.f] = s.value; resetView(); }));
  $('#csv').onclick = () => csv(); $('#add')?.addEventListener('click', () => form()); $('#module-report')?.addEventListener('click', () => X.report(reportKey));
  const clearFilters = () => {const reloadNeeded=Object.keys(serverFilters).length>0;serverFilters={};q = ''; flt = {}; $('#q').value = ''; el.querySelectorAll('[data-f]').forEach((control) => { control.value = ''; });page=1;selected.clear();reloadNeeded?reload():paint();};
  el.onclick = (event) => {
    const control = event.target.closest('button'); if (!control || control.disabled) return;
    if (control.dataset.page) { page = Number(control.dataset.page); paint(); if (control.dataset.pageDirection) $('#pagination').querySelector(`[data-page-direction="${control.dataset.pageDirection}"]`)?.focus(); }
    if (control.hasAttribute('data-clear-filters')) clearFilters();
    if (control.hasAttribute('data-add-record')) form();
    if (control.hasAttribute('data-bulk-export')) csv(true);
    if (control.hasAttribute('data-clear-selection')) { selected.clear(); paint(); }
    if (control.hasAttribute('data-bulk-delete')) scheduleDelete(rows.filter((row) => selected.has(row.id)));
    if (control.dataset.removeFilter) {if(control.dataset.removeFilter.startsWith('__server_')){delete serverFilters[control.dataset.removeFilter.slice(9)];page=1;selected.clear();reload();return;}if (control.dataset.removeFilter === '__search') { q = ''; $('#q').value = ''; } else { delete flt[control.dataset.removeFilter]; } resetView(); }
  };
  el.onchange = (event) => {
    const control = event.target;
    if (control.hasAttribute('data-column')) { if (!control.checked && hiddenColumns.size === cfg.cols.length - 1) { control.checked = true; return; } control.checked ? hiddenColumns.delete(control.dataset.column) : hiddenColumns.add(control.dataset.column); paint(); }
    if (control.hasAttribute('data-page-size')) { pageSize = Number(control.value); page = 1; paint(); $('#pagination').querySelector('[data-page-size]')?.focus(); }
  };
  $t.onchange = (event) => {
    const control = event.target;
    if (control.hasAttribute('data-select-row')) { control.checked ? selected.add(control.dataset.selectRow) : selected.delete(control.dataset.selectRow); paint(); $t.querySelector(`[data-select-row="${control.dataset.selectRow}"]`)?.focus(); }
    if (control.hasAttribute('data-select-page')) { visible().slice((page - 1) * pageSize, page * pageSize).forEach((row) => control.checked ? selected.add(row.id) : selected.delete(row.id)); paint(); $t.querySelector('[data-select-page]')?.focus(); }
  };
  $t.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sort) { sort = { key: b.dataset.sort, direction: sort.key === b.dataset.sort && sort.direction === 'asc' ? 'desc' : 'asc' }; paint(); $t.querySelector(`[data-sort="${sort.key}"]`)?.focus(); return; }
    const id = b.dataset.e || b.dataset.d || b.dataset.q || b.dataset.v || b.dataset.copy, row = rows.find((r) => r.id === id);
    if (!row || b.disabled) return;
    if (b.dataset.v) { b.closest('details')?.removeAttribute('open'); form(row, 'view'); return; }
    if (!permitted()) return;
    b.closest('details')?.removeAttribute('open');
    try {
      if (b.dataset.e) form(row);
      if (b.dataset.copy) form(row, 'duplicate');
      if (b.dataset.q) {
        if(pendingQuick.has(id))return;
        const before={...row},patch=cfg.quick(row).patch;pendingQuick.add(id);rows=rows.map(r=>r.id===id?{...r,...patch}:r);paint();
        try{
          const saved=await db.update(cfg.table,id,patch);
          if(!permitted())return;
          if(saved&&typeof saved==='object')rows=rows.map(r=>r.id===id?{...r,...saved}:r);
          toast(`${cfg.singular[0].toUpperCase()+cfg.singular.slice(1)} updated.`);
          try{await cfg.afterChange?.({action:'update',id});}catch(error){if(permitted())toast(`Record saved. ${error.message}`);}
        }catch(error){if(permitted()){rows=rows.map(r=>r.id===id?before:r);toast(`Change wasn’t saved. ${error.message}`);}}
        finally{pendingQuick.delete(id);if(permitted())paint();}
      }
      if (b.dataset.d) await scheduleDelete([row]);
    } catch (x) { toast(x.message); } finally { b.disabled = false; } };
  await reload();
  $t.addEventListener('scroll', () => $t.querySelectorAll('details.ui-menu[open]').forEach((menu) => { menu.open = false; }), { passive: true });
  $t.onkeydown = (event) => { if (event.key === 'Escape') { const menu = event.target.closest('details.ui-menu'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } } };
  if(loaded&&incoming.view==='1'&&serverFilters.id){const row=rows.find(r=>r.id===serverFilters.id);if(row)form(row,'view');}
  else if (loaded && X.addRequested && canCreate) { X.consumeAdd?.(); X.addRequested = false; form(); }
}
