import * as C from './components.js';
import {PAGES,SECTIONS,availableSections,sectionURL,recentItems} from './navigation.js';
import {confirmLeave} from './feedback.js';

export function sectionControls(page,section,X){
  const entries=availableSections(page,X.permissions.canReadModule,X.migrationReady),main=entries.filter(item=>item.primary),more=entries.filter(item=>!item.primary),selected=entries.find(item=>item.id===section);
  if(entries.length<2)return '';
  return `<nav class="section-navigation" aria-label="${C.escapeHTML(PAGES.find(item=>item.id===page)?.label||'Sections')}"><div class="section-desktop">${C.tabs(main.map(item=>({id:item.id,label:item.label})),{active:section,label:'Sections'})}${more.length?C.actionMenu({label:'More sections',text:more.some(item=>item.id===section)?selected.label:'More',items:more.map(item=>({label:item.label,attrs:{'data-section':item.id}}))}):''}</div>${C.field({label:'Section',name:'section',value:section,type:'select',options:entries.map(item=>({value:item.id,label:item.label})),attrs:{class:'section-mobile','data-section-select':true}})}</nav>`;
}
export async function renderSectionPage(el,X,nav,views,members){
  const section=SECTIONS.find(item=>item.id===nav.section);
  if(!section)return;
  el.innerHTML=`<div id="section-heading">${C.pageHeader({title:section.label})}</div>${sectionControls(nav.page,nav.section,X)}<div id="section-content"></div>`;
  const box=el.querySelector('#section-content'),heading=el.querySelector('#section-heading'),navigation=el.querySelector('.section-navigation');
  el.querySelectorAll('[data-tab],[data-section]').forEach(button=>{button.onclick=()=>{location.hash=sectionURL(button.dataset.section||button.dataset.tab);};});
  el.querySelector('[data-section-select]')?.addEventListener('change',event=>{location.hash=sectionURL(event.target.value);});
  // Keep the header in its module's event/query scope. Move the existing section
  // controls instead; retain their listeners when a module replaces its content.
  const placeNavigation=()=>{const header=box.querySelector('.ui-page-header');heading.hidden=Boolean(header);const anchor=header||heading;if(navigation&&anchor.nextElementSibling!==navigation)anchor.after(navigation);};
  const observer=new MutationObserver(()=>{if(!el.isConnected){observer.disconnect();return;}placeNavigation();});observer.observe(box,{childList:true,subtree:true});
  const life=new MutationObserver(()=>{if(!el.isConnected){observer.disconnect();life.disconnect();}});if(el.parentElement)life.observe(el.parentElement,{childList:true});
  const local={...X,pageTitle:section.label,section:section.id};
  if(section.id==='members'||section.id==='invitations')await members(box,local,{tab:section.id==='invitations'?'invites':'members',hideTabs:true});
  else if(views[section.id])await views[section.id](box,local);
  else box.innerHTML=C.notice({title:'This section is being prepared',text:'The existing module link is still available.',tone:'warning'});
  placeNavigation();
}

export async function openCommandPalette(X){
  const dlg=X.dlg();if(!dlg)return;
  // Preserve inline forms while a temporary menu is open. Replacing an existing
  // form drawer still needs its discard/save guard; route() guards navigation.
  if(dlg.open&&dlg.querySelector('form')&&!await confirmLeave())return;
  dlg.close();
  const items=[...PAGES.filter(page=>['overview','reports'].includes(page.id)).map(page=>({label:page.label,url:`#/${page.id}`})),...SECTIONS.filter(item=>X.permissions.canReadModule(item.module)&&(!item.upgrade||X.migrationReady)).map(item=>({label:item.label,group:PAGES.find(page=>page.id===item.page)?.label,url:sectionURL(item.id)})),{label:'Workspace settings',url:'#/settings'},{label:'My account',url:'#/account'}];
  const recent=recentItems(X.uid(),X.S.ws?.id).filter(item=>{const section=SECTIONS.find(section=>section.id===item.section);return section&&X.permissions.canReadModule(section.module)&&(!item.farm||item.farm==='all'||X.S.farms.some(farm=>farm.id===item.farm));}).map(item=>({label:item.label,group:'Recent record',url:sectionURL(item.section,{id:item.id,view:'1',farm:item.farm||'all'})}));
  const panel=(C.openPanel||C.openDrawer)(dlg,{presentation:'modal',title:'Go to…',description:'Search a section or a recent record. Ctrl/Cmd+K opens this from anywhere.',body:C.input({id:'command-search',type:'search',attrs:{placeholder:'Tasks, transactions, people…','aria-label':'Search navigation',autocomplete:'off'}})+'<div class="command-results" id="command-results" role="list"></div>'});
  const input=dlg.querySelector('#command-search'),results=dlg.querySelector('#command-results');let shown=[];
  const paint=()=>{const query=input.value.trim().toLocaleLowerCase();shown=[...(!query?recent:recent.filter(item=>item.label.toLocaleLowerCase().includes(query))),...items.filter(item=>!query||`${item.label} ${item.group||''}`.toLocaleLowerCase().includes(query))];results.innerHTML=shown.length?shown.map((item,index)=>C.button({label:item.label,variant:'ghost',attrs:{'data-command':index,'aria-label':`${item.label}${item.group?' · '+item.group:''}`}})).join(''):C.emptyState({title:'No matches',text:'Try “tasks”, “reports” or “account”.'});};
  input.oninput=paint;input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}else if(event.key==='Enter'&&shown[0]){event.preventDefault();panel.close();location.hash=shown[0].url;}};
  results.onclick=event=>{const button=event.target.closest('[data-command]');if(!button)return;panel.close();location.hash=shown[Number(button.dataset.command)].url;};
  results.onkeydown=event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;const buttons=[...results.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();};
  paint();input.focus();
}
export async function openMoreNavigation(X){
  const dlg=X.dlg();if(!dlg)return;
  if(dlg.open&&dlg.querySelector('form')&&!await confirmLeave())return;
  dlg.close();
  const entries=[{label:'Reports',url:'#/reports'},{label:'Workspace settings',url:'#/settings'},{label:'My account',url:'#/account'}];
  const panel=(C.openPanel||C.openDrawer)(dlg,{presentation:'sheet',title:'More',body:`<div class="navigation-sheet">${entries.map((item,index)=>C.button({label:item.label,variant:'ghost',attrs:{'data-navigation':index}})).join('')}${C.button({label:'Search anywhere',variant:'ghost',attrs:{'data-open-search':true}})}</div>`});
  dlg.querySelectorAll('[data-navigation]').forEach(button=>{button.onclick=()=>{panel.close();location.hash=entries[Number(button.dataset.navigation)].url;};});
  dlg.querySelector('[data-open-search]').onclick=()=>{panel.close();openCommandPalette(X);};
}
