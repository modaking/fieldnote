// Team access uses checked database RPCs; roles and farm scope are enforced in SQL.
import * as C from './components.js';
import { ROLE_OPTIONS, canManageMembers, canManageMember } from './permissions.js';
import { buildInviteURL } from './invites.js';

const PAGE_SIZE = 15;
const date = (value) => value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const roleLabel = (role) => ROLE_OPTIONS.find((item) => item.value === role)?.label || role;

export function memberTab(options={},hash='') {
  if(['members','invites'].includes(options.tab))return options.tab;
  const query=new URLSearchParams(String(hash).split('?')[1]||'');
  return ['invites','invitations'].includes(query.get('tab'))||query.get('section')==='invitations'?'invites':'members';
}
export async function members(el, X, options = {}) {
  const { S, db } = X, ws = S.ws.id, esc = C.escapeHTML;
  const uid=X.uid?.()??S.userId,active = () => el.isConnected && (X.uid?.()??S.userId)===uid && S.ws?.id === ws && (!S.route || S.route === 'members');
  const initialTab=memberTab(options,typeof location==='undefined'?'':location.hash),pageTitle=options.hideTabs?(initialTab==='invites'?'Invitations':'Members'):'Members';
  if (!canManageMembers(S.role)) { el.innerHTML = C.notice({ title: 'Team access is restricted', text: 'Ask a workspace owner or administrator to manage members.', tone: 'warning' }); return; }
  if (!X.migrationReady) { el.innerHTML = C.pageHeader({ title: pageTitle, description: 'Invite teammates and choose their access.' }) + C.notice({ title: 'Access upgrade required', text: 'Ian needs to review and apply the supplied membership migration before invitations or role changes are enabled.', tone: 'warning' }); return; }

  let memberRows = [], inviteRows = [], selectedTab = initialTab, search = '', role = '', page = 1, sort = { key: 'full_name', direction: 'asc' };
  const farmNames = (ids) => (ids || []).map((id) => S.farms.find((farm) => farm.id === id)?.name || 'Assigned farm').join(', ');
  const scopeLabel = (row) => (row.farm_scope === 'all' || row.farm_ids == null) ? 'All farms' : farmNames(row.farm_ids) || 'No farms assigned';
  const message = (text, tone = 'neutral') => X.toast ? X.toast(text, { tone }) : C.toast(text, { tone });
  const load = async () => {
    if(!active())return;
    el.innerHTML = C.pageHeader({ title: pageTitle, description: 'Loading your team’s access…' }) + C.skeletonRows({ rows: 5, columns: 4 });
    try {
      [memberRows, inviteRows] = await Promise.all([
        db.rpc('fw_list_members', { p_workspace_id: ws }), db.rpc('fw_list_invites', { p_workspace_id: ws }),
      ]);
      memberRows ||= []; inviteRows ||= [];
      if (active()) paint();
    } catch (error) {
      if (!active()) return;
      el.innerHTML = C.pageHeader({ title: pageTitle }) + C.notice({ title: 'Couldn’t load team access', text: error.message, tone: 'negative', action: C.button({ label: 'Try again', attrs: { 'data-members-retry': true } }) });
      el.querySelector('[data-members-retry]').onclick = load;
    }
  };
  function paint() {
    if(!active())return;
    const invitations = selectedTab === 'invites';
    const source = invitations ? inviteRows : memberRows;
    const filtered = source.filter((row) => (!role || row.role === role) && [row.full_name, row.email, roleLabel(row.role), scopeLabel(row)].join(' ').toLowerCase().includes(search.toLowerCase()));
    filtered.sort((a, b) => String(a[sort.key] || a.email || '').localeCompare(String(b[sort.key] || b.email || ''), undefined, { sensitivity: 'base' }) * (sort.direction === 'desc' ? -1 : 1));
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); page = Math.min(page, pages);
    const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const columns = invitations ? [
      { key: 'email', label: 'Email', sortable: true },
      { key: 'role', label: 'Role', sortable: true, render: (row) => C.badge({ label: roleLabel(row.role) }) },
      { key: 'scope', label: 'Farm access', render: (row) => esc(scopeLabel(row)) },
      { key: 'status', label: 'Status', render: (row) => C.badge({ label: row.status === 'pending' && new Date(row.expires_at) < new Date() ? 'Expired' : row.status, tone: row.status === 'accepted' ? 'positive' : 'neutral' }) },
      { key: 'expires_at', label: 'Expires', sortable: true, render: (row) => esc(date(row.expires_at)) },
    ] : [
      { key: 'full_name', label: 'Member', sortable: true, render: (row) => `<strong>${esc(row.full_name || row.email)}</strong><span class="caption muted">${esc(row.email)}</span>` },
      { key: 'role', label: 'Role', sortable: true, render: (row) => C.badge({ label: roleLabel(row.role) }) },
      { key: 'scope', label: 'Farm access', render: (row) => esc(scopeLabel(row)) },
      { key: 'created_at', label: 'Joined', sortable: true, render: (row) => esc(date(row.created_at)) },
    ];
    const actions = (row) => {
      if (invitations && row.status !== 'pending') return '<span class="caption muted">—</span>';
      if (!canManageMember(S.role, row.role)) return '<span class="caption muted">Owner managed</span>';
      return C.actionMenu({ label: `Actions for ${row.full_name || row.email}`, items: invitations
        ? row.status === 'pending' ? [{ label: 'Revoke invitation', variant: 'danger', attrs: { 'data-revoke': row.id } }] : []
        : [{ label: 'Change access', attrs: { 'data-change': row.user_id } }, { label: 'Remove member', variant: 'danger', attrs: { 'data-remove': row.user_id } }] });
    };
    el.innerHTML = C.pageHeader({ title: pageTitle, description: 'Control who can access your workspace and each farm.',
      actions: (X.report ? C.button({ label: 'Report', variant: 'secondary', attrs: { 'data-member-report': true } }) : '') + C.button({ label: 'Invite member', attrs: { 'data-invite-member': true } }) })
      + (options.hideTabs?'':C.tabs([{ id: 'members', label: `Members (${memberRows.length})` }, { id: 'invites', label: `Invitations (${inviteRows.filter((row) => row.status === 'pending').length})` }], { active: selectedTab, label: 'Team access' }))
      + `<section class="card"><div class="resource-toolbar">${C.input({ name: 'member-search', id: 'member-search', type: 'search', value: search, attrs: { placeholder: 'Search names, email or farm…', 'aria-label': 'Search team access' } })}${C.select({ name: 'member-role', id: 'member-role', value: role, options: [{ value: '', label: 'All roles' }, ...ROLE_OPTIONS], attrs: { 'aria-label': 'Filter by role' } })}<span class="caption muted" aria-live="polite">${filtered.length} ${invitations ? 'invitations' : 'members'}</span></div>`
      + (rows.length ? `<div class="table-wrap">${C.dataTable({ columns, rows, caption: invitations ? 'Workspace invitations' : 'Workspace members', rowKey: invitations ? 'id' : 'user_id', sort, actions })}</div>`
        : C.emptyState({ title: search || role ? 'No matches' : invitations ? 'No invitations yet' : 'No members found', text: search || role ? 'Try another search or role filter.' : 'Invite someone to work with you.', action: C.button({ label: 'Invite member', variant: 'secondary', attrs: { 'data-invite-member': true } }) }))
      + `<footer class="resource-pagination"><span class="caption muted">Page ${page} of ${pages}</span>${C.button({ label: 'Previous', variant: 'ghost', size: 'sm', attrs: { 'data-member-page': page - 1, disabled: page === 1 } })}${C.button({ label: 'Next', variant: 'ghost', size: 'sm', attrs: { 'data-member-page': page + 1, disabled: page === pages } })}</footer></section>`
      + C.notice({ title: 'Roles are enforced by the database', text: 'Owners and administrators manage the team. Workers and viewers cannot access financial records or pay. Removing a member preserves farm records.' });
    el.querySelectorAll('[data-invite-member]').forEach((button) => { button.onclick = () => accessDrawer(); });
    el.querySelector('[data-member-report]')?.addEventListener('click', () => X.report('members'));
    el.querySelectorAll('[data-tab]').forEach((button) => {
      button.onclick = () => { selectedTab = button.dataset.tab; page = 1; paint(); };
      button.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const tabs = [...el.querySelectorAll('[data-tab]')], index = tabs.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        const id = tabs[next].dataset.tab; tabs[next].click(); el.querySelector(`[data-tab="${id}"]`)?.focus();
      };
    });
    el.querySelector('#member-search').oninput = (event) => {
      const position = event.target.selectionStart; search = event.target.value; page = 1; paint();
      const input = el.querySelector('#member-search'); input.focus(); input.setSelectionRange(position, position);
    };
    el.querySelector('#member-role').onchange = (event) => { role = event.target.value; page = 1; paint(); };
    el.querySelectorAll('[data-sort]').forEach((button) => { button.onclick = () => { sort = { key: button.dataset.sort, direction: sort.key === button.dataset.sort && sort.direction === 'asc' ? 'desc' : 'asc' }; paint(); }; });
    el.querySelectorAll('[data-member-page]').forEach((button) => { button.onclick = () => { page = Number(button.dataset.memberPage); paint(); }; });
    el.querySelectorAll('[data-change]').forEach((button) => { button.onclick = () => accessDrawer(memberRows.find((row) => row.user_id === button.dataset.change)); });
    el.querySelectorAll('[data-remove]').forEach((button) => { button.onclick = () => confirmAction('Remove member?', `Remove ${memberRows.find((row) => row.user_id === button.dataset.remove)?.email || 'this member'} from this workspace? Their access ends immediately; farm records remain.`, 'Remove member', 'fw_remove_member', { p_user_id: button.dataset.remove }, true); });
    el.querySelectorAll('[data-revoke]').forEach((button) => { button.onclick = () => confirmAction('Revoke invitation?', 'This invitation link will stop working. You can create another invitation later.', 'Revoke invitation', 'fw_revoke_invite', { p_invite_id: button.dataset.revoke }); });
  }

  function accessDrawer(row = null) {
    if(!active())return;
    const dialog = X.dlg(), editing = Boolean(row), allowedRoles = ROLE_OPTIONS.filter((option) => S.role === 'owner' || !['owner', 'admin'].includes(option.value));
    const chosenRole = row?.role || 'worker', chosenScope = row?.farm_scope === 'farms' ? 'selected' : 'all';
    const farms = S.farms.map((farm) => `<label class="check"><input type="checkbox" name="farm_ids" value="${esc(farm.id)}"${row?.farm_ids?.includes(farm.id) ? ' checked' : ''}>${esc(farm.name)}</label>`).join('');
    const drawer = C.openDrawer(dialog, { title: editing ? 'Change member access' : 'Invite a team member', description: editing ? row.email : 'Choose a role and the farms this person can access.',
      body: `<form id="member-access-form">${editing ? '' : C.field({ label: 'Email address', name: 'email', type: 'email', required: true, attrs: { autocomplete: 'email', maxlength: 320 } })}${C.field({ label: 'Role', name: 'role', type: 'select', value: chosenRole, required: true, options: allowedRoles })}<p class="ui-hint" id="member-role-hint"></p>${C.field({ label: 'Farm access', name: 'scope', type: 'select', value: chosenScope, options: [{ value: 'all', label: 'All farms' }, { value: 'selected', label: 'Selected farms' }] })}<fieldset id="member-farms"><legend>Allowed farms</legend>${farms || '<p class="muted">Add a farm before choosing farm-specific access.</p>'}</fieldset><div id="member-form-message" aria-live="polite"></div><div class="actions">${C.button({ label: 'Cancel', variant: 'ghost', attrs: { 'data-member-cancel': true } })}${C.button({ label: editing ? 'Save access' : 'Create invitation link', type: 'submit' })}</div></form>` });
    const form = dialog.querySelector('form'), roleInput = form.elements.role, scopeInput = form.elements.scope, farmSet = form.querySelector('#member-farms');
    const syncScope = () => {
      const privileged = ['owner', 'admin'].includes(roleInput.value);
      if (privileged) scopeInput.value = 'all';
      scopeInput.disabled = privileged;
      farmSet.hidden = scopeInput.value !== 'selected';
      form.querySelector('#member-role-hint').textContent = ROLE_OPTIONS.find((option) => option.value === roleInput.value)?.description || '';
    };
    roleInput.onchange = syncScope; scopeInput.onchange = syncScope; syncScope();
    form.querySelector('[data-member-cancel]').onclick = drawer.close;
    form.onsubmit = async (event) => {
      event.preventDefault(); const submit = form.querySelector('[type=submit]'); if (submit.disabled||!active()) return;
      const farmIds = scopeInput.value === 'selected' ? [...form.querySelectorAll('[name=farm_ids]:checked')].map((input) => input.value) : null;
      const status = form.querySelector('#member-form-message');
      if (farmIds && !farmIds.length) { status.innerHTML = C.notice({ text: 'Choose at least one farm, or choose All farms.', tone: 'negative' }); return; }
      submit.disabled = true; submit.textContent = 'Saving…'; status.innerHTML = '';
      try {
        const args = { p_workspace_id: ws, p_role: roleInput.value, p_farm_ids: farmIds };
        if (editing) {
          await db.rpc('fw_change_member', { ...args, p_user_id: row.user_id });
          if(!active())return;
          drawer.close(); message('Member access updated', 'positive');
          if (X.reloadWorkspace) await X.reloadWorkspace(); else await load();
        } else {
          const result = await db.rpc('fw_create_invite', { ...args, p_email: form.elements.email.value.trim() });
          if(!active())return;
          if (!result?.token) throw new Error('The invitation link was not returned. Refresh the invitations list before trying again.');
          const link = buildInviteURL(location, result.token);
          C.openDrawer(dialog, { title: 'Invitation ready', description: result.email,
            body: C.notice({ title: 'Send this link to your teammate', text: `Creating the link does not send an email. It is tied to ${result.email} and expires ${date(result.expires_at)}.` }) + C.field({ label: 'Invitation link', name: 'invitation_link', value: link, attrs: { readonly: true } }) + `<div class="actions">${C.button({ label: 'Copy link', attrs: { 'data-copy-invite': true } })}${C.button({ label: 'Done', variant: 'secondary', attrs: { 'data-invite-done': true } })}</div><p id="invite-copy-status" class="ui-hint" aria-live="polite"></p>` });
          dialog.querySelector('[data-copy-invite]').onclick = async () => {
            try { await navigator.clipboard.writeText(link); dialog.querySelector('#invite-copy-status').textContent = 'Link copied.'; }
            catch { const input = dialog.querySelector('[name=invitation_link]'); input.focus(); input.select(); dialog.querySelector('#invite-copy-status').textContent = 'Select and copy the link above.'; }
          };
          dialog.querySelector('[data-invite-done]').onclick = () => { if(!active())return;dialog.close();if(options.hideTabs)location.hash='/people?section=invitations';else{selectedTab = 'invites'; load();} };
          // Keep the list current even if the drawer is closed with its close button.
          load();
        }
      } catch (error) { if(!active())return;status.innerHTML = C.notice({ text: error.message, tone: 'negative' }); submit.disabled = false; submit.textContent = editing ? 'Save access' : 'Create invitation link'; }
    };
    form.querySelector('input,select')?.focus();
  }

  function confirmAction(title, text, label, rpc, args, reloadWorkspace = false) {
    if(!active())return;
    const dialog = X.dlg(), drawer = C.openDrawer(dialog, { title, body: C.notice({ text, tone: 'warning' }) + '<div id="member-action-message"></div>',
      actions: C.button({ label: 'Cancel', variant: 'ghost', attrs: { 'data-confirm-cancel': true } }) + C.button({ label, variant: 'danger', attrs: { 'data-confirm-access': true } }) });
    dialog.querySelector('[data-confirm-cancel]').onclick = drawer.close;
    dialog.querySelector('[data-confirm-access]').onclick = async (event) => {
      const button = event.currentTarget; if (button.disabled||!active()) return; button.disabled = true;
      try {
        await db.rpc(rpc, { p_workspace_id: ws, ...args }); if(!active())return;drawer.close(); message(label === 'Remove member' ? 'Member removed' : 'Invitation revoked', 'positive');
        if (reloadWorkspace && X.reloadWorkspace) await X.reloadWorkspace(); else await load();
      } catch (error) { if(!active())return;dialog.querySelector('#member-action-message').innerHTML = C.notice({ text: error.message, tone: 'negative' }); button.disabled = false; }
    };
  }
  await load();
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (active() && query.get('invite') === '1') { query.delete('invite'); history.replaceState(null, '', `${location.pathname}${location.search}${location.hash.split('?')[0]}${query.size ? '?' + query : ''}`); accessDrawer(); }
}
