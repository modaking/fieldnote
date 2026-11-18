// Reusable SVG views of already scoped/aggregated data. No queries or accounting
// calculations belong here. Missing values stay missing (including line gaps).
import * as C from './components.js';
const esc = C.escapeHTML;
const TYPES = { bars:'grouped-bar', bar:'grouped-bar', horizontal:'horizontal-bar', calendar:'heatmap', 'calendar-heatmap':'heatmap', 'line-area':'area', sparklines:'sparkline' };
const safeId = (v) => String(v || 'chart').replace(/[^a-zA-Z0-9_-]/g, '-');
const numeric = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => Number(v.toFixed(3));
const shorten = (v, n = 20) => { const s=String(v ?? ''); return s.length>n ? `${s.slice(0,n-1)}…` : s; };
const defaultFormat = (v) => new Intl.NumberFormat('en-KE',{maximumFractionDigits:2}).format(v);
let sequence = 0;

function options(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [], valueKey = input.valueKey || 'value';
  const series = (input.series?.length ? input.series : [{key:valueKey,label:input.valueLabel || 'Value'}])
    .filter((s,i,all)=>s && typeof s.key==='string' && all.findIndex(x=>x.key===s.key)===i)
    .map((s,i)=>({...s,index:i,label:s.label || s.key}));
  return {...input,rows,series,valueKey,xKey:input.xKey || 'label',type:TYPES[input.type] || input.type || 'grouped-bar',
    id:safeId(input.id),width:Math.max(300,Math.min(1400,Number(input.width)||720)),format:input.format || defaultFormat};
}
const display = (o,v,key,kind='format') => { if(!numeric(v))return 'Unavailable';try{return String((o[kind]||o.format)(v,key));}catch{return defaultFormat(v);} };
const visibleSeries = (o) => o.series.filter(s=>!o.hiddenSeries?.includes(s.key));
const color = (index) => `var(--chart-${index%5+1})`;
const text = (x,y,value,attrs='') => `<text x="${round(x)}" y="${round(y)}" ${attrs}>${esc(value)}</text>`;
function definitions(o) {
  return `<defs>${o.series.map(s=>`<pattern id="${o.id}-pattern-${s.index}" patternUnits="userSpaceOnUse" width="${6+s.index%3*2}" height="${6+s.index%3*2}" patternTransform="rotate(${s.index%2?45:-45})"><path d="M 0 0 V 10" stroke="var(--surface)" stroke-width="${s.index%2?2:1}" opacity=".35"/></pattern>`).join('')}</defs>`;
}
function mark(o,{row,index,key,value,shape}) {
  const label=`${row[o.xKey] ?? index+1} · ${o.series.find(s=>s.key===key)?.label || key}: ${display(o,value,key,'tooltipFormat')}`;
  return `<g class="chart-point" tabindex="-1" role="button" data-chart-point="${index}" data-series="${esc(key)}" aria-label="${esc(label)}"><title>${esc(label)}</title>${shape}</g>`;
}
function ticks(min,max,count=4) {
  if(min===max){if(min===0)max=1;else if(min>0)min=0;else max=0;}
  const raw=(max-min)/count, power=10**Math.floor(Math.log10(raw)), fraction=raw/power;
  const step=(fraction<=1?1:fraction<=2?2:fraction<=5?5:10)*power;
  const lo=Math.floor(min/step)*step, hi=Math.ceil(max/step)*step;
  return Array.from({length:Math.min(12,Math.round((hi-lo)/step)+1)},(_,i)=>Number((lo+i*step).toPrecision(14)));
}
function cartesian(o,series) {
  const spark=o.type==='sparkline', W=o.width, H=spark?130:310;
  const values=o.rows.flatMap(r=>series.map(s=>r[s.key])).filter(numeric);
  const t=ticks(Math.min(0,...values),Math.max(0,...values)), lo=t[0], hi=t.at(-1);
  const left=spark?12:Math.min(124,Math.max(58,...t.map(v=>display(o,v,series[0]?.key).length*6.5+12))), right=spark?14:34;
  const top=24, bottom=spark?28:58, pw=W-left-right, ph=H-top-bottom;
  const y=v=>top+(hi-v)/(hi-lo)*ph, step=pw/Math.max(o.rows.length,1), x=i=>left+step*(i+.5), zero=y(0);
  let out=spark?'':t.map(v=>`<path class="chart-grid" d="M${left} ${round(y(v))}H${W-right}"/>${text(left-10,y(v)+4,display(o,v,series[0]?.key),'text-anchor="end" class="chart-axis"')}`).join('');
  if(!spark)out+=text(left,12,o.unit || '','class="chart-axis chart-unit"');
  const bars=series.filter(s=>o.type==='grouped-bar'&&s.kind!=='line'), barW=Math.max(1,Math.min(46,(step*.72)/Math.max(bars.length,1)));
  for(const s of series){
    const isBar=bars.includes(s), stroke=color(s.index);
    if(isBar){
      out+=o.rows.map((r,i)=>{
        const v=r[s.key];if(!numeric(v))return '';
        const bx=x(i)-bars.length*barW/2+bars.indexOf(s)*barW, by=Math.min(zero,y(v)), bh=Math.max(1,Math.abs(zero-y(v)));
        return mark(o,{row:r,index:i,key:s.key,value:v,shape:`<rect class="chart-hit" x="${round(bx)}" y="${round(by)}" width="${round(Math.max(1,barW-2))}" height="${round(bh)}" rx="3" fill="${stroke}"/><rect x="${round(bx)}" y="${round(by)}" width="${round(Math.max(1,barW-2))}" height="${round(bh)}" rx="3" fill="url(#${o.id}-pattern-${s.index})" pointer-events="none"/>`})+(o.rows.length<=5?text(bx+barW/2,v<0?by+bh+16:by-7,shorten(display(o,v,s.key),16),'text-anchor="middle" class="chart-value"'):'');
      }).join('');
    }else{
      // Separate segments prevent absent periods becoming a fabricated trend.
      const segments=[];let segment=[];
      o.rows.forEach((r,i)=>{if(numeric(r[s.key]))segment.push([x(i),y(r[s.key])]);else if(segment.length){segments.push(segment);segment=[];}});if(segment.length)segments.push(segment);
      for(const points of segments){
        const d=points.map(([px,py],i)=>`${i?'L':'M'}${round(px)} ${round(py)}`).join(' ');
        if(o.type==='area')out+=`<path d="${d} L${round(points.at(-1)[0])} ${round(zero)} L${round(points[0][0])} ${round(zero)}Z" fill="${stroke}" opacity=".12"/>`;
        out+=`<path class="chart-line" d="${d}" fill="none" stroke="${stroke}" stroke-width="2.5"${s.index%3?` stroke-dasharray="${s.index%3===1?'7 4':'2 4'}"`:''}/>`;
      }
      out+=o.rows.map((r,i)=>numeric(r[s.key])?mark(o,{row:r,index:i,key:s.key,value:r[s.key],shape:`<circle class="chart-hit" cx="${round(x(i))}" cy="${round(y(r[s.key]))}" r="8" fill="var(--surface)" stroke="${stroke}" stroke-width="2.5"/><circle cx="${round(x(i))}" cy="${round(y(r[s.key]))}" r="2.5" fill="${stroke}" pointer-events="none"/>`}):'').join('');
      const last=o.rows.findLastIndex(r=>numeric(r[s.key]));
      if(last>=0)out+=text(x(last),Math.max(14,y(o.rows[last][s.key])-13),shorten(display(o,o.rows[last][s.key],s.key),20),'text-anchor="middle" class="chart-value"');
    }
  }
  const stride=Math.max(1,Math.ceil(o.rows.length/Math.max(2,Math.floor(pw/80))));
  out+=o.rows.map((r,i)=>(i%stride===0||i===o.rows.length-1)?text(x(i),H-(spark?9:33),shorten(r[o.xKey],Math.max(5,Math.floor(step*stride/7))),'text-anchor="middle" class="chart-axis"'):'').join('');
  if(!spark)out+=`<path class="chart-zero" d="M${left} ${round(zero)}H${W-right}"/>`;
  return {body:out,height:H};
}
function horizontal(o,series,progress=false) {
  const s=series[0], W=o.width, H=Math.max(140,o.rows.length*64+30), left=Math.min(156,Math.max(70,W*.24)), right=36, pw=W-left-right;
  const vals=o.rows.map(r=>r[s.key]).filter(numeric), t=ticks(Math.min(0,...vals),Math.max(0,...vals)), lo=t[0], hi=t.at(-1);
  const x=v=>left+(v-lo)/(hi-lo)*pw;
  let out='';
  o.rows.forEach((r,i)=>{
    const y=20+i*64,v=r[s.key], target=numeric(r[o.targetKey||'target'])?r[o.targetKey||'target']:(o.max??100);
    out+=text(left-12,y+22,shorten(r[o.xKey],Math.floor(left/7)-2),'text-anchor="end" class="chart-axis"');
    if(!numeric(v)||progress&&(v<0||!numeric(target)||target<=0)){out+=text(left,y+22,'Unavailable','class="chart-axis"');return;}
    const width=progress?Math.min(1,v/target)*pw:Math.abs(x(v)-x(0)), bx=progress?left:Math.min(x(v),x(0));
    if(progress)out+=`<rect x="${left}" y="${y+7}" width="${pw}" height="18" rx="9" fill="var(--surface-2)"/>`;
    out+=mark(o,{row:r,index:i,key:s.key,value:v,shape:`<rect class="chart-hit" x="${round(bx)}" y="${y+7}" width="${round(Math.max(1,width))}" height="18" rx="${progress?9:3}" fill="${color(i)}"/><rect x="${round(bx)}" y="${y+7}" width="${round(Math.max(1,width))}" height="18" rx="${progress?9:3}" fill="url(#${o.id}-pattern-${s.index})" pointer-events="none"/>`});
    out+=text(left,y+45,progress?`${display(o,v,s.key)} / ${display(o,target,s.key)} · ${defaultFormat(numeric(r.pct)?r.pct:v/target*100)}%`:display(o,v,s.key),'class="chart-value"');
  });
  return {body:out,height:H};
}
function donut(o,series) {
  const s=series[0], W=o.width,H=310,cx=W/2,cy=142,r=91,stroke=30;
  const positive=o.rows.map((row,index)=>({row,index,value:row[s.key]})).filter(p=>numeric(p.value)&&p.value>0);
  // This sum only determines arc angles; accounting totals come from the server.
  const total=positive.reduce((v,p)=>v+p.value,0), circumference=2*Math.PI*r;
  if(!Number.isFinite(total)||total<=0)return {body:text(cx,cy,'No positive values','text-anchor="middle" class="chart-axis"'),height:H};
  let offset=0;
  let out=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>`;
  positive.forEach(({row,index,value},i)=>{
    const length=value/total*circumference, a=(offset+length/2)/circumference*2*Math.PI-Math.PI/2;
    const shape=`<circle class="chart-hit" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color(index)}" stroke-width="${stroke}" stroke-dasharray="${round(Math.max(0,length-2))} ${round(circumference)}" stroke-dashoffset="${round(-offset)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    out+=mark(o,{row,index,key:s.key,value,shape});
    if(positive.length<=8){const labelR=r+stroke/2+18,lx=cx+Math.cos(a)*labelR,ly=cy+Math.sin(a)*labelR;out+=text(lx,ly+4,`${index+1} · ${defaultFormat(value/total*100)}%`,'text-anchor="middle" class="chart-value"');}
    offset+=length;
  });
  out+=text(cx,cy-4,'Share of recorded values','text-anchor="middle" class="chart-axis"')+text(cx,cy+20,`${positive.length} ${positive.length===1?'category':'categories'}`,'text-anchor="middle" class="chart-value"');
  out+=text(cx,H-12,'Zero and negative values remain in the data table.','text-anchor="middle" class="chart-axis"');
  return {body:out,height:H};
}
function isoDay(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(`${value}T12:00:00Z`);return Number.isFinite(+date)&&date.toISOString().slice(0,10)===value?date:null;
}
function heatmap(o,series) {
  const s=series[0], entries=o.rows.map((row,index)=>({row,index,date:isoDay(row[o.xKey])})).filter(p=>p.date);
  if(!entries.length)return {body:text(20,40,'No valid calendar dates','class="chart-axis"'),height:120};
  entries.sort((a,b)=>a.date-b.date);
  const start=new Date(entries[0].date), end=entries.at(-1).date;start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
  const days=Math.floor((end-start)/86400000)+1,weeks=Math.ceil(days/7),cell=Math.max(7,Math.min(24,(o.width-45)/weeks)),left=35,top=28;
  const max=Math.max(1,...entries.map(p=>p.row[s.key]).filter(numeric)), byDay=new Map(entries.map(p=>[p.row[o.xKey],p]));
  let out=['M','T','W','T','F','S','S'].map((day,i)=>text(18,top+i*cell+cell*.7,day,'text-anchor="middle" class="chart-axis"')).join('');
  const limit=Math.min(3660,weeks*7);
  for(let i=0;i<limit;i++){
    const d=new Date(+start+i*86400000),key=d.toISOString().slice(0,10),entry=byDay.get(key),x=left+Math.floor(i/7)*cell,y=top+i%7*cell;
    const value=entry?.row[s.key], intensity=numeric(value)?Math.max(0,Math.min(1,value/max)):null;
    const shape=`<rect class="chart-hit" x="${round(x)}" y="${round(y)}" width="${round(cell-2)}" height="${round(cell-2)}" rx="2" fill="${intensity===null?'var(--surface-2)':color(0)}"${intensity!==null?` fill-opacity="${round(.2+intensity*.8)}"`:''}/>`;
    out+=entry&&numeric(value)?mark(o,{row:entry.row,index:entry.index,key:s.key,value,shape}):`<g><title>${key}: No record</title>${shape}</g>`;
    if(i%7===0&&d.getUTCDate()<=7)out+=text(x,16,d.toLocaleDateString('en-KE',{month:'short',timeZone:'UTC'}),'class="chart-axis"');
  }
  const H=top+cell*7+35;
  out+=text(left,H-5,`${entries[0].row[o.xKey]} – ${entries.at(-1).row[o.xKey]} · lighter = less · blank = no record`,'class="chart-axis"');
  return {body:out,height:H,width:Math.max(o.width,left+weeks*cell+8)};
}

