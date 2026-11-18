// Shared vanilla UI primitives. Text/attributes are escaped; icon/render/body
// strings are trusted markup assembled by application code, never user content.
export const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const csvCell=(value)=>{if(typeof value==='number'&&Number.isFinite(value))return String(value);let text=String(value??'');if(/^(?:[\t\r\n]|[ \t\r\n]*[=+\-@])/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};
const attributes = (values = {}) => Object.entries(values).filter(([key, value]) => /^[\w:-]+$/.test(key) && !/^on/i.test(key) && value != null && value !== false)
  .map(([key, value]) => ` ${key}="${escapeHTML(value === true ? '' : value)}"`).join('');
let sequence = 0;

export function button({ label, icon = '', variant = 'primary', size = 'md', type = 'button', attrs = {} }) {
  const { class: extra = '', ...rest } = attrs;
  return `<button type="${escapeHTML(type)}" class="btn ui-button ${variant === 'primary' ? '' : variant === 'secondary' ? 'secondary' : variant === 'danger' ? 'danger' : 'ghost'} ${size === 'sm' ? 'sm' : ''} ${escapeHTML(extra)}"${attributes(rest)}>${icon}${label ? `<span>${escapeHTML(label)}</span>` : ''}</button>`;
}
export function input({ name, id, type = 'text', value = '', required = false, attrs = {} }) {
  const { class: extra = '', ...rest } = attrs;
  return `<input class="ui-input ${escapeHTML(extra)}"${attributes({ id, name, type, value, required, ...rest })}>`;
}
export function select({ name, id, value = '', options = [], required = false, attrs = {} }) {
  const { class: extra = '', ...rest } = attrs;
  return `<select class="ui-input ${escapeHTML(extra)}"${attributes({ id, name, required, ...rest })}>${options.map((item) => {
    const option = typeof item === 'object' ? item : { value: item, label: item };
    return `<option${attributes({ value: option.value, selected: String(option.value) === String(value), disabled: option.disabled })}>${escapeHTML(option.label ?? option.value)}</option>`;
  }).join('')}</select>`;
}
export function field({ label, labelHTML, name, id = `ui-${name}-${++sequence}`, type = 'text', value = '', options = [], hint = '', error = '', required = false, attrs = {} }) {
  const described = `${hint ? `${id}-hint ` : ''}${id}-error`, control = { name, id, type, value, required,
    attrs: { 'aria-describedby': described, 'aria-invalid': error ? 'true' : null, ...attrs } };
  const html = type === 'select' ? select({ ...control, options }) : type === 'textarea'
    ? `<textarea class="ui-input"${attributes({ id, name, required, rows: 3, ...control.attrs })}>${escapeHTML(value)}</textarea>` : input(control);
  return `<div class="field ui-field"><label for="${escapeHTML(id)}"><span data-field-label="${escapeHTML(name)}">${labelHTML || escapeHTML(label)}${required ? '<span class="ui-required" aria-hidden="true"> *</span>' : ''}</span></label>${html}${hint ? `<small class="ui-hint" id="${escapeHTML(id)}-hint">${escapeHTML(hint)}</small>` : ''}<small class="ui-field-error" data-error-for="${escapeHTML(name)}" id="${escapeHTML(id)}-error"${error ? '' : ' hidden'}>${escapeHTML(error)}</small></div>`;
}
export const badge = ({ label, tone = 'neutral' }) => `<span class="badge ui-badge ${({ positive: 'ok', warning: 'warn', negative: 'neg', info: 'info' })[tone] || ''}">${escapeHTML(label)}</span>`;
export const notice = ({ title = '', text = '', tone = 'info', action = '' }) => `<div class="ui-notice ui-notice-${escapeHTML(tone)}" role="${tone === 'negative' ? 'alert' : 'status'}"><div>${title ? `<strong>${escapeHTML(title)}</strong>` : ''}${text ? `<p>${escapeHTML(text)}</p>` : ''}</div>${action}</div>`;
export const pageHeader = ({ title, eyebrow = '', description = '', actions = '' }) => `<header class="head ui-page-header"><div>${eyebrow ? `<p class="ui-eyebrow">${escapeHTML(eyebrow)}</p>` : ''}<h1>${escapeHTML(title)}</h1>${description ? `<p class="ui-description">${escapeHTML(description)}</p>` : ''}</div>${actions ? `<div class="btns ui-header-actions">${actions}</div>` : ''}</header>`;
export const tabs = (items, { label = 'Sections', active = 0 } = {}) => `<div class="subtabs ui-tabs" role="tablist" aria-label="${escapeHTML(label)}">${items.map((item, index) => {
  const selected = typeof active === 'string' ? item.id === active : index === active;
  return `<button type="button" role="tab" data-i="${index}"${attributes({ id: item.id, 'data-tab': item.id ?? index, 'aria-selected': selected ? 'true' : 'false', tabindex: selected ? '0' : '-1' })}>${escapeHTML(item.label)}</button>`;
}).join('')}</div>`;
export const emptyState = ({ title, text = '', icon = '', action = '' }) => `<section class="empty ui-empty">${icon ? `<div class="ui-empty-icon" aria-hidden="true">${icon}</div>` : ''}<h2>${escapeHTML(title)}</h2>${text ? `<p>${escapeHTML(text)}</p>` : ''}${action ? `<div class="ui-empty-action">${action}</div>` : ''}</section>`;
export const skeletonRows = ({ rows = 5, columns = 4 } = {}) => `<div class="ui-skeleton" role="status" aria-label="Loading records"><span class="ui-sr-only">Loading records</span>${Array.from({ length: rows }, () => `<div class="ui-skeleton-row" style="--skeleton-cols:${columns}" aria-hidden="true">${'<span></span>'.repeat(columns)}</div>`).join('')}</div>`;
export const details=({label='More options',body='',open=false,attrs={}})=>`<details class="ui-disclosure"${attributes({open,...attrs})}><summary>${escapeHTML(label)}</summary><div class="ui-disclosure-body">${body}</div></details>`;
export function actionMenu({ id, label = 'More actions', text = '', items = [], content = '', className = '' }) {
  return `<details class="ui-menu ${text?'ui-menu-text ':''}${escapeHTML(className)}"${attributes({ id })}><summary aria-label="${escapeHTML(label)}" title="${escapeHTML(label)}">${text ? escapeHTML(text) : '<span aria-hidden="true">⋮</span>'}</summary><div class="ui-menu-panel">${content || items.map((item) => button({ ...item, variant: item.variant || 'ghost' })).join('')}</div></details>`;
}
export function dataTable({ columns, rows, caption = '', selectable = false, selected = new Set(), sort = {}, actions, rowKey = 'id', rowLabel = (row) => row.name || row.title || row.full_name || row[rowKey] || 'record' }) {
  return `<table class="resource-table ui-table">${caption ? `<caption class="ui-sr-only">${escapeHTML(caption)}</caption>` : ''}<thead><tr>${selectable ? '<th class="ui-select-cell"><input type="checkbox" data-select-page aria-label="Select this page"></th>' : ''}${columns.map((column) => `<th scope="col"${attributes({ class: column.numeric ? 'r' : null, 'aria-sort': sort.key === column.key ? sort.direction === 'desc' ? 'descending' : 'ascending' : column.sortable ? 'none' : null })}>${column.sortable ? `<button type="button" class="ui-sort" data-sort="${escapeHTML(column.key)}">${escapeHTML(column.label)}<span aria-hidden="true">${sort.key === column.key ? sort.direction === 'desc' ? '↓' : '↑' : '↕'}</span></button>` : escapeHTML(column.label)}</th>`).join('')}${actions ? '<th scope="col" class="ui-actions-heading"><span class="ui-sr-only">Actions</span></th>' : ''}</tr></thead><tbody>${rows.map((row) => `<tr${attributes({ 'data-row': row[rowKey], class: selected.has(row[rowKey]) ? 'ui-selected' : null })}>${selectable ? `<td class="ui-select-cell" data-label="Select"><input type="checkbox" data-select-row="${escapeHTML(row[rowKey])}" aria-label="Select ${escapeHTML(rowLabel(row))}"${selected.has(row[rowKey]) ? ' checked' : ''}></td>` : ''}${columns.map((column) => `<td data-label="${escapeHTML(column.label)}"${attributes({ class: column.numeric ? 'r' : null })}>${column.render ? column.render(row) : escapeHTML(row[column.key] ?? '—')}</td>`).join('')}${actions ? `<td class="acts" data-label="Actions">${actions(row)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
}
export const drawerContent = ({ title, description = '', body = '', actions = '' }) => `<section class="ui-drawer-shell"><header class="ui-drawer-head"><div><p class="ui-eyebrow">fieldnote.</p><h2 id="ui-drawer-title">${escapeHTML(title)}</h2>${description ? `<p>${escapeHTML(description)}</p>` : ''}</div>${button({ label: 'Close', variant: 'ghost', size: 'sm', attrs: { 'data-drawer-close': true, 'aria-label': 'Close drawer' } })}</header><div class="ui-drawer-body">${body}</div>${actions ? `<footer class="ui-drawer-actions">${actions}</footer>` : ''}</section>`;
export function openPanel(dialog, {presentation='drawer',...options}) {
  dialog.oncancel = null;
  for(const name of ['ui-drawer','ui-panel-modal','ui-panel-sheet'])dialog.classList.remove(name);
  dialog.classList.add('ui-panel');dialog.classList.add(presentation==='modal'?'ui-panel-modal':presentation==='sheet'?'ui-panel-sheet':'ui-drawer');
  dialog.setAttribute('aria-labelledby', 'ui-drawer-title'); dialog.innerHTML = drawerContent(options);
  const close = () => dialog.close(); dialog.querySelector('[data-drawer-close]')?.addEventListener('click', close);
  if (!dialog.open) dialog.showModal();
  return { close, el: dialog };
}
export function openDrawer(dialog,options){return openPanel(dialog,{...options,presentation:options.presentation || 'drawer'});}
export function confirmDialog({ title, text, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement, dialog = document.createElement('dialog'); let settled = false;
    dialog.className = 'ui-confirm-dialog'; dialog.setAttribute('aria-labelledby', 'ui-confirm-title');
    dialog.innerHTML = `<section><h2 id="ui-confirm-title">${escapeHTML(title)}</h2><p>${escapeHTML(text)}</p><div class="btns">${button({ label: 'Cancel', variant: 'ghost', attrs: { 'data-confirm-no': true } })}${button({ label: confirmLabel, variant: danger ? 'danger' : 'primary', attrs: { 'data-confirm-yes': true } })}</div></section>`;
    const finish = (result) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); previous?.focus(); resolve(result); };
    dialog.querySelector('[data-confirm-no]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-confirm-yes]').addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close',()=>finish(false));
    document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-confirm-no]').focus();
  });
}
export function toast(message, { tone = 'neutral', action = '', onAction, timeout = 5000 } = {}) {
  const host = document.querySelector('#toasts'); if (!host) return { dismiss() {} };
  const element = document.createElement('div'); element.className = `toast ui-toast ui-toast-${tone}`; element.setAttribute('role', tone === 'negative' ? 'alert' : 'status');
  element.innerHTML = `<span>${escapeHTML(message)}</span>${action ? button({ label: action, variant: 'ghost', size: 'sm', attrs: { 'data-toast-action': true } }) : ''}${button({ label: 'Dismiss', variant: 'ghost', size: 'sm', attrs: { 'data-toast-close': true, 'aria-label': 'Dismiss notification' } })}`;
  host.append(element); const dismiss = () => element.remove();
  element.querySelector('[data-toast-close]')?.addEventListener('click', dismiss);
  element.querySelector('[data-toast-action]')?.addEventListener('click', () => { onAction?.(); dismiss(); });
  if (timeout > 0) setTimeout(dismiss, timeout);
  return { dismiss, el: element };
}
