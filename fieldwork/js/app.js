import { init, session, auth, db, subscribeNetwork, subscribeSession, networkState } from './supabase.js';
import { getPref, setPref } from './theme.js';
import * as M from './modules.js';
import * as C from './components.js';
import * as P from './permissions.js';
import { resource } from './crud.js';
import { loadDemo } from './seed.js';
import { renderReports } from './reports.js';
import { members } from './members.js';
import { readInviteURL } from './invites.js';
import { renderAuth as authView, renderReset, formErrors, busy } from './auth-ui.js';
import { account, requireMfa } from './account.js';
import { registerUnsaved,hasUnsavedChanges,confirmLeave,clearUnsavedChanges } from './feedback.js';
import { PAGES,SECTIONS,resolveNavigation,sectionURL,navigationItems,availableSections,rememberRecent } from './navigation.js';
import { renderSectionPage,openCommandPalette,openMoreNavigation } from './navigation-ui.js';
import { readAll } from './read-all.js';

const $ = (s, el = document) => el.querySelector(s), esc = C.escapeHTML, toast = C.toast;
const paths = {
  overview: 'M3 11l9-8 9 8M5 10v10h14V10', daily: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  finances: 'M3 17l6-6 4 4 8-8M15 7h6v6', vendors: 'M4 9h16l-1-5H5zM5 9v11h14V9M10 20v-6h4v6',
  infrastructure: 'M3 21h18M5 21V9l7-5 7 5v12M10 21v-6h4v6', livestock: 'M12 21v-9M12 12c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z',
  workers: 'M16 20v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M10 10a3 3 0 100-6 3 3 0 000 6M20 20v-2a3 3 0 00-2-3M16 4a3 3 0 010 6',
  funding: 'M12 3v18M17 7H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H7', plus: 'M12 5v14M5 12h14', menu: 'M4 6h16M4 12h16M4 18h16', search:'M21 21l-5-5M10 17a7 7 0 100-14 7 7 0 000 14',
  light: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8',
  dark: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z', system: 'M3 5h18v11H3zM8 20h8M12 16v4',
  members: 'M4 20v-2a5 5 0 0110 0v2M9 11a4 4 0 100-8 4 4 0 000 8M16 9h6M19 6v6',
  reports: 'M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 18h4', settings: 'M12 8a4 4 0 100 8 4 4 0 000-8M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4',
};
const I = (name) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.reports}"/></svg>`;
const MODULES = [
  ['overview', 'Overview', 'The essentials across your farms.'], ['daily', 'Daily operations', 'Tasks, routines and reusable checklists.'],
  ['finances', 'Monthly finances', 'Income, expenses, budgets and cash movement.'], ['vendors', 'Vendors', 'Suppliers, bills and outstanding balances.'],
  ['infrastructure', 'Infrastructure', 'Project progress, budgets and timelines.'], ['livestock', 'Livestock & crops', 'Enterprises, activity and field records.'],
  ['workers', 'Workers', 'Your team and recorded pay.'], ['funding', 'Funding', 'Opportunities, deadlines and applications.'],
  ['members', 'Members', 'Invite your team and manage their access.'], ['reports', 'Reports', 'Preview and download statements for every module.'],
  ['settings', 'Settings', 'Workspace and farms.'], ['account','Account','Your profile, security and personal preferences.'],
];
const readSetting = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeSetting = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const today = () => {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (key) => parts.find((p) => p.type === key).value; return `${part('year')}-${part('month')}-${part('day')}`;
};
const savedMonth = readSetting('fw-month');
const S = { userId: null, profile: null, ws: null, role: null, memberships: [], farms: [], farmId: 'all', farmIds: null, accessReady: false,
  month: /^\d{4}-(0[1-9]|1[0-2])$/.test(savedMonth || '') ? savedMonth : today().slice(0,7), route: 'overview',page:'overview',section:null };
