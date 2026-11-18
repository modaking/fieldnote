// Personal account controls remain separate from workspace administration.
import * as C from './components.js';
import { accountClient as A, prepareAvatar, sessionClaims, recentlyAuthenticated } from './account-client.js';
import { auth, session } from './supabase.js';
import { setPref } from './theme.js';
import { registerUnsaved, confirmLeave } from './feedback.js';
import { renderInvitationVerification } from './auth-ui.js';

const esc = C.escapeHTML;
const sections = ['profile','security','workspaces','notifications','invitations','privacy'];
const labels = {profile:'Profile',security:'Security',workspaces:'Workspaces',notifications:'Notifications',invitations:'Invitations',privacy:'Data & privacy'};
export const accountDate = (value,profile={}) => {if(!value||Number.isNaN(Date.parse(value)))return 'Unavailable';try{return new Date(value).toLocaleString(profile.language==='sw'?'sw-KE':'en-KE',{dateStyle:'medium',timeStyle:'short',timeZone:profile.time_zone||'Africa/Nairobi'});}catch{return new Date(value).toLocaleString();}};
const button = (label,action,variant='secondary',extra={}) => C.button({label,variant,attrs:{'data-account-action':action,...extra}});
const verifiedTOTP = user => (user?.factors||[]).filter(f=>f.factor_type==='totp'&&f.status==='verified');
export const accountSection = hash => { const value=new URLSearchParams(String(hash||'').split('?')[1]||'').get('section');return sections.includes(value)?value:'profile'; };
export function profileErrors(values) {
  const errors={};if(!String(values.full_name||'').trim())errors.full_name='Enter your name.';
  if(String(values.full_name||'').length>120)errors.full_name='Use 120 characters or fewer.';
  if(values.phone && !/^[+\d\s().-]{5,40}$/.test(values.phone))errors.phone='Enter a phone number using digits and +, spaces or brackets.';
  if(values.time_zone){try{new Intl.DateTimeFormat('en',{timeZone:values.time_zone});}catch{errors.time_zone='Enter a valid time zone, such as Africa/Nairobi.';}}
  return errors;
}
// Stages describe completed work boundaries; fetch does not expose upload byte
// progress, so the view uses an indeterminate progress indicator throughout.
export async function saveProfilePhoto(file,{prepare=prepareAvatar,upload=A.uploadAvatar,save,preview=A.avatarURL,onStage=()=>{},assertCurrent=()=>{}}){
  onStage('Preparing photo…');const blob=await prepare(file);assertCurrent();
  onStage('Uploading photo…');const path=await upload(blob);assertCurrent();
  onStage('Saving profile…');await save(path);assertCurrent();
  onStage('Loading photo preview…');let url='',previewUnavailable=false;
  try{url=await preview(path)||'';}catch{previewUnavailable=true;}
  assertCurrent();return{path,url,previewUnavailable};
}
function showErrors(form,errors={}) {
  for(const node of form.querySelectorAll('[data-error-for]')){const text=errors[node.dataset.errorFor]||'';node.textContent=text;node.hidden=!text;form.elements[node.dataset.errorFor]?.setAttribute('aria-invalid',text?'true':'false');}
  return !Object.values(errors).some(Boolean);
}
function message(form,text,tone='negative'){form.querySelector('[data-form-message]').innerHTML=text?C.notice({text,tone}):'';}
function values(form){return Object.fromEntries(new FormData(form));}
function wireForm(form,{validate=()=>({}),save,isActive=()=>true}){
  let baseline=JSON.stringify(values(form)),saving=false;
  const unregister=registerUnsaved({element:form,isDirty:()=>JSON.stringify(values(form))!==baseline,isSaving:()=>saving,isActive});
  form.addEventListener('input',()=>showErrors(form,validate(values(form))));
  form.addEventListener('change',()=>showErrors(form,validate(values(form))));
  form.onsubmit=async event=>{event.preventDefault();if(saving)return;const data=values(form),errors=validate(data);if(!showErrors(form,errors)){form.querySelector('[aria-invalid="true"]')?.focus();return;}saving=true;const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=true;message(form,'');try{await save(data);baseline=JSON.stringify(values(form));}catch(error){if(form.isConnected)message(form,error.message);}finally{saving=false;if(submit?.isConnected)submit.disabled=false;}};
  return {clean:()=>{baseline=JSON.stringify(values(form));},unregister};
}
function accountDrawer(title,description,body,label,save,validate=()=>({}),providedDialog){
  const dialog=providedDialog||document.createElement('dialog'),created=!providedDialog;dialog.className='ui-drawer account-drawer';dialog.setAttribute('aria-labelledby','ui-drawer-title');
  dialog.innerHTML=C.drawerContent({title,description,body:`<form novalidate>${body}<div data-form-message></div><div class="account-form-actions">${C.button({label,type:'submit'})}</div></form>`});
  if(created)document.body.append(dialog);const form=dialog.querySelector('form');let wiring;
  const destroy=()=>{wiring?.unregister();dialog.close();if(created)dialog.remove();else dialog.innerHTML='';};
  const close=async()=>{if(await confirmLeave())destroy();};
  dialog.querySelector('[data-drawer-close]').onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};
  wiring=wireForm(form,{validate,isActive:()=>dialog.open,save:async data=>{await save(data,dialog);}});dialog.showModal();
  return {dialog,form,finish(){wiring.clean();destroy();}};
}