export function chartSVG(input) {
  const o=options(input),series=visibleSeries(o);
  if(!series.length||!o.rows.length)return '';
  let result;
  if(o.type==='donut')result=donut(o,series);
  else if(o.type==='horizontal-bar'||o.type==='progress')result=horizontal(o,series,o.type==='progress');
  else if(o.type==='heatmap')result=heatmap(o,series);
  else result=cartesian(o,series);
  const help='Use Tab to enter the chart, arrow keys to move between values, and Enter to view records. The data table contains every supplied value.';
  return `<svg class="chart-svg" xmlns="http://www.w3.org/2000/svg" width="${round(result.width||o.width)}" height="${round(result.height)}" viewBox="0 0 ${round(result.width||o.width)} ${round(result.height)}" role="group" aria-labelledby="${o.id}-svg-title ${o.id}-svg-desc"><title id="${o.id}-svg-title">${esc(o.title || 'Chart')}</title><desc id="${o.id}-svg-desc">${esc([o.description,o.unit,help].filter(Boolean).join(' '))}</desc>${definitions(o)}${result.body}</svg>`;
}

export function chartCSV(input) {
  const o=options(input),series=visibleSeries(o);
  const formatted=typeof input?.tableFormat==='function'||typeof input?.format==='function';
  const header=[o.xLabel || o.xKey,...series.flatMap(s=>formatted?[`${s.label} (${o.rawUnit || 'raw supplied units'})`,`${s.label}${o.unit?` (${o.unit})`:''}`]:[`${s.label}${o.rawUnit||o.unit?` (${o.rawUnit||o.unit})`:''}`])];
  // Numeric cells remain numeric supplied units; labels cannot become formulas.
  const cell=C.csvCell;
  return '\uFEFF'+[header.map(cell).join(','),...o.rows.map(row=>[cell(row[o.xKey]),...series.flatMap(s=>{const raw=numeric(row[s.key])?cell(row[s.key]):cell('Unavailable');return formatted?[raw,cell(display(o,row[s.key],s.key,'tableFormat'))]:[raw];})].join(','))].join('\r\n');
}
function tableHTML(o) {
  const series=visibleSeries(o);
  return `<div class="chart-data-scroller">${C.dataTable({caption:`${o.title} — chart data${o.unit?` (${o.unit})`:''}`,rows:o.rows,rowKey:o.xKey,columns:[{key:o.xKey,label:o.xLabel||o.xKey},...series.map(s=>({key:s.key,label:s.label,numeric:true,render:row=>esc(display(o,row[s.key],s.key,'tableFormat'))}))]})}</div>`;
}
function download(blob,name) {
  const link=document.createElement('a'), url=URL.createObjectURL(blob);link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
// Inline computed colours/geometry so a downloaded SVG/PNG has no CSS/font URLs.
function selfContainedSVG(svg,background,o) {
  const clone=svg.cloneNode(true),source=[svg,...svg.querySelectorAll('*')],targets=[clone,...clone.querySelectorAll('*')];
  const props=['fill','fill-opacity','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','opacity','font-size','font-weight','text-anchor','dominant-baseline','visibility'];
  source.forEach((node,i)=>{
    const style=getComputedStyle(node), target=targets[i];
    if(!target||node.tagName?.toLowerCase()==='title'||node.tagName?.toLowerCase()==='desc')return;
    props.forEach(key=>{const value=style.getPropertyValue(key).replace(/url\(["']?[^)]*#([\w-]+)["']?\)/g,'url(#$1)');if(value)target.setAttribute(key,value);});
    if(node.tagName?.toLowerCase()==='text')target.setAttribute('font-family','system-ui, -apple-system, Segoe UI, sans-serif');
    target.removeAttribute('class');target.removeAttribute('tabindex');
  });
  const element=(name,attrs={},content)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',name);for(const[key,value]of Object.entries(attrs))node.setAttribute(key,String(value));if(content!=null)node.textContent=String(content);return node;};
  const W=svg.viewBox.baseVal.width,H=svg.viewBox.baseVal.height,style=getComputedStyle(svg),series=visibleSeries(o),columns=W<460?1:2;
  const headingHeight=(o.description?66:48)+Math.ceil(series.length/columns)*22;
  const categories=o.type==='donut'?o.rows:[],footerHeight=categories.length?Math.ceil(categories.length/columns)*22+16:0;
  const group=element('g',{transform:`translate(0 ${headingHeight})`});while(clone.firstChild)group.append(clone.firstChild);clone.append(group);
  const exportText=(x,y,value,size=12,weight=400)=>element('text',{x,y,fill:style.getPropertyValue('--text').trim(), 'font-family':'system-ui, -apple-system, Segoe UI, sans-serif','font-size':size,'font-weight':weight},value);
  clone.append(exportText(18,27,shorten(o.title || 'Chart',Math.floor((W-36)/9)),17,600));
  if(o.description)clone.append(exportText(18,47,shorten(o.description,Math.floor((W-36)/6.5)),11));
  series.forEach((s,i)=>{const x=18+i%columns*(W/columns),y=(o.description?66:48)+Math.floor(i/columns)*22;clone.append(element('rect',{x,y:y-9,width:12,height:10,rx:2,fill:style.getPropertyValue(`--chart-${s.index%5+1}`).trim()}),exportText(x+19,y,shorten(s.label,Math.floor((W/columns-48)/7)),11));});
  categories.forEach((row,i)=>{const x=18+i%columns*(W/columns),y=headingHeight+H+18+Math.floor(i/columns)*22;clone.append(exportText(x,y,shorten(`${i+1}. ${row[o.xKey]}`,Math.floor((W/columns-30)/7)),11));});
  const rect=element('rect',{width:'100%',height:'100%',fill:background});clone.insertBefore(rect,clone.firstChild);
  clone.setAttribute('viewBox',`0 0 ${W} ${H+headingHeight+footerHeight}`);clone.setAttribute('width',String(W));clone.setAttribute('height',String(H+headingHeight+footerHeight));
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

export function renderChartCard(el,input={}) {
  let config={...input,id:input.id || `chart-${++sequence}`},hidden=new Set(),table=false,destroyed=false,active=null,observer;
  let width=el.clientWidth || 720;
  const resolved=()=>options({...config,width:Math.max(300,width-40),hiddenSeries:[...hidden]});
  const dataFor=(node)=>{const o=resolved(),index=Number(node.dataset.chartPoint),row=o.rows[index],seriesKey=node.dataset.series;return row?{row,index,seriesKey,value:row[seriesKey]}:null;};
  const setTooltip=(point)=>{
    const host=el.querySelector('[data-chart-tooltip]');if(!host)return;
    active=point?dataFor(point):null;
    if(!active){host.hidden=true;return;}
    const o=resolved();host.hidden=false;
    host.querySelector('[data-chart-tooltip-text]').textContent=`${active.row[o.xKey]} · ${o.series.find(s=>s.key===active.seriesKey)?.label}: ${display(o,active.value,active.seriesKey,'tooltipFormat')}`;
    const b=host.querySelector('[data-chart-drill]');if(b)b.hidden=!config.onDrill;
  };
  const draw=()=>{
    if(destroyed)return;
    const o=resolved(),selected=visibleSeries(o),values=o.rows.flatMap(row=>selected.map(s=>row[s.key])),hasValues=values.some(numeric);
    const available=hasValues&&selected.length>0;
    const controls=C.button({label:table?'View chart':'View data table',variant:'ghost',size:'sm',attrs:{'data-chart-table':true,'aria-pressed':String(table),'aria-controls':`${o.id}-body`,disabled:config.loading || !o.rows.length}})+
      C.actionMenu({label:`More actions for ${o.title || 'chart'}`,text:'More actions',className:'chart-download',items:[{label:'Download PNG',attrs:{'data-chart-png':true,disabled:!available || table || config.loading}},{label:'Download CSV',attrs:{'data-chart-csv':true,disabled:!o.rows.length || config.loading}}]});
    const legend=o.series.map(s=>C.button({label:s.label,variant:'ghost',size:'sm',icon:`<span class="chart-key" aria-hidden="true" style="--chart-series:${color(s.index)};--chart-dash:${s.index%2?'dashed':'solid'}"></span>`,attrs:{'data-chart-legend':s.key,'aria-pressed':String(!hidden.has(s.key))}})).join('');
    const categoryKey=['donut','horizontal-bar','progress'].includes(o.type)&&o.rows.length<=12?`<ol class="chart-category-key">${o.rows.map((r,i)=>`<li><span class="chart-key" style="--chart-series:${color(i)}" aria-hidden="true"></span><span>${esc(r[o.xKey])}</span></li>`).join('')}</ol>`:'';
    let body;
    if(config.loading)body=C.skeletonRows({rows:4,columns:3});
    else if(config.error)body=C.notice({title:'Chart couldn’t load',text:config.error,tone:'negative',action:config.onRetry?C.button({label:'Try again',variant:'secondary',attrs:{'data-chart-retry':true}}):''});
    else if(!selected.length)body=C.emptyState({title:'All series hidden',text:'Choose a legend item to display its values.',action:C.button({label:'Show all series',variant:'secondary',attrs:{'data-chart-reset':true}})});
    else if(!hasValues)body=C.emptyState({title:config.emptyTitle || 'No data for this period',text:config.emptyText || 'Recorded values will appear here. Try another period or add a record.',action:config.emptyAction?C.button({label:config.emptyAction.label,variant:'secondary',attrs:{'data-chart-empty':true}}):''});
    else body=table?tableHTML(o):`<div class="chart-canvas">${chartSVG(o)}</div>${categoryKey}`;
    el.innerHTML=`<section class="chart-card" aria-labelledby="${o.id}-title"><header class="chart-card-head"><div><h2 id="${o.id}-title">${esc(o.title || 'Chart')}</h2>${o.description?`<p>${esc(o.description)}</p>`:''}</div><div class="chart-card-actions">${controls}</div></header>${!config.loading&&o.series.length?`<div class="chart-legend" aria-label="Visible chart series">${legend}</div>`:''}<div id="${o.id}-body" class="chart-body" aria-busy="${Boolean(config.loading)}">${body}</div><p class="chart-keyboard-hint">${available&&!table?'Use arrow keys to explore values. View the data table for exact figures.':''}</p><div class="chart-tooltip" data-chart-tooltip hidden role="status"><span data-chart-tooltip-text></span>${C.button({label:'View records',variant:'secondary',size:'sm',attrs:{'data-chart-drill':true,hidden:!config.onDrill}})}</div><div class="chart-status ui-sr-only" aria-live="polite" data-chart-status></div></section>`;
    const points=[...el.querySelectorAll('[data-chart-point]')];if(points[0])points[0].setAttribute('tabindex','0');
    active=null;
  };
  const click=async(event)=>{
    const control=event.target.closest?.('button,[data-chart-point]');if(!control||!el.contains(control)||control.disabled)return;
    if(control.hasAttribute('data-chart-legend')){
      const key=control.dataset.chartLegend;hidden.has(key)?hidden.delete(key):hidden.add(key);draw();
      [...el.querySelectorAll('[data-chart-legend]')].find(b=>b.dataset.chartLegend===key)?.focus();
      config.onFilter?.({seriesKeys:visibleSeries(resolved()).map(s=>s.key)});
    }else if(control.hasAttribute('data-chart-table')){table=!table;draw();el.querySelector('[data-chart-table]')?.focus();}
    else if(control.hasAttribute('data-chart-reset')){hidden.clear();draw();config.onFilter?.({seriesKeys:resolved().series.map(s=>s.key)});}
    else if(control.hasAttribute('data-chart-empty'))config.emptyAction?.onClick?.();
    else if(control.hasAttribute('data-chart-retry'))config.onRetry?.();
    else if(control.hasAttribute('data-chart-point'))setTooltip(control);
    else if(control.hasAttribute('data-chart-drill')&&active)config.onDrill?.(active);
    else if(control.hasAttribute('data-chart-csv'))download(new Blob([chartCSV(resolved())],{type:'text/csv;charset=utf-8'}),`${safeId(config.id)}.csv`);
    else if(control.hasAttribute('data-chart-png')){
      control.disabled=true;
      try{await png();}catch(error){C.toast(error.message || 'The chart image could not be downloaded.',{tone:'negative'});}finally{if(control.isConnected)control.disabled=false;}
    }
  };
  const focus=(event)=>{const point=event.target.closest?.('[data-chart-point]');if(point&&el.contains(point))setTooltip(point);};
  const leave=()=>{if(!el.contains(document.activeElement))setTooltip(null);};
  const keydown=(event)=>{
    if(event.key==='Escape'){setTooltip(null);return;}
    const point=event.target.closest?.('[data-chart-point]');if(!point)return;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setTooltip(point);if(config.onDrill)config.onDrill(dataFor(point));return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    const points=[...el.querySelectorAll('[data-chart-point]')],i=points.indexOf(point),next=event.key==='Home'?0:event.key==='End'?points.length-1:(i+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+points.length)%points.length;
    event.preventDefault();points.forEach(p=>p.setAttribute('tabindex','-1'));points[next].setAttribute('tabindex','0');points[next].focus();setTooltip(points[next]);
  };
  async function png(){
    const svg=el.querySelector('svg');if(!svg)throw new Error('Switch to the chart view before downloading an image.');
    const background=getComputedStyle(el).getPropertyValue('--surface').trim(),markup=selfContainedSVG(svg,background,resolved()),blob=new Blob([markup],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob);
    try{
      const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('This browser could not create the chart image.'));image.src=url;});
      const canvas=document.createElement('canvas'),box=svg.viewBox.baseVal;canvas.width=Math.ceil((image.naturalWidth||box.width)*2);canvas.height=Math.ceil((image.naturalHeight||box.height)*2);
      const context=canvas.getContext('2d');if(!context)throw new Error('Image download is unavailable in this browser.');
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const output=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!output)throw new Error('Image download is unavailable in this browser.');download(output,`${safeId(config.id)}.png`);
    }finally{URL.revokeObjectURL(url);}
  }
  el.addEventListener('click',click);el.addEventListener('pointerover',focus);el.addEventListener('focusin',focus);el.addEventListener('pointerleave',leave);el.addEventListener('keydown',keydown);
  draw();
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(entries=>{const next=Math.round(entries[0]?.contentRect.width || el.clientWidth);if(next>0&&Math.abs(next-width)>4){width=next;draw();}});observer.observe(el);}
  return {update(patch){config={...config,...patch};const keys=new Set(options(config).series.map(s=>s.key));hidden=new Set([...hidden].filter(key=>keys.has(key)));draw();},
    destroy(){destroyed=true;observer?.disconnect();el.removeEventListener('click',click);el.removeEventListener('pointerover',focus);el.removeEventListener('focusin',focus);el.removeEventListener('pointerleave',leave);el.removeEventListener('keydown',keydown);el.replaceChildren();},
    toSVG(){const svg=el.querySelector('svg');return svg?selfContainedSVG(svg,getComputedStyle(el).getPropertyValue('--surface').trim(),resolved()):chartSVG(resolved());},toCSV:()=>chartCSV(resolved()),downloadPNG:png};
}