const canWrite = () => ['owner','admin','manager','accountant'].includes(S.role);
const brand = () => `<span class="brand">${I('livestock')}fieldnote.</span>`;
const app = $('#app'); let loadSequence = 0, navigationSequence=0, acceptedHash=location.hash, pendingInvite = '', signingOut=false;
const invitationURL = readInviteURL(location);
// Capture/scrub independently of device storage: blocked storage must not leave
// a secret in the URL or discard the in-memory invitation during current auth.
if (invitationURL.cleanURL !== null) { try { history.replaceState(null, '', invitationURL.cleanURL); } catch {} }
if (invitationURL.found) {
  pendingInvite = invitationURL.token || '';
  try { if (pendingInvite) sessionStorage.setItem('fw-invite', pendingInvite); else sessionStorage.removeItem('fw-invite'); } catch {}
} else {
  try { const stored = sessionStorage.getItem('fw-invite'); pendingInvite = /^[0-9a-f]{64}$/i.test(stored || '') ? stored : ''; } catch {}
}
const money = (minor, currency = S.ws.currency) => {
  const f = new Intl.NumberFormat(S.profile?.language==='sw'?'sw-KE':'en-KE', { style: 'currency', currency }); return f.format(minor / 10 ** f.resolvedOptions().maximumFractionDigits);
};
const monthRange = () => { const [y,m] = S.month.split('-').map(Number), n = new Date(y,m,1); return [`${S.month}-01`,`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`]; };
const monthLabel = () => new Date(`${S.month}-01T00:00`).toLocaleDateString(S.profile?.language==='sw'?'sw-KE':'en-KE',{month:'long',year:'numeric'});
function clearWorkspace() {
  loadSequence++;navigationSequence++;clearUnsavedChanges();$('#dlg')?.close();document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  Object.assign(S,{userId:null,profile:null,ws:null,role:null,memberships:[],farms:[],farmIds:null,farmId:'all',accessReady:false});
  app.innerHTML=C.skeletonRows({rows:4,columns:3});
}
const renderAuth = (mode = 'in') => { clearWorkspace(); authView(app, { auth, onSignedIn: load, brand, invitePending: Boolean(pendingInvite) }, mode); };
const permissionContext = () => ({
  canReadModule: (key) => P.canReadModule(S.role,key), canWriteModule: (key) => P.canWriteModule(S.role,key)&&!(S.role==='worker'&&key==='livestock'&&!S.accessReady),
  canDeleteModule: (key) => canWrite() && P.canWriteModule(S.role,key), has: (cap) => P.has(S.role,cap), farmIds: S.farmIds,
});
function context() {
  const contextUid=session()?.user.id,contextWorkspace=S.ws?.id||null;
  const guardedDb=Object.fromEntries(Object.entries(db).map(([name,fn])=>[name,(...args)=>{if(session()?.user.id!==contextUid||(S.ws?.id||null)!==contextWorkspace)throw Object.assign(new Error('Your account or workspace changed. Reopen this section and try again.'),{status:401});return fn(...args);} ]));
  const filters=Object.fromEntries(new URLSearchParams(location.hash.split('?')[1]||''));
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateRange=validDate(filters.from)&&validDate(filters.to)&&filters.to>filters.from?[filters.from,filters.to]:null;
  return { S, db:guardedDb, esc, I, toast, money, monthRange:()=>dateRange||monthRange(), monthLabel:()=>dateRange?`${dateRange[0]} to ${dateRange[1]} (end exclusive)`:monthLabel(), canWrite, today, permissions: permissionContext(),filters,session,
    setViewURL:patch=>{const params=new URLSearchParams(location.hash.split('?')[1]||'');for(const[key,value]of Object.entries(patch)){if(value==null)params.delete(key);else params.set(key,String(value));}acceptedHash=`#/${S.page||S.route}${params.size?'?'+params:''}`;history.pushState(null,'',location.pathname+location.search+acceptedHash);},
    openAddRecord:()=>S.farms.length?openAddRecord():openFarm(),switchWorkspace,createWorkspace:async()=>{if(await confirmLeave()){clearUnsavedChanges();renderCreateWs();}},
    onViewed:({row})=>{if(S.section&&S.ws)rememberRecent(session()?.user.id,S.ws.id,{section:S.section,id:row.id,farm:row.farm_id||S.farmId,label:row.title||row.name||row.full_name||row.description||'Record'});},
    canReport: (key) => P.canReport(S.role,key), report: (key) => { location.hash = `/reports?module=${encodeURIComponent(key)}`; },
    uid: () => session()?.user.id, dlg: () => $('#dlg'), reloadWorkspace: load, reload: load, migrationReady: S.accessReady,
    addRequested: new URLSearchParams(location.hash.split('?')[1] || '').get('add') === '1',
    consumeAdd: () => history.replaceState(null,'',location.pathname + location.search + `#/${S.route}`) };
}