// This runs before root queries profile/workspace data. Enrolled MFA is opt-in,
// but verified factors also require aal2 in the proposed database migration.
export async function requireMfa(container,X,onVerified){
  const user=await A.getUser(),factors=verifiedTOTP(user),claims=sessionClaims();
  const other=(user.factors||[]).some(f=>f.status==='verified'&&f.factor_type!=='totp');
  if(claims.aal==='aal2'||(!factors.length&&!other))return false;
  container.innerHTML=`<main class="account-mfa-gate"><p class="wordmark">fieldnote.</p>${C.pageHeader({title:'Verify your authenticator',description:'Enter the current six-digit code to open your account.'})}${factors.length?`<form novalidate>${factors.length>1?C.field({label:'Authenticator',name:'factor',type:'select',value:factors[0].id,options:factors.map(f=>({value:f.id,label:f.friendly_name||'Authenticator'}))}):`<input type="hidden" name="factor" value="${esc(factors[0].id)}">`}${C.field({label:'Authenticator code',name:'code',required:true,attrs:{inputmode:'numeric',pattern:'[0-9]{6}',maxlength:6,autocomplete:'one-time-code'}})}<div data-form-message></div>${C.button({label:'Verify',type:'submit'})}</form>`:C.notice({title:'Another verification method is required',text:'This account has a verified factor that this app cannot challenge. Use your existing sign-in method or contact your administrator.',tone:'warning'})}${button('Sign out','signout','ghost')}</main>`;
  if(factors.length){const form=container.querySelector('form');wireForm(form,{validate:v=>({code:/^\d{6}$/.test(v.code)?'':'Enter the six-digit code.'}),save:async v=>{await A.verifyFactor(v.factor,v.code);await onVerified();}});}
  container.querySelector('[data-account-action="signout"]').onclick=async()=>{await(X.auth||auth).signOut();await onVerified();};return true;
}

