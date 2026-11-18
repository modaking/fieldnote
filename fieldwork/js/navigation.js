// One navigation registry. Legacy URLs remain aliases for the same feature.
export const SECTIONS=Object.freeze([
  {id:'tasks',page:'operations',module:'daily',label:'Tasks',primary:true},
  {id:'records',page:'operations',module:'livestock',label:'Livestock & crops',primary:true},
  {id:'infrastructure',page:'operations',module:'infrastructure',label:'Infrastructure',primary:true},
  {id:'checklists',page:'operations',module:'daily',label:'Checklists'},
  {id:'enterprises',page:'operations',module:'livestock',label:'Enterprises'},
  {id:'transactions',page:'finances',module:'finances',label:'Transactions',primary:true},
  {id:'budgets',page:'finances',module:'finances',label:'Budgets',primary:true},
  {id:'vendors',page:'finances',module:'vendors',label:'Vendors',primary:true},
  {id:'funding',page:'finances',module:'funding',label:'Funding',primary:true},
  {id:'recurring',page:'finances',module:'finances',label:'Recurring payments'},
  {id:'categories',page:'finances',module:'finances',label:'Categories'},
  {id:'bills',page:'finances',module:'vendors',label:'Bills & balances',upgrade:true},
  {id:'merchants',page:'finances',module:'vendors',label:'Seed merchants'},
  {id:'workers',page:'people',module:'workers',label:'Workers',primary:true},
  {id:'members',page:'people',module:'members',label:'Members',primary:true},
  {id:'invitations',page:'people',module:'members',label:'Invitations'},
]);
export const PAGES=Object.freeze([
  {id:'overview',label:'Overview',icon:'overview'},
  {id:'operations',label:'Operations',icon:'daily'},
  {id:'finances',label:'Finances',icon:'finances'},
  {id:'people',label:'People',icon:'workers'},
  {id:'reports',label:'Reports',icon:'reports'},
]);
export function sectionURL(id,filters={}){
  const section=SECTIONS.find(item=>item.id===id);if(!section)return '#/overview';
  const params=new URLSearchParams({section:id});for(const[key,value]of Object.entries(filters))if(value!=null&&value!=='')params.set(key,String(value));
  return `#/${section.page}?${params}`;
}
export function resolveNavigation(hash=''){
  const [path,query='']=hash.replace(/^#\/?/,'').split('?'),params=new URLSearchParams(query);let section=params.get('section');
  if(['overview','reports','settings','account'].includes(path))return {page:path,module:path,section:null,params};
  if(['operations','finances','people'].includes(path)&&section&&SECTIONS.some(item=>item.id===section&&item.page===path)){
    const item=SECTIONS.find(item=>item.id===section);return{page:path,module:item.module,section:item.id,params};
  }
  const tab=(params.get('tab')||'').toLowerCase();
  const legacy={daily:tab==='checklists'?'checklists':'tasks',livestock:tab==='records'||params.get('add')==='1'?'records':'enterprises',infrastructure:'infrastructure',
    vendors:tab==='bills'||tab.includes('balance')?'bills':tab.includes('merchant')?'merchants':'vendors',funding:'funding',workers:'workers',members:tab==='invites'||tab==='invitations'?'invitations':'members',
    finances:tab==='budget'||tab==='budgets'||tab.includes('actual')?'budgets':tab==='recurring'?'recurring':tab==='categories'?'categories':'transactions',operations:'tasks',people:'workers'};
  section=legacy[path];const item=SECTIONS.find(entry=>entry.id===section);
  return item?{page:item.page,module:item.module,section:item.id,params}:{page:'overview',module:'overview',section:null,params};
}
export function navigationItems(canRead,upgraded=true){
  return PAGES.filter(page=>['overview','reports'].includes(page.id)||SECTIONS.some(section=>section.page===page.id&&canRead(section.module)&&(!section.upgrade||upgraded)));
}
export function availableSections(page,canRead,upgraded=true){return SECTIONS.filter(item=>item.page===page&&canRead(item.module)&&(!item.upgrade||upgraded));}
const recentKey=(uid,workspace)=>`fw-recent:${uid}:${workspace}`;
export function rememberRecent(uid,workspace,item,storage=globalThis.sessionStorage){
  if(!uid||!workspace||!SECTIONS.some(section=>section.id===item.section))return;
  try{const prior=JSON.parse(storage.getItem(recentKey(uid,workspace))||'[]');const rows=Array.isArray(prior)?prior:[];storage.setItem(recentKey(uid,workspace),JSON.stringify([{section:item.section,id:String(item.id),farm:item.farm||'all',label:String(item.label||'Record').slice(0,100)},...rows.filter(row=>row.id!==String(item.id)||row.section!==item.section)].slice(0,8)));}catch{}
}
export function recentItems(uid,workspace,storage=globalThis.sessionStorage){try{const rows=JSON.parse(storage.getItem(recentKey(uid,workspace))||'[]');return Array.isArray(rows)?rows.filter(row=>SECTIONS.some(section=>section.id===row.section)):[];}catch{return[];}}