async function boot() {
  try { const redirect = await init(); if (redirect?.type === 'recovery') return renderReset(app,{auth,onSignedIn:load,brand}); }
  catch (error) { return renderLoadError('Couldn’t start fieldnote.',error); }
  if (!session()) return renderAuth();
  try { await load(); } catch (error) { if (!session()) return renderAuth(); renderLoadError('Couldn’t load your workspace',error); }
}
function renderLoadError(title,error) {
  app.innerHTML = `<div class="center"><main class="panel" id="view" tabindex="-1">${brand()}<h1>${esc(title)}</h1>${C.notice({text:error.message,tone:'negative'})}<div class="actions">${C.button({label:'Sign out',variant:'ghost',attrs:{id:'retry-out'}})}${C.button({label:'Try again',attrs:{id:'retry'}})}</div></main></div>`;
  $('#retry').onclick = boot; $('#retry-out').onclick = signOut;
}
async function signOut() { if(!await confirmLeave())return;clearUnsavedChanges();signingOut=true;loadSequence++;const result=await auth.signOut();renderAuth();signingOut=false;toast(result?.remoteRevoked===false?'Signed out on this device. Other sessions could not be revoked; reconnect and try again.':'Signed out.',{tone:result?.remoteRevoked===false?'warning':'positive'}); }
function renderConnection(state){const host=$('#connection-state');if(!host)return;host.innerHTML=C.badge({label:!state.online?'Offline':state.pending?'Updating…':state.error?'Connection error':'Online',tone:!state.online||state.error?'warning':'neutral'});host.title=!state.online?'Reconnect to save changes. There is no offline write queue.':state.pending?`${state.pending} request(s) in progress`:state.error||'Connected. Changes are saved to the server.';}
subscribeNetwork(renderConnection);
subscribeSession(next=>{if(!next&&S.userId){renderAuth();if(!signingOut)toast('Your session ended. Sign in again to continue.',{tone:'warning'});}});
async function switchWorkspace(id){if(!S.memberships.some(m=>m.workspaces.id===id))throw new Error('This workspace is no longer available. Refresh your account.');if(!await confirmLeave())return false;const uid=session()?.user.id;await db.update('profiles',uid,{active_workspace:id});if(session()?.user.id!==uid)return false;clearWorkspace();await load();toast('Workspace switched.');return true;}
async function renderPersonalAccount(){
  app.innerHTML=`<div class="personal-shell"><header class="top">${brand()}<span class="grow"></span>${C.button({label:'Create workspace',variant:'secondary',attrs:{id:'personal-create'}})}${C.button({label:'Sign out',variant:'ghost',attrs:{id:'personal-out'}})}</header><main id="view" tabindex="-1"></main><dialog id="dlg"></dialog></div>`;
  $('#personal-create').onclick=async()=>{if(await confirmLeave()){clearUnsavedChanges();renderCreateWs();}};$('#personal-out').onclick=signOut;
  acceptedHash=location.hash;window.onhashchange=async()=>{if(hasUnsavedChanges()&&!await confirmLeave()){history.replaceState(null,'',location.pathname+location.search+acceptedHash);return;}clearUnsavedChanges();acceptedHash=location.hash;load().catch(error=>renderLoadError('Couldn’t load your account',error));};
  try{await account($('#view'),context());}catch(error){renderLoadError('Couldn’t load your account',error);}
}
async function load() {
  if(S.userId && S.userId!==session()?.user.id) clearWorkspace();
  const sequence = ++loadSequence, uid = session()?.user.id; if (!uid) return renderAuth();
  if(await requireMfa(app,{brand,auth,session},load))return;
  if(sequence!==loadSequence||session()?.user.id!==uid)return;
  if (pendingInvite) return renderInvite();
  const profile = (await db.select('profiles',`id=eq.${uid}`))[0] || {id:uid};
  const mem = await db.select('workspace_members',`user_id=eq.${uid}&select=role,workspaces(id,name,currency)`), memberships = mem.filter((m)=>m.workspaces);
  if (sequence !== loadSequence || session()?.user.id !== uid) return;
  if (!memberships.length) { const removed=Boolean(S.ws);clearWorkspace();Object.assign(S,{userId:uid,profile,memberships:[]});if(location.hash.startsWith('#/account'))return renderPersonalAccount();if(removed)toast('Your previous workspace is no longer available. Join another workspace or create one.',{tone:'warning'});return renderCreateWs(); }
  const pick = memberships.find((m)=>m.workspaces.id===profile.active_workspace)||memberships[0];
  let access = null;
  try { access = await db.rpc('fw_access_context',{p_workspace_id:pick.workspaces.id}); if (Array.isArray(access)) access=access[0]; }
  catch (error) { if (![400,404].includes(error.status) && !/function|schema cache/i.test(error.message)) throw error; }
  let farms;
  const active=()=>sequence===loadSequence&&session()?.user.id===uid;
  try{farms=await readAll(db,'farms',`workspace_id=eq.${pick.workspaces.id}&order=created_at.asc,id.asc`,{active});}
  catch(error){if(!active())return;throw error;}
  if (sequence !== loadSequence || session()?.user.id !== uid) return;
  Object.assign(S,{userId:uid,profile,memberships,ws:pick.workspaces,role:access?.role||pick.role,farms,accessReady:access?.schema_version==='20261118',farmIds:access?.farm_scope==='farms'?(access.farm_ids||[]):null});
  const savedFarm = readSetting(`fw-farm:${uid}:${S.ws.id}`)||profile.default_farm_id; S.farmId=farms.some((f)=>f.id===savedFarm)?savedFarm:'all';S.dashboardPeriod=profile.default_period||'month';
  if(profile.theme_pref && profile.theme_pref!==getPref()) setPref(profile.theme_pref);
  renderShell();
  if (readSetting(`fw-onboarding:${uid}:${S.ws.id}`)==='farm' && P.canWriteModule(S.role,'farms')) showOnboardingFarm();
}
function renderInvite() {
  app.innerHTML = `<div class="center"><main class="panel">${brand()}<h1>Join your team</h1><p class="muted">Accept the workspace invitation sent to ${esc(session().user.email)}. Your access is set by the invitation.</p><div id="invite-message"></div><div class="actions">${C.button({label:'Use another account',variant:'ghost',attrs:{id:'invite-out'}})}${C.button({label:'Accept invitation',attrs:{id:'accept-invite'}})}</div>${C.button({label:'Continue without joining',variant:'ghost',attrs:{id:'skip-invite'}})}</main></div>`;
  $('#invite-out').onclick=signOut;
  $('#skip-invite').onclick=()=>{pendingInvite='';try{sessionStorage.removeItem('fw-invite');}catch{} load();};
  $('#accept-invite').onclick=async(event)=>{const btn=event.currentTarget;busy(btn,true);try{const id=await db.rpc('fw_accept_invite',{p_token:pendingInvite});pendingInvite='';try{sessionStorage.removeItem('fw-invite');}catch{} if(id)await db.update('profiles',session().user.id,{active_workspace:id});toast('Invitation accepted');await load();}catch(error){$('#invite-message').innerHTML=C.notice({text:error.message,tone:'negative'});busy(btn,false);}};
}
async function renderCreateWs() {
  window.onhashchange=null; const uid=session().user.id,draftId=crypto.randomUUID();let created=null,uncertain=false,currencies=[{code:'KES',name:'Kenyan shilling'}];
  try{currencies=await db.select('currencies','order=code');}catch{}
  if(session()?.user.id!==uid)return;
  app.innerHTML=`<div class="center"><main class="panel">${brand()}<p class="ui-eyebrow">Step 1 of 3</p><h1>Name your workspace</h1><p class="muted">Keep all your farms together and choose a reporting currency.</p><form id="ws" novalidate>${C.field({label:'Workspace name',name:'name',required:true,attrs:{placeholder:'e.g. Enkishon Farms',maxlength:120}})}${C.field({label:'Base currency',name:'currency',type:'select',value:'KES',options:currencies.map(c=>({value:c.code,label:`${c.code} · ${c.name}`})),hint:'The base currency cannot change after transactions are recorded.'})}<div id="ws-message"></div><div class="actions">${C.button({label:'Sign out',variant:'ghost',attrs:{id:'out'}})}${C.button({label:'Create workspace',type:'submit'})}</div></form></main></div>`;
  $('#out').onclick=signOut;
  $('#ws').onsubmit=async(event)=>{event.preventDefault();const form=event.target,btn=form.querySelector('[type=submit]'),values=Object.fromEntries(new FormData(form));if(btn.disabled||!formErrors(form,{name:values.name.trim()?'':'Enter a workspace name.'}))return;busy(btn,true);
    try{if(!created&&uncertain)created=(await db.select('workspaces',`id=eq.${draftId}&created_by=eq.${uid}`))[0];if(!created){try{created=await db.insert('workspaces',{id:draftId,name:values.name.trim(),currency:values.currency,created_by:uid});}catch(error){if(error.status===0)uncertain=true;throw error;}}
      await db.update('profiles',uid,{active_workspace:created.id});writeSetting(`fw-onboarding:${uid}:${created.id}`,'farm');await load();
    }catch(error){$('#ws-message').innerHTML=C.notice({text:error.message,tone:'negative'});}finally{busy(btn,false);}};
}
function showOnboardingFarm(){
  openFarm(null,async()=>{writeSetting(`fw-onboarding:${session().user.id}:${S.ws.id}`,'team');showOnboardingTeam();},true);
}
function showOnboardingTeam(){
  const dlg=$('#dlg');C.openDrawer(dlg,{title:'Invite your team',description:'Step 3 of 3 · You can add people whenever you are ready.',body:C.notice({title:'Your workspace is ready',text:S.accessReady?'Invite teammates and choose what each person can see and change.':'Team invitations will be available after the workspace access upgrade is installed.'}),actions:C.button({label:'Finish setup',attrs:{id:'finish-setup'}})+(S.accessReady?C.button({label:'Open members',variant:'secondary',attrs:{id:'setup-members'}}):'')});
  const done=()=>{writeSetting(`fw-onboarding:${session().user.id}:${S.ws.id}`,'done');dlg.close();};$('#finish-setup').onclick=done;$('#setup-members')?.addEventListener('click',()=>{done();location.hash='/members?invite=1';});
}