export async function account(el,X){
  const {S,db}=X,uid=session()?.user.id;if(!uid)throw new Error('Sign in to open Account.');
  const date=value=>accountDate(value,S.profile||{});
  const drawer=(title,description,body,label,save,validate)=>accountDrawer(title,description,body,label,save,validate,X.dlg?.());
  const active=()=>session()?.user.id===uid&&el.isConnected&&(!S.route||S.route==='account');
  const assertActive=()=>{if(!active())throw new Error('Your account or page changed. Reopen Account to continue.');};
  let user,context,ready=false,upgradeError='',section=accountSection(location.hash),photoURL='',photoBusy=false,workspaces=[],invites=[],sessionRows=[],sessionError='',deleteState=null,availability=null;
  const notify=(text,tone='neutral')=>(X.toast||C.toast)(text,{tone});
  const rpc=(name,args={})=>db.rpc(name,args);
  const upgrade=()=>C.notice({title:'Account upgrade required',text:'Ian needs to review and apply the supplied Account migration to enable personal preferences, sessions, invitations and account export/deletion. '+(upgradeError||''),tone:'warning'});
  const refresh=async()=>{el.innerHTML=C.pageHeader({title:'Account'})+C.skeletonRows({rows:4,columns:2});try{user=await A.getUser();assertActive();try{context=await rpc('fw_account_context');ready=context?.schema_version==='20261118-account';}catch(error){upgradeError=error.message;ready=false;}if(ready){S.profile=context.profile||S.profile;try{photoURL=await A.avatarURL(S.profile?.avatar_path)||'';}catch{photoURL='';}}assertActive();await paint();}catch(error){if(!active())return;el.innerHTML=C.pageHeader({title:'Account'})+C.notice({title:'Couldn’t load Account',text:error.message,tone:'negative',action:button('Try again','retry')});bindActions();}};
  const go=async next=>{if(!sections.includes(next)||!await confirmLeave())return;section=next;if(X.setViewURL)X.setViewURL({section:next==='profile'?null:next});else history.replaceState(null,'',location.pathname+location.search+'#/account'+(next==='profile'?'':'?section='+next));await paint();};
  async function paint(){
    if(!active())return;
    const more=C.actionMenu({label:'More account sections',text:'More',items:['notifications','invitations','privacy'].map(id=>({label:labels[id],attrs:{'data-account-section':id}}))});
    el.innerHTML=C.pageHeader({title:'Account',description:user.email||'Your personal account',actions:more})+C.tabs(['profile','security','workspaces'].map(id=>({id:'account-'+id,label:labels[id]})),{label:'Account',active:'account-'+section})+`<div class="account-content" role="region" aria-label="${esc(labels[section])}"><div data-account-body></div></div>`;
    el.querySelectorAll('[data-account-section]').forEach(node=>node.onclick=()=>go(node.dataset.accountSection));
    el.querySelectorAll('[data-tab]').forEach(node=>{node.onclick=()=>go(node.dataset.tab.replace('account-',''));node.onkeydown=async event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...el.querySelectorAll('[data-tab]')],index=tabs.indexOf(node),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;await go(tabs[next].dataset.tab.replace('account-',''));el.querySelectorAll('[data-tab]')[next]?.focus();};});
    const body=el.querySelector('[data-account-body]');
    if(section==='profile')profile(body);else if(section==='security')await security(body);else if(section==='workspaces')await workspaceList(body);else if(section==='notifications')await notifications(body);else if(section==='invitations')await invitationList(body);else await privacy(body);
    if(active())bindActions();
  }
  function profile(body){
    const p=S.profile||{},fields=C.field({label:'Your name',name:'full_name',value:p.full_name||'',required:true,attrs:{autocomplete:'name',maxlength:120}})+C.field({label:'Email',name:'email',type:'email',value:user.email||'',attrs:{readonly:true},hint:'Change your email in Security.'});
    const extras=ready?C.field({label:'Phone (optional)',name:'phone',type:'tel',value:p.phone||'',attrs:{autocomplete:'tel',maxlength:40}}):'';
    const display=C.field({label:'Theme',name:'theme_pref',type:'select',value:p.theme_pref||'system',options:['system','light','dark']})+(ready?C.field({label:'Language for formatting',name:'language',type:'select',value:p.language||'en',options:[{value:'en',label:'English'},{value:'sw',label:'Kiswahili'}],hint:'The interface currently uses English.'})+C.field({label:'Time zone',name:'time_zone',value:p.time_zone||'Africa/Nairobi',hint:'For example Africa/Nairobi.'})+C.field({label:'Default farm',name:'default_farm_id',type:'select',value:p.default_farm_id||'',options:[{value:'',label:'All available farms'},...(S.farms||[]).map(f=>({value:f.id,label:f.name}))],hint:'Choose from farms available in the current workspace.'})+C.field({label:'Default dashboard period',name:'default_period',type:'select',value:p.default_period||'month',options:[{value:'month',label:'Current month'},{value:'quarter',label:'Last 3 months'},{value:'half-year',label:'Last 6 months'},{value:'year',label:'Last 12 months'}]}):'');
    body.innerHTML=`<section class="card account-panel"><div class="account-photo">${photoURL?`<img src="${esc(photoURL)}" alt="Your profile photo" width="72" height="72">`:`<span aria-hidden="true" class="account-initial">${esc((p.full_name||user.email||'?')[0].toUpperCase())}</span>`}<div><h2>${esc(p.full_name||'Your profile')}</h2>${ready?button('Change photo','photo')+(p.avatar_path?button('Remove photo','remove-photo','ghost'):''):''}</div></div><div data-photo-status aria-live="polite"></div><form novalidate>${fields}<details class="account-options"><summary>More options</summary>${extras}<h3>Display options</h3>${display}</details><div data-form-message></div>${C.button({label:'Save profile',type:'submit'})}</form></section>${ready?'':upgrade()}`;
    registerUnsaved({element:body.querySelector('[data-photo-status]'),isDirty:()=>false,isSaving:()=>photoBusy,isActive:active});
    wireForm(body.querySelector('form'),{validate:profileErrors,save:async v=>{assertActive();if(photoBusy)throw new Error('Wait for your profile photo to finish saving.');const patch={full_name:v.full_name.trim(),theme_pref:v.theme_pref};if(ready)Object.assign(patch,{phone:v.phone?.trim()||null,language:v.language,time_zone:v.time_zone.trim(),default_farm_id:v.default_farm_id||null,default_period:v.default_period});await db.update('profiles',uid,patch);assertActive();Object.assign(S.profile||(S.profile={}),patch);setPref(patch.theme_pref);notify('Profile saved.','positive');}});
  }
  async function security(body){
    const factors=verifiedTOTP(user),identities=user.identities||[],providers=[...new Set(identities.map(i=>i.provider).filter(Boolean))];
    let options=null,optionsError='';try{options=await auth.capabilities();}catch(error){optionsError=error.message;}if(!active()||section!=='security')return;
    body.innerHTML=`<section class="card account-panel"><h2>Sign-in details</h2><dl class="account-details"><div><dt>Email</dt><dd>${esc(user.email||'No email')} ${C.badge({label:user.email_confirmed_at?'Verified':'Unverified',tone:user.email_confirmed_at?'positive':'warning'})}</dd></div><div><dt>Last sign-in</dt><dd>${esc(date(user.last_sign_in_at))}</dd></div><div><dt>Connected methods</dt><dd>${esc(providers.join(', ')||'No linked methods')}</dd></div></dl><div class="btns">${button('Change email','email')}${button('Change password','password')}${C.actionMenu({label:'More security actions',text:'More',items:[{label:'Verify sign-in again',attrs:{'data-account-action':'reauth'}},{label:'Send a sign-in link',attrs:{'data-account-action':'magic'}},...(providers.includes('google')?[{label:'Remove Google',attrs:{'data-account-action':'unlink-google',disabled:identities.length<2,title:identities.length<2?'Keep another verified sign-in method first.':null}}]:options?.google?[{label:'Connect Google',attrs:{'data-account-action':'google'}}]:[])]})}</div>${optionsError?C.notice({text:'Other sign-in options could not be checked. '+optionsError,tone:'warning',action:button('Try again','providers')}):!options?.google&&!providers.includes('google')?'<p class="caption muted">Google sign-in is not enabled for this app.</p>':''}<p class="caption muted">Email changes require verification. Security changes require a recent sign-in and your enrolled authenticator.</p></section><section class="card account-panel"><h2>Authenticator</h2><p>${factors.length?'Your account uses an authenticator. Keep it available when signing in.':'Add an authenticator app for an extra verification step when signing in.'}</p>${factors.length?factors.map(f=>`<div class="account-row"><span>${esc(f.friendly_name||'Authenticator')}</span>${button('Remove','mfa-remove','ghost',{'data-factor':f.id})}</div>`).join(''):button('Set up authenticator','mfa-enroll','secondary',{disabled:!ready})}</section><section class="card account-panel"><h2>Sessions</h2><div data-sessions>${C.skeletonRows({rows:2,columns:2})}</div>${button('Sign out other devices','logout-others')}<p class="caption muted">This keeps this device signed in. Previously issued access tokens may work until they expire.</p></section>${ready?'':upgrade()}`;
    if(!ready){body.querySelector('[data-sessions]').innerHTML='<p class="muted">Session details require the Account upgrade.</p>';return;}
    try{const result=await rpc('fw_account_sessions');if(!active()||section!=='security')return;sessionRows=result.sessions||[];sessionError='';body.querySelector('[data-sessions]').innerHTML=sessionRows.length?`<ul class="account-list">${sessionRows.map(s=>`<li><strong>${s.current?'This device':'Other device'}</strong><span>${esc(s.user_agent||'Browser details unavailable')}</span><small>${esc(s.ip||'IP unavailable')} · Started ${esc(date(s.created_at))}</small></li>`).join('')}</ul>`:'<p class="muted">No session metadata is available.</p>';}catch(error){sessionError=error.message;if(active()&&section==='security')body.querySelector('[data-sessions]').innerHTML=C.notice({text:'Session details unavailable. '+sessionError,tone:'warning'});}
  }
  async function notifications(body){
    if(!ready){body.innerHTML=upgrade();return;}const p=context.notifications||{};
    body.innerHTML=`<section class="card account-panel"><h2>Notifications</h2><div data-account-alerts>${C.skeletonRows({rows:2,columns:2})}</div></section><section class="card account-panel"><details class="account-options"><summary>Notification preferences</summary><p>Choose your channels and topics. Automated email delivery is not configured in this version; saving preferences does not schedule messages.</p><form novalidate>${[['in_app','In-app notices'],['email','Email notices (delivery not configured)'],['tasks','Tasks & deadlines'],['bills','Bills & financial reminders'],['invitations','Invitations']].map(([name,label])=>C.field({label,name,type:'select',value:p[name]===false?'false':'true',options:[{value:'true',label:'On'},{value:'false',label:'Off'}]})).join('')}<div data-form-message></div>${C.button({label:'Save preferences',type:'submit'})}</form></details></section>`;
    wireForm(body.querySelector('form'),{save:async v=>{assertActive();const row={user_id:uid,...Object.fromEntries(Object.entries(v).map(([k,value])=>[k,value==='true'])),updated_at:new Date().toISOString()};await db.upsert('account_notification_preferences',row,'user_id');assertActive();context.notifications=row;notify('Notification preferences saved.','positive');await paint();}});
    const alerts=body.querySelector('[data-account-alerts]');
    if(p.in_app===false){alerts.innerHTML=C.notice({text:'In-app notices are turned off.',action:button('Enable in-app notices','enable-notices')});return;}
    const parts=new Intl.DateTimeFormat('en',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit'}).formatToParts(new Date()),year=parts.find(x=>x.type==='year').value,month=parts.find(x=>x.type==='month').value;
    const range={from:`${year}-${month}-01`,to_exclusive:new Date(Date.UTC(Number(year),Number(month),1)).toISOString().slice(0,10),farm_id:S.farmId==='all'?null:S.farmId};
    const results=await Promise.allSettled([S.ws?rpc('fw_dashboard',{p_workspace_id:S.ws.id,p_from:range.from,p_to:range.to_exclusive,p_farm_id:range.farm_id}):Promise.resolve(null),p.invitations===false?Promise.resolve([]):rpc('fw_account_invites')]);
    if(!active()||section!=='notifications'||!alerts.isConnected)return;
    const dashboard=results[0].status==='fulfilled'?results[0].value:null,pending=results[1].status==='fulfilled'?results[1].value:[];
    const attention=(dashboard?.attention||[]).filter(row=>['overdue_task','grant_deadline'].includes(row.kind)?p.tasks!==false:p.bills!==false);
    const dashboardDrillURL=attention.length?(await import('./dashboard.js')).dashboardDrillURL:null;
    if(!active()||section!=='notifications'||!alerts.isConnected)return;
    alerts.innerHTML=`<p class="caption muted">Current attention items from records you can access${S.ws?' in '+esc(S.ws.name):''}. These are live reminders, not a delivery or read history.</p>`
      +(attention.length||pending.length?`<ul class="account-list">${attention.map(row=>`<li><strong>${esc(row.title)}</strong><span>${esc(row.date||'')}</span><a class="btn ghost" href="${esc(dashboardDrillURL(row.action?.module,dashboard.scope||range,{...(row.action?.filters||{}),...(row.action?.tab?{tab:row.action.tab}:{})}))}">View records</a></li>`).join('')}${pending.map(invite=>`<li><strong>Invitation to ${esc(invite.workspace_name)}</strong><span>${esc(invite.role)} · Expires ${esc(date(invite.expires_at))}</span>${button('Review invitation','review-invites','ghost')}</li>`).join('')}</ul>`:C.emptyState({title:'Nothing needs your attention',text:'No current items match your saved topics.'}))
      +(S.ws&&!dashboard?C.notice({text:'Workspace attention is unavailable. The reviewed dashboard migration may need to be installed. Your personal invitations are shown when available.',tone:'warning'}):'')
      +(results[1].status==='rejected'?C.notice({text:'Personal invitations could not be loaded. Try refreshing Account.',tone:'warning'}):'');
  }
  async function workspaceList(body){
    body.innerHTML=C.skeletonRows({rows:3,columns:2});
    try{workspaces=ready?await rpc('fw_account_workspaces'):(S.memberships||[]).map(m=>({...m.workspaces,role:m.role}));if(!active()||section!=='workspaces')return;
      body.innerHTML=`<section class="card account-panel"><div class="account-section-head"><h2>Your workspaces</h2>${button('Create workspace','create-workspace','primary')}</div>${workspaces.length?`<ul class="account-list">${workspaces.map(w=>`<li><div><strong>${esc(w.name)}</strong> ${C.badge({label:w.role})}${w.id===S.ws?.id?C.badge({label:'Current',tone:'positive'}):''}</div><div class="btns">${w.id!==S.ws?.id?button('Switch','switch-workspace','secondary',{'data-workspace':w.id}):''}${button('Leave','leave-workspace','ghost',{'data-workspace':w.id,disabled:!ready})}</div>${w.role==='owner'?'<small>Transfer your owner role to another member before leaving.</small>':''}</li>`).join('')}</ul>`:C.emptyState({title:'No workspaces yet',text:'Create a workspace or accept an invitation.'})}</section>${ready?'':upgrade()}`;
    }catch(error){if(active())body.innerHTML=C.notice({text:error.message,tone:'negative',action:button('Try again','retry')});}
  }
  async function invitationList(body){
    if(!ready){body.innerHTML=upgrade();return;}body.innerHTML=C.skeletonRows({rows:3,columns:2});
    try{const status=await auth.invitationVerification();if(!active()||section!=='invitations')return;if(status.needs_recovery||!status.proof_recent){renderInvitationVerification(body,{auth,email:user.email,needsRecovery:status.needs_recovery,returnTo:'#/account?section=invitations',isActive:()=>active()&&section==='invitations'&&body.isConnected});return;}
      invites=await rpc('fw_account_invites');if(!active()||section!=='invitations')return;body.innerHTML=`<section class="card account-panel"><h2>Pending invitations</h2><p>Only invitations addressed to your verified email appear here.</p>${!user.email_confirmed_at?C.notice({text:'Verify your email before accepting workspace invitations.',tone:'warning'}):invites.length?`<ul class="account-list">${invites.map(i=>`<li><strong>${esc(i.workspace_name)}</strong><span>${esc(i.role)} · Expires ${esc(date(i.expires_at))}</span><div class="btns">${button('Accept','accept-invite','secondary',{'data-invite':i.id})}${button('Decline','decline-invite','ghost',{'data-invite':i.id})}</div></li>`).join('')}</ul>`:C.emptyState({title:'No pending invitations',text:'Invitations to your verified email will appear here.'})}</section>`;}catch(error){if(active())body.innerHTML=C.notice({text:error.message,tone:'negative',action:button('Try again','retry')});}
  }
  async function privacy(body){
    if(!ready){body.innerHTML=upgrade();return;}body.innerHTML=C.skeletonRows({rows:3,columns:2});
    const results=await Promise.allSettled([rpc('fw_account_delete_status'),A.availability()]);if(!active()||section!=='privacy')return;
    deleteState=results[0].status==='fulfilled'?results[0].value:null;availability=results[1].status==='fulfilled'?results[1].value:null;
    const owners=deleteState?.owned_workspaces||[],files=Number(deleteState?.business_files||0);
    const reason=!deleteState?'Account deletion checks are unavailable.':owners.length?'Transfer ownership of these workspaces first: '+owners.map(w=>w.name).join(', '):files?'Business files are still owned by this account. Ask your administrator to transfer their ownership.':!availability?.delete_available?availability?.message||'Account deletion is not configured on the server.':'';
    body.innerHTML=`<section class="card account-panel"><h2>Your data</h2><p>Download your profile, preferences, memberships and pending invitations as JSON. Shared farm records are available through the reports you can access.</p>${button('Export my account data','export','primary')}</section><section class="card account-panel"><h2>Delete account</h2><p>Deletion removes your sign-in, personal profile and preferences. Shared farm records and audit history remain, with account references cleared. Transfer all workspace ownership and owned business files first.</p>${reason?C.notice({text:reason,tone:'warning'}):''}${button('Delete account','delete','danger',{disabled:Boolean(reason)})}</section>`;
  }
  async function reauthenticate(){
    if(!await confirmLeave())return;const factor=verifiedTOTP(user)[0];let ui;
    ui=drawer('Verify your sign-in','Enter your current password. If you use passwordless sign-in, close this and send a sign-in link from Security.',C.field({label:'Current password',name:'password',type:'password',required:true,attrs:{autocomplete:'current-password'}})+(factor?C.field({label:'Authenticator code',name:'code',required:true,attrs:{inputmode:'numeric',maxlength:6,autocomplete:'one-time-code'}}):''),'Verify',async v=>{assertActive();user=await A.reauthenticatePassword(v.password,v.code);ui.finish();notify('Sign-in verified. You can continue with the security change.','positive');},v=>({password:v.password?'':'Enter your current password.',...(factor?{code:/^\d{6}$/.test(v.code)?'':'Enter the six-digit code.'}:{})}));
  }
  async function securityChange(kind){
    if(!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}if(!ready){notify('Apply the reviewed Account migration before changing security details here.','warning');return;}
    let ui;const email=kind==='email';
    const content=email?C.field({label:'New email',name:'email',type:'email',required:true,attrs:{autocomplete:'email'}}):C.field({label:'Current password (if you use one)',name:'current_password',type:'password',hint:'Enter it if your account uses a password. Leave blank for passwordless sign-in.',attrs:{autocomplete:'current-password'}})+C.field({label:'New password',name:'password',type:'password',required:true,attrs:{autocomplete:'new-password',minlength:8}})+C.field({label:'Confirm new password',name:'confirm_password',type:'password',required:true,attrs:{autocomplete:'new-password'}})+`<details><summary>Verification code options</summary><p>If Supabase requests email reauthentication, send a code and enter it below.</p>${button('Send verification code','send-nonce')}${C.field({label:'Email verification code (if requested)',name:'nonce',attrs:{autocomplete:'one-time-code'}})}</details>`;
    ui=drawer(email?'Change email':'Change password',email?'A verification email is required to complete this change.':'Use at least 8 characters. Your sign-in provider may require an email verification code.',content,email?'Send verification':'Change password',async v=>{assertActive();const result=email?await A.changeEmail(v.email.trim()):await A.changePassword(v.password,v.nonce,v.current_password);auth.syncUser(result.user);user=result.user;ui.finish();notify(email?'Check your email addresses for the verification steps.':'Password changed.','positive');await paint();},v=>email?{email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)?'':'Enter a valid email address.'}:{password:v.password.length>=8?'':'Use at least 8 characters.',confirm_password:v.confirm_password===v.password?'':'The passwords do not match.'});
    ui.dialog.querySelector('[data-account-action="send-nonce"]')?.addEventListener('click',async event=>{const b=event.currentTarget;b.disabled=true;try{await A.sendReauthentication();message(ui.form,'Check your verified email for a code.','positive');}catch(error){message(ui.form,error.message);}finally{b.disabled=false;}});
  }
  async function enroll(){
    if(!ready||!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}let factor,ui,verificationStarted=false;
    try{assertActive();factor=await A.enrollTOTP('Fieldnote authenticator');assertActive();const qr=factor.totp?.qr_code,src=qr?.startsWith('data:image/')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr||'');
      ui=drawer('Set up authenticator','Scan this code with an authenticator app, then enter its current code. Setup is enabled only after verification.',`<div class="account-qr"><img src="${esc(src)}" alt="Authenticator setup QR code" width="220" height="220"></div><details><summary>Enter setup key manually</summary><code class="account-secret">${esc(factor.totp?.secret||'Unavailable')}</code></details>${C.field({label:'Authenticator code',name:'code',required:true,attrs:{inputmode:'numeric',maxlength:6,autocomplete:'one-time-code'}})}`,'Verify & enable',async v=>{assertActive();verificationStarted=true;await A.verifyFactor(factor.id,v.code);ui.finish();user=await A.getUser();notify('Authenticator enabled.','positive');await paint();},v=>({code:/^\d{6}$/.test(v.code)?'':'Enter the six-digit code.'}));
      // Do not automatically delete after an ambiguous verification response:
      // it may have enabled MFA. A never-submitted setup is safe to cancel.
      ui.dialog.addEventListener('close',()=>{if(!verificationStarted&&session()?.user.id===uid)A.unenrollFactor(factor.id).catch(()=>{});},{once:true});
    }catch(error){notify(error.message,'negative');}
  }
  async function deleteAccount(){
    if(!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}let ui;
    ui=drawer('Delete your account','This permanently removes your sign-in and personal account data. Shared business records and audit history are retained. Profile photos may be removed during cleanup even if a later deletion check fails.',C.field({label:'Your current email',name:'email',type:'email',required:true})+C.field({label:'Type DELETE MY ACCOUNT',name:'confirmation',required:true,attrs:{autocomplete:'off'}}),'Delete account',async v=>{assertActive();await A.deleteAccount(v.email);ui.finish();await auth.signOut();await X.reload?.();},v=>({email:v.email.toLowerCase().trim()===user.email?.toLowerCase()?'':'Enter your current email address.',confirmation:v.confirmation==='DELETE MY ACCOUNT'?'':'Type DELETE MY ACCOUNT exactly.'}));
    ui.form.querySelector('[type=submit]').classList.add('danger');
  }
  function bindActions(){
    el.querySelectorAll('[data-account-action]').forEach(node=>node.onclick=async()=>{
      if(node.disabled)return;const action=node.dataset.accountAction;node.disabled=true;
      try{assertActive();
        if(action==='retry')await refresh();
        else if(action==='providers'){await auth.capabilities({refresh:true});await paint();}
        else if(action==='email'||action==='password')await securityChange(action);
        else if(action==='reauth')await reauthenticate();
        else if(action==='magic'){if(await confirmLeave()){await auth.magicLink(user.email);notify('Check your email for a sign-in link. Return to Account afterward.','positive');}}
        else if(action==='google'){if(await confirmLeave()){if(!recentlyAuthenticated()){await reauthenticate();return;}await A.connectGoogle();}}
        else if(action==='unlink-google'){if(!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}if(await C.confirmDialog({title:'Remove Google sign-in?',text:'You will need another connected sign-in method to access this account. Google will no longer sign you in.',confirmLabel:'Remove Google',danger:true})){const removed=await A.unlinkGoogle();assertActive();user={...user,identities:(user.identities||[]).filter(item=>item.identity_id!==removed)};auth.syncUser(user);try{user=await A.getUser();}catch{notify('Google removed. Refresh Account to review your current connected methods.','warning');}await paint();notify('Google sign-in removed.','positive');}}
        else if(action==='review-invites')await go('invitations');
        else if(action==='enable-notices'){if(await confirmLeave()){await db.upsert('account_notification_preferences',{...context.notifications,user_id:uid,in_app:true,updated_at:new Date().toISOString()},'user_id');assertActive();context.notifications.in_app=true;await paint();}}
        else if(action==='logout-others'){if(!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}if(await C.confirmDialog({title:'Sign out other devices?',text:'This device stays signed in. Access tokens already issued to other devices can remain valid until they expire.',confirmLabel:'Sign out others'})){await A.signOutOthers();notify('Other sessions have been signed out.','positive');await paint();}}
        else if(action==='mfa-enroll')await enroll();
        else if(action==='mfa-remove'){if(!await confirmLeave())return;if(!recentlyAuthenticated()){await reauthenticate();return;}if(await C.confirmDialog({title:'Remove authenticator?',text:'You will no longer need this authenticator when signing in.',confirmLabel:'Remove authenticator',danger:true})){await A.unenrollFactor(node.dataset.factor);user=await A.getUser();await paint();notify('Authenticator removed.');}}
        else if(action==='photo'){
          if(!await confirmLeave())return;const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';
          input.onchange=async()=>{
            const file=input.files?.[0];if(!file||photoBusy||!active())return;photoBusy=true;node.disabled=true;
            const status=el.querySelector('[data-photo-status]');
            const stage=text=>{if(!active()||!status?.isConnected)return;status.setAttribute('aria-busy','true');status.innerHTML=C.notice({text})+`<progress aria-label="${esc(text)}"></progress>`;};
            try{
              const result=await saveProfilePhoto(file,{assertCurrent:assertActive,onStage:stage,save:path=>db.update('profiles',uid,{avatar_path:path})});
              assertActive();S.profile.avatar_path=result.path;photoURL=result.url;photoBusy=false;await paint();
              notify(result.previewUnavailable?'Profile photo saved. Its preview is temporarily unavailable.':'Profile photo saved.',result.previewUnavailable?'warning':'positive');
            }catch(error){if(active()){if(status?.isConnected){status.setAttribute('aria-busy','false');status.innerHTML=C.notice({text:error.message,tone:'negative'});}notify(error.message,'negative');}}
            finally{photoBusy=false;if(node.isConnected)node.disabled=false;}
          };input.click();
        }
        else if(action==='remove-photo'){if(await confirmLeave()&&await C.confirmDialog({title:'Remove profile photo?',text:'Your initials will appear instead.',confirmLabel:'Remove photo'})){await A.removeAvatar(S.profile.avatar_path);await db.update('profiles',uid,{avatar_path:null});assertActive();S.profile.avatar_path=null;photoURL='';await paint();}}
        else if(action==='switch-workspace'){if(await confirmLeave())await X.switchWorkspace(node.dataset.workspace);}
        else if(action==='create-workspace'){if(await confirmLeave())await X.createWorkspace();}
        else if(action==='leave-workspace'){const w=workspaces.find(w=>w.id===node.dataset.workspace);if(w.role==='owner'){notify('Transfer your owner role in Members before leaving.','warning');return;}if(await confirmLeave()&&await C.confirmDialog({title:'Leave '+w.name+'?',text:'You will lose access to this workspace. Its farm records remain. An owner must invite you again to rejoin.',confirmLabel:'Leave workspace',danger:true})){await rpc('fw_leave_workspace',{p_workspace_id:w.id});notify('Workspace left.');await X.reloadWorkspace();}}
        else if(action==='accept-invite'){if(await confirmLeave()){await rpc('fw_accept_account_invite',{p_invite_id:node.dataset.invite});notify('Invitation accepted.','positive');await X.reloadWorkspace();}}
        else if(action==='decline-invite'){if(await confirmLeave()&&await C.confirmDialog({title:'Decline invitation?',text:'This invitation will no longer be available to accept.',confirmLabel:'Decline'})){await rpc('fw_decline_account_invite',{p_invite_id:node.dataset.invite});await paint();}}
        else if(action==='export'){if(await confirmLeave()){const data=await rpc('fw_account_export');assertActive();const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fieldnote-account-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Account export downloaded.','positive');}}
        else if(action==='delete')await deleteAccount();
      }catch(error){if(active())notify(error.message,'negative');}finally{if(node.isConnected&&(action!=='photo'||!photoBusy))node.disabled=false;}
    });
  }
  await refresh();
}