function renderShell(){
  const pref=getPref(),initial=(S.profile?.full_name||session().user.email||'?')[0].toUpperCase(),pages=navigationItems(key=>P.canReadModule(S.role,key),S.accessReady),mobile=pages.filter(page=>page.id!=='reports');
  const link=page=>`<a href="#/${page.id}" data-id="${page.id}" aria-label="${page.label}" title="${page.label}">${I(page.icon)}<span>${page.label}</span></a>`;
  app.innerHTML=`<div class="shell ${readSetting('fw-sidebar')==='collapsed'?'sidebar-collapsed':''}"><aside class="side" id="side" aria-label="Farm navigation"><div class="side-head">${brand()}${C.button({label:'×',variant:'ghost',attrs:{id:'close-menu',class:'side-close','aria-label':'Close menu'}})}</div>
    <div class="workspace-switcher">${C.field({label:'Workspace',name:'workspace',id:'workspace-switch',type:'select',value:S.ws.id,options:S.memberships.map(m=>({value:m.workspaces.id,label:m.workspaces.name}))})}${C.badge({label:S.role})}</div>
    <div class="workspace-menu">${C.actionMenu({label:'Workspace menu',text:'Workspace',items:[{label:'Workspace settings',attrs:{'data-workspace-settings':true}},{label:'My workspaces',attrs:{'data-my-workspaces':true}}]})}</div><nav class="nav" aria-label="Modules">${pages.map(link).join('')}</nav><p class="side-caption caption muted">${esc(S.ws.currency)} reporting currency</p>${C.button({icon:I('menu'),variant:'ghost',attrs:{id:'collapse-sidebar','aria-label':'Collapse or expand sidebar'}})}</aside><div class="scrim" id="scrim"></div>
    <div class="main-column"><header class="top">${C.button({icon:I('menu'),variant:'ghost',attrs:{id:'menu',class:'icon-btn menu-btn','aria-label':'Open menu','aria-controls':'side','aria-expanded':'false'}})}<nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav><span class="grow"></span><span id="connection-state" class="connection-state" role="status" aria-live="polite"></span>${C.button({label:'Search',icon:I('search'),variant:'ghost',attrs:{id:'global-search',class:'global-search','aria-label':'Search navigation (Control or Command K)'}})}${C.button({label:'Add',icon:I('plus'),variant:'secondary',attrs:{id:'global-add',class:'global-quick-add','aria-label':'Quick add a record'}})}${C.button({icon:I(pref),variant:'ghost',attrs:{id:'theme',class:'icon-btn','aria-label':`Theme: ${pref}. Click to change`}})}${C.button({label:initial,variant:'ghost',attrs:{id:'avatar',class:'avatar','aria-label':'Account menu','aria-expanded':'false'}})}</header><div id="pop"></div><div class="bar" id="bar"></div><main id="view" tabindex="-1"></main></div></div><nav class="mobile-navigation" style="grid-template-columns:repeat(${mobile.length+1},minmax(0,1fr))" aria-label="Main navigation">${mobile.map(link).join('')}${C.button({label:'More',icon:I('menu'),variant:'ghost',attrs:{id:'mobile-more'}})}</nav><dialog id="dlg"></dialog>`;
  $('#menu').onclick=()=>toggleSide(true);$('#scrim').onclick=()=>toggleSide(false);$('#close-menu').onclick=()=>toggleSide(false);
  $('#collapse-sidebar').onclick=()=>{const shell=document.querySelector('.shell'),collapsed=shell.classList.toggle('sidebar-collapsed');writeSetting('fw-sidebar',collapsed?'collapsed':'expanded');};
  $('#global-search').onclick=()=>openCommandPalette(context());$('#mobile-more').onclick=()=>openMoreNavigation(context());
  $('#global-add').hidden=!['daily','finances','workers','livestock'].some(key=>permissionContext().canWriteModule(key));$('#global-add').onclick=()=>openAddRecord();
  document.querySelector('[data-workspace-settings]').onclick=()=>{location.hash='/settings';};document.querySelector('[data-my-workspaces]').onclick=()=>{location.hash='/account?section=workspaces';};
  $('#workspace-switch').onchange=async(event)=>{const select=event.target,id=select.value;if(select.disabled)return;busy(select,true);try{if(!await switchWorkspace(id)){select.value=S.ws.id;busy(select,false);}}catch(error){select.value=S.ws?.id||'';busy(select,false);toast(error.message,{tone:'negative'});}};
  $('#theme').onclick=()=>{const next={light:'dark',dark:'system',system:'light'}[getPref()],uid=session()?.user.id;setPref(next,p=>db.update('profiles',uid,{theme_pref:p}).catch(error=>{if(session()?.user.id===uid)toast(`Theme changed on this device. Your profile preference couldn’t save: ${error.message}`,{tone:'warning'});}));$('#theme').innerHTML=I(next);$('#theme').setAttribute('aria-label',`Theme: ${next}. Click to change`);toast(`Theme: ${next}`);};
  $('#avatar').onclick=()=>{const pop=$('#pop'),opened=!pop.innerHTML;$('#avatar').setAttribute('aria-expanded',String(opened));pop.innerHTML=opened?`<div class="pop" role="region" aria-label="Your account"><strong>${esc(S.profile?.full_name||'Your account')}</strong><span class="muted">${esc(session().user.email)}</span>${C.badge({label:S.role})}${C.button({label:'My account',variant:'ghost',attrs:{id:'my-account'}})}${C.button({label:'Sign out',variant:'ghost',attrs:{id:'signout'}})}</div>`:'';$('#signout')?.addEventListener('click',signOut);$('#my-account')?.addEventListener('click',()=>{pop.replaceChildren();location.hash='/account';});};
  renderConnection(networkState());window.onhashchange=route;route();
}
const narrow=matchMedia('(max-width: 900px)');
const toggleSide=(open)=>{const side=$('#side');if(!side)return;side.classList.toggle('open',open);side.inert=narrow.matches&&!open;$('#scrim').classList.toggle('open',open);$('#menu').setAttribute('aria-expanded',String(open));if(open)$('#close-menu').focus();};
narrow.addEventListener('change',()=>toggleSide(false));
document.addEventListener('keydown',(event)=>{
  if((event.ctrlKey||event.metaKey)&&String(event.key).toLowerCase()==='k'&&!event.altKey&&session()&&S.ws){event.preventDefault();openCommandPalette(context());return;}
  if(event.key==='Escape'){if($('#side')?.classList.contains('open')){toggleSide(false);$('#menu').focus();}$('#pop')?.replaceChildren();document.querySelectorAll('details.ui-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});}
  const tab=event.target?.closest?.('[role=tab]');if(!event.defaultPrevented&&tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){const items=[...tab.parentElement.querySelectorAll('[role=tab]')],i=items.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;event.preventDefault();items[next].focus();items[next].click();}
  if(event.key==='Tab'&&narrow.matches&&$('#side')?.classList.contains('open')){const items=[...$('#side').querySelectorAll('a,button,select')].filter(el=>!el.disabled),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
document.querySelector('.skip-link')?.addEventListener('click',(event)=>{const main=$('#view')||document.querySelector('#app form');if(main){event.preventDefault();main.tabIndex=-1;main.focus();}});
window.addEventListener('storage',(event)=>{
  if(event.key!=='fw-session')return;const uid=session()?.user.id;
  if(uid&&uid===S.userId)return;
  clearWorkspace();
  if(!uid)renderAuth();else load().catch(error=>{if(session()?.user.id===uid)renderLoadError('Couldn’t reload your account',error);});
});
window.addEventListener('beforeunload',event=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}});
async function route(){
  if(!session())return renderAuth();if(!S.ws)return;const ticket=++navigationSequence,uid=session().user.id,ws=S.ws.id,requested=location.hash;
  if(hasUnsavedChanges()&&!await confirmLeave()){if(ticket===navigationSequence)history.replaceState(null,'',location.pathname+location.search+acceptedHash);return;}
  if(ticket!==navigationSequence||session()?.user.id!==uid||S.ws?.id!==ws)return;clearUnsavedChanges();
  const nav=resolveNavigation(requested),params=nav.params;
  if(['operations','finances','people'].includes(requested.replace(/^#\//,'').split('?')[0])&&!params.has('section')&&!params.has('tab')){const first=availableSections(nav.page,key=>P.canReadModule(S.role,key),S.accessReady)[0];if(first){nav.section=first.id;nav.module=first.module;}}
  Object.assign(S,{route:nav.module,page:nav.page,section:nav.section});
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month')||'')){S.month=params.get('month');params.delete('from');params.delete('to');}
  if(nav.section==='budgets'&&/^\d{4}-\d{2}-\d{2}$/.test(params.get('to')||'')){const last=new Date(params.get('to')+'T12:00:00Z');if(!Number.isNaN(last.getTime())){last.setUTCDate(last.getUTCDate()-1);S.month=last.toISOString().slice(0,7);}params.delete('from');params.delete('to');}
  if(params.has('farm')){const farm=params.get('farm');if(farm==='all'||S.farms.some(item=>item.id===farm))S.farmId=farm;else toast('That farm is unavailable in this workspace.',{tone:'warning'});}
  if(nav.section){params.delete('tab');params.set('section',nav.section);acceptedHash=`#/${nav.page}?${params}`;history.replaceState(null,'',location.pathname+location.search+acceptedHash);}else acceptedHash=requested;
  $('#dlg')?.close();if($('#dlg')){$('#dlg').onclick=null;$('#dlg').oncancel=null;}
  document.title=`${SECTIONS.find(item=>item.id===S.section)?.label||MODULES.find(m=>m[0]===S.route)?.[1]||'Overview'} · fieldnote.`;toggleSide(false);renderBar();renderView();
}
function renderBar(){
  const page=PAGES.find(item=>item.id===S.page),section=SECTIONS.find(item=>item.id===S.section);$('#crumbs').innerHTML=section?`<span>${esc(page.label)}</span><span>/</span><b>${esc(section.label)}</b>`:`<b>${esc(MODULES.find(m=>m[0]===S.route)?.[1]||'Overview')}</b>`;
  $('#crumbs').hidden=!section;
  document.querySelectorAll('.nav a,.mobile-navigation a').forEach(a=>a.dataset.id===S.page?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  const options=[{value:'all',label:'All accessible farms'},...S.farms.map(f=>({value:f.id,label:f.name}))];
  const controls=(suffix='')=>C.field({label:'Farm',name:'farm',id:'farm-selector'+suffix,type:'select',value:S.farmId,options})+C.field({label:'Period',name:'month',id:'month'+suffix,type:'month',value:S.month,attrs:{'aria-label':`Month: ${monthLabel()}`}});
  $('#bar').innerHTML=`<div class="bar-desktop">${controls()}</div><div class="bar-mobile"><span class="muted">${esc(S.farms.find(f=>f.id===S.farmId)?.name||'All accessible farms')} · ${esc(monthLabel())}</span>${C.button({label:'Filters',variant:'ghost',attrs:{id:'top-filters'}})}</div>`;$('#bar').hidden=S.route==='account';
  const apply=async(farm,month)=>{if(!options.some(item=>item.value===farm)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!await confirmLeave())return false;clearUnsavedChanges();S.farmId=farm;S.month=month;writeSetting(`fw-farm:${session().user.id}:${S.ws.id}`,farm);writeSetting('fw-month',month);const params=new URLSearchParams(location.hash.split('?')[1]||'');if(params.has('farm'))params.set('farm',farm);params.delete('from');params.delete('to');acceptedHash=`#/${S.page||S.route}${params.size?'?'+params:''}`;history.replaceState(null,'',location.pathname+location.search+acceptedHash);renderBar();renderView();return true;};
  $('#farm-selector').onchange=async event=>{if(!await apply(event.target.value,S.month))event.target.value=S.farmId;};$('#month').onchange=async event=>{if(!await apply(S.farmId,event.target.value))event.target.value=S.month;};
  $('#top-filters').onclick=async()=>{const dlg=$('#dlg');if(dlg.open&&dlg.querySelector('form')&&!await confirmLeave())return;dlg.close();const panel=(C.openPanel||C.openDrawer)(dlg,{presentation:'sheet',title:'Farm and period',body:`<form id="top-filter-form">${controls('-sheet')}</form>`,actions:C.button({label:'Apply filters',type:'submit',attrs:{form:'top-filter-form'}})});$('#top-filter-form',dlg).onsubmit=async event=>{event.preventDefault();const form=event.target,values=new FormData(form);panel.close();await apply(values.get('farm'),values.get('month'));};};
}
async function renderView(){
  if(!session())return renderAuth();const view=document.createElement('main');view.id='view';view.tabIndex=-1;$('#view').replaceWith(view);view.focus({preventScroll:true});
  if(!P.canReadModule(S.role,S.route)){view.innerHTML=C.emptyState({title:'This section is unavailable for your role',text:'Ask the workspace owner if you need access.'});return;}
  if(!S.accessReady&&['worker','viewer'].includes(S.role)&&['workers','infrastructure'].includes(S.route)){view.innerHTML=C.pageHeader({title:MODULES.find(mod=>mod[0]===S.route)[1],description:'Operational details are protected by your workspace access rules.'})+upgradeNotice();return;}
  const X=context();view.innerHTML=C.skeletonRows({rows:5,columns:4});
  try{
    if(S.section)await renderSectionPage(view,X,{page:S.page,section:S.section},M.moduleViews||{},members);
    else if(M[S.route])await M[S.route](view,X);
    else if(S.route==='reports'){const mod=new URLSearchParams(location.hash.split('?')[1]||'').get('module')||'overview';await renderReports(view,X,{module:mod});}
    else if(S.route==='members'){if(!S.accessReady){view.innerHTML=C.pageHeader({title:'Members',description:'Invite people and manage their workspace access.'})+upgradeNotice();}else await members(view,X);}
    else if(S.route==='settings')await renderSettings(view,X);
    else if(S.route==='account')await account(view,X);
    else {const {dashboard}=await import('./dashboard.js');if(view.isConnected)await dashboard(view,X);}
    if(view.isConnected&&S.route!=='overview'&&X.filters.from&&X.filters.to){const header=view.querySelector('.ui-page-header');header?.insertAdjacentHTML('afterend',C.notice({title:'Dashboard selection',text:`${X.filters.from} through the day before ${X.filters.to}. The filters below apply to these records.`,action:C.button({label:'Clear selection',variant:'ghost',attrs:{id:'clear-dashboard-selection'}})}));view.querySelector('#clear-dashboard-selection')?.addEventListener('click',()=>{location.hash=`/${S.route}`;});}
  }catch(error){if(!view.isConnected)return;if(!session())return renderAuth();view.innerHTML=C.notice({title:'This page couldn’t load',text:error.message,tone:'negative',action:C.button({label:'Try again',variant:'secondary',attrs:{id:'retry-view'}})});view.querySelector('#retry-view').onclick=renderView;}
}
const upgradeNotice=()=>C.notice({title:'Workspace access upgrade required',text:'New roles, invitations, audit records and bills need the reviewed database migration. Ask your workspace administrator to complete the upgrade.'});
async function renderSettings(view,X){
  const workspaceId=X.S.ws.id,uid=X.uid(),settingsSequence=loadSequence;
  const active=()=>view.isConnected&&S.ws?.id===workspaceId&&session()?.user.id===uid&&loadSequence===settingsSequence;
  const settingsHeader=()=>C.pageHeader({title:'Workspace settings',description:'Keep your farms and workspace details up to date.'});
  view.innerHTML='<div id="settings-heading">'+settingsHeader()+'</div>'+C.tabs([{id:'farms',label:'Farms'},{id:'workspace',label:'Workspace'},{id:'profile',label:'Your account'}],{active:'farms'})+'<div id="settings-content"></div>';
  const target=$('#settings-content',view),heading=$('#settings-heading',view);let generation=0,headerObserver;
  const life=new MutationObserver(()=>{if(!view.isConnected){headerObserver?.disconnect();life.disconnect();}});if(view.parentElement)life.observe(view.parentElement,{childList:true});
  const go=async(id)=>{const sequence=++generation;headerObserver?.disconnect();heading.innerHTML=settingsHeader();view.querySelectorAll('[role=tab]').forEach(tab=>{tab.setAttribute('aria-selected',String(tab.dataset.tab===id));tab.tabIndex=tab.dataset.tab===id?0:-1;});const box=document.createElement('div');target.replaceChildren(box);const moveHeader=()=>{const header=box.querySelector('.ui-page-header');if(header)heading.replaceChildren(header);};headerObserver=new MutationObserver(moveHeader);headerObserver.observe(box,{childList:true});
    if(id==='farms')await resource(box,X,{table:'farms',module:'farms',title:'Farms',singular:'farm',icon:'overview',farmScoped:false,order:'name',search:['name','county','location_text'],emptyTitle:'Add your first farm',emptyText:'Farms hold your tasks, money, workers and field records.',deleteWarning:'Deleting a farm also deletes all records attached to it. You can undo during the countdown; after deletion these records cannot be restored.',fields:[{k:'name',label:'Farm name',req:true},{k:'county',label:'County'},{k:'location_text',label:'Location notes'}],cols:[{k:'name',label:'Farm'},{k:'county',label:'County'},{k:'location_text',label:'Location'}],afterChange:async()=>{let farms;try{farms=await readAll(X.db,'farms',`workspace_id=eq.${workspaceId}&order=created_at.asc,id.asc`,{active});}catch(error){if(!active())return;throw error;}if(!active())return;S.farms=farms;if(!S.farms.some(f=>f.id===S.farmId))S.farmId='all';renderBar();}});
    else if(id==='workspace'){box.innerHTML=`<section class="card"><h2>Workspace details</h2><p class="muted">${esc(S.ws.name)} · ${esc(S.ws.currency)}</p>${S.accessReady?C.notice({title:'Access upgrade installed',text:'Role and farm permissions are enforced by the database.'}):upgradeNotice()}${C.button({label:'Create another workspace',variant:'secondary',attrs:{id:'new-workspace'}})}${!S.farms.length&&S.ws.currency==='KES'&&P.canWriteModule(S.role,'farms')&&!S.farmIds?C.button({label:'Load sample data',variant:'secondary',attrs:{id:'load-demo'}}):''}</section>`;box.querySelector('#new-workspace').onclick=renderCreateWs;
      box.querySelector('#load-demo')?.addEventListener('click',async(event)=>{const btn=event.currentTarget;if(btn.disabled)return;const ws=S.ws.id,uid=session()?.user.id;if(!await C.confirmDialog({title:'Add fictional sample records?',text:'Use a separate empty workspace for these invented farms, people and transactions. They are stored in the selected workspace.',confirmLabel:'Load sample data'}))return;if(S.ws.id!==ws||session()?.user.id!==uid)return;busy(btn,true);try{await loadDemo({S:{...S,ws:{...S.ws}},db:context().db});if(S.ws?.id===ws&&session()?.user.id===uid){toast('Sample data loaded');await load();}}catch(error){if(S.ws?.id!==ws||session()?.user.id!==uid)return;toast(`Sample setup may be incomplete. ${error.message}`,{tone:'negative'});try{await load();}catch(reloadError){renderLoadError('Couldn’t reload sample setup',reloadError);}}});
    }
    else {box.innerHTML=C.emptyState({title:'Your account',text:'Your profile, security and display preferences live together in your Account area.',action:C.button({label:'Open my account',variant:'secondary',attrs:{id:'settings-account'}})});box.querySelector('#settings-account').onclick=()=>{location.hash='/account?section=profile';};}
    if(sequence!==generation)return;moveHeader();
  };view.querySelector('.ui-tabs').onclick=event=>{const tab=event.target.closest('[data-tab]');if(tab){X.setViewURL({section:tab.dataset.tab});go(tab.dataset.tab).catch(error=>{target.innerHTML=C.notice({text:error.message,tone:'negative'});});}};await go(['farms','workspace','profile'].includes(X.filters.section)?X.filters.section:'farms');
}
async function openAddRecord(){
  const dlg=$('#dlg');if(dlg.open&&dlg.querySelector('form')&&!await confirmLeave())return;
  const choices=[['daily','Task'],['finances','Transaction'],['vendors','Vendor'],['workers','Worker'],['infrastructure','Project'],['livestock','Livestock or crop record'],['funding','Funding opportunity']].filter(([key])=>permissionContext().canWriteModule(key));
  C.openDrawer(dlg,{title:'Add a record',description:'Choose where to record this activity.',body:`<div class="record-picker">${P.canWriteModule(S.role,'farms')&&!S.farmIds?C.button({label:'Farm',variant:'secondary',attrs:{'data-k':'farm'}}):''}${choices.map(([key,label])=>C.button({label,variant:'secondary',attrs:{'data-k':key,disabled:!S.farms.length}})).join('')}</div>`});
  dlg.onclick=async event=>{const key=event.target.closest('[data-k]')?.dataset.k;if(key==='farm'){if(await confirmLeave())openFarm();}else if(choices.some(([id])=>id===key)){dlg.close();location.hash=`/${key}?add=1`;}};
}
function openFarm(farm=null,afterSave=null,onboarding=false){
  if(!P.canWriteModule(S.role,'farms')||S.farmIds)return;const dlg=$('#dlg'),workspace=S.ws.id,uid=session()?.user.id,draftId=farm?.id||crypto.randomUUID();let exists=Boolean(farm),uncertain=false,saving=false,dirty=false;
  dlg.onclick=null;dlg.oncancel=null;
  const drawer=C.openDrawer(dlg,{title:farm?'Edit farm':'Add your first farm',description:onboarding?'Step 2 of 3 · Give your farm a name and location.':'Required fields are marked with an asterisk.',body:`<form id="farm-form" novalidate>${C.field({label:'Farm name',name:'name',value:farm?.name||'',required:true,attrs:{maxlength:120}})}${C.field({label:'County',name:'county',value:farm?.county||''})}${C.field({label:'Location notes',name:'location_text',value:farm?.location_text||'',hint:'A nearby town, road or landmark helps your team identify the farm.'})}<div id="farm-message"></div></form>`,actions:C.button({label:onboarding?'Set up later':'Cancel',variant:'ghost',attrs:{id:'cancel-farm'}})+C.button({label:'Save farm',type:'submit',attrs:{form:'farm-form'}})});
  const form=$('#farm-form',dlg),message=$('#farm-message',dlg),controls=[...dlg.querySelectorAll('button,input,select,textarea')];
  const current=()=>session()?.user.id===uid&&S.ws?.id===workspace&&dlg.querySelector('#farm-form')===form;
  const unregister=registerUnsaved({element:form,isDirty:()=>dirty,isSaving:()=>saving,isActive:()=>dlg.open&&current()});
  form.addEventListener('input',event=>{dirty=true;if(event.target.name==='name'){const invalid=!event.target.value.trim(),error=form.querySelector('[data-error-for=name]');event.target.setAttribute('aria-invalid',String(invalid));if(error){error.hidden=!invalid;error.textContent=invalid?'Enter a farm name.':'';}}});
  const close=async()=>{if(!saving&&current()&&(!dirty||await confirmLeave())){dirty=false;unregister();dlg.close();}};
  const closeButton=dlg.querySelector('[data-drawer-close]');closeButton.removeEventListener('click',drawer.close);closeButton.addEventListener('click',close);
  dlg.oncancel=event=>{if(saving||dirty){event.preventDefault();if(!saving)close();}};
  $('#cancel-farm',dlg).onclick=async()=>{if(saving||!current())return;await close();if(onboarding&&!dlg.open)showOnboardingTeam();};
  form.onsubmit=async(event)=>{event.preventDefault();const btn=dlg.querySelector('[type=submit]'),values=Object.fromEntries(new FormData(form));if(saving||btn.disabled||!formErrors(form,{name:values.name.trim()?'':'Enter a farm name.'})||!current())return;saving=true;controls.forEach(control=>control.disabled=true);busy(btn,true);
    try{if(!exists&&uncertain)exists=Boolean((await db.select('farms',`id=eq.${draftId}&workspace_id=eq.${workspace}`))[0]);if(!current())return;const row={name:values.name.trim(),county:values.county.trim()||null,location_text:values.location_text.trim()||null};let saved;if(exists)saved=await db.update('farms',draftId,row);else{try{saved=await db.insert('farms',{...row,id:draftId,workspace_id:workspace});}catch(error){if(error.status===0)uncertain=true;throw error;}}exists=true;if(workspace!==S.ws?.id||session()?.user.id!==uid)return;S.farms=S.farms.some(f=>f.id===draftId)?S.farms.map(f=>f.id===draftId?saved:f):[...S.farms,saved];if(!current())return;dirty=false;unregister();dlg.close();renderBar();renderView();toast('Farm saved');if(afterSave)await afterSave();}
    catch(error){if(current())message.innerHTML=C.notice({text:error.message,tone:'negative'});}finally{saving=false;controls.forEach(control=>control.disabled=false);busy(btn,false);}};
}
boot();
