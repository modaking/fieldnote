import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG, chartCSV, renderChartCard } from '../js/charts.js';

const sample={id:'monthly',title:'Income and expenses',unit:'KES',xKey:'month',type:'grouped-bar',rows:[{month:'Aug',income:20000,expenses:12000,net:8000},{month:'Sep',income:0,expenses:5000,net:-5000}],series:[{key:'income',label:'Income'},{key:'expenses',label:'Expenses'},{key:'net',label:'Net',kind:'line'}]};

// DOM boundary for the actual card/controller handlers. It parses the emitted
// markup, rather than replacing the chart calculations or interaction code.
class Node {
  constructor(tag='div',attrs={}){this.tagName=tag;this.attrs={...attrs};this.nodes=[];this.listeners={};this.dataset={};this.hidden='hidden' in attrs;this.disabled='disabled' in attrs;this.isConnected=true;this.clientWidth=600;for(const [key,v] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
  set innerHTML(value){this.html=value;this.nodes=[];for(const m of value.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){const attrs=Object.fromEntries([...m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(a=>[a[1],a[2]??'']));const child=new Node(m[1],attrs);child.owner=this;this.nodes.push(child);}}
  get innerHTML(){return this.html || '';}
  hasAttribute(k){return k in this.attrs;}setAttribute(k,v){this.attrs[k]=String(v);}removeAttribute(k){delete this.attrs[k];}
  matches(selector){if(selector==='*')return true;if(selector.startsWith('['))return this.hasAttribute(selector.slice(1,-1));return this.tagName===selector;}
  querySelectorAll(selector){const source=this.owner?.nodes || this.nodes;return source.filter(n=>n.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0] || null;}
  closest(selector){return selector.split(',').some(s=>this.matches(s))?this:null;}
  contains(node){return node===this||this.nodes.includes(node);}
  addEventListener(k,fn){this.listeners[k]=fn;}removeEventListener(k){delete this.listeners[k];}
  focus(){globalThis.document.activeElement=this;}
  replaceChildren(){this.nodes=[];this.html='';}
}
function host(){const el=new Node();globalThis.document={activeElement:null};return el;}
const click=(el,node)=>el.listeners.click({target:node});

test('grouped bars preserve zero and negative net values with a separate line overlay',()=>{
  const svg=chartSVG(sample);
  assert.equal((svg.match(/data-chart-point=/g)||[]).length,6);
  assert.match(svg,/Sep · Income: 0/);assert.match(svg,/Sep · Net: -5,000/);
  assert.match(svg,/class="chart-line"/);assert.match(svg,/patternUnits="userSpaceOnUse"/);
  assert.doesNotMatch(svg,/NaN|Infinity/);
  assert.match(svg,/role="group" aria-labelledby="monthly-svg-title monthly-svg-desc"/);
});

test('missing line values form gaps and are not coerced into a zero observation',()=>{
  const svg=chartSVG({type:'line',rows:[{label:'A',value:5},{label:'B',value:null},{label:'C',value:8},{label:'D',value:NaN}]});
  assert.equal((svg.match(/class="chart-line"/g)||[]).length,2);
  assert.equal((svg.match(/data-chart-point=/g)||[]).length,2);
  assert.doesNotMatch(svg,/B · Value: 0|NaN|Infinity/);
});

test('small fractional measurements keep finite coordinates rather than collapsing their axis',()=>{
  const svg=chartSVG({type:'line',rows:[{label:'A',value:.00001},{label:'B',value:.00002}],format:String});
  assert.doesNotMatch(svg,/NaN|Infinity/);assert.match(svg,/0.00001/);assert.match(svg,/0.00002/);
});

test('chart text and IDs cannot inject markup, attributes or download formulas',()=>{
  const input={id:'x" onload="bad',title:'<img src=x onerror=bad>',rows:[{label:'=HYPERLINK("bad")',value:1}],series:[{key:'value',label:'<script>bad</script>'}]};
  const svg=chartSVG(input);assert.doesNotMatch(svg,/<img|<script|onload="bad/);assert.match(svg,/&lt;img/);
  const csv=chartCSV(input);assert.match(csv,/'=HYPERLINK/);assert.match(csv,/""bad""/);
});

test('every requested chart family has a finite SVG and labelled observations',()=>{
  for(const type of ['grouped-bar','line','area','donut','horizontal-bar','progress','sparkline','heatmap']){
    const svg=chartSVG({type,xKey:'date',rows:[{date:'2026-11-17',value:10,target:20},{date:'2026-11-18',value:0,target:20}]});
    assert.match(svg,/<svg/);assert.match(svg,/2026-11-17 · Value: 10/);assert.doesNotMatch(svg,/NaN|Infinity/);
  }
});

test('calendar charts preserve missing days and reject impossible ISO dates',()=>{
  const svg=chartSVG({type:'heatmap',xKey:'date',rows:[{date:'2026-11-17',value:0},{date:'2026-11-19',value:3},{date:'2026-02-31',value:50}]});
  assert.match(svg,/2026-11-18: No record/);assert.match(svg,/2026-11-17 · Value: 0/);assert.doesNotMatch(svg,/2026-02-31/);
});

test('progress displays over-target amounts honestly while invalid targets stay unavailable',()=>{
  const svg=chartSVG({type:'progress',rows:[{label:'A',value:150,target:100},{label:'B',value:1,target:0}]});
  assert.match(svg,/150 \/ 100 · 150%/);assert.match(svg,/Unavailable/);
  assert.equal((svg.match(/data-chart-point=/g)||[]).length,1);
});

test('donut ordinals keep the same category identity when earlier values are zero',()=>{
  const svg=chartSVG({type:'donut',rows:[{label:'A',value:0},{label:'B',value:10}]});assert.match(svg,/>2 · 100%</);assert.doesNotMatch(svg,/>1 · 100%</);
});

test('provided database percentages and exact table and tooltip formatters remain authoritative',async()=>{
  assert.match(chartSVG({type:'progress',rows:[{label:'Completion',value:1,target:3,pct:33.4}]}),/33.4%/);
  const el=host(),exact=v=>`KSh ${(v/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const card=renderChartCard(el,{type:'line',rows:[{label:'Nov',value:123456}],format:()=> '1.2K',tableFormat:exact,tooltipFormat:exact});
  assert.match(el.innerHTML,/1.2K/);el.listeners.focusin({target:el.querySelector('[data-chart-point]')});assert.match(el.querySelector('[data-chart-tooltip-text]').textContent,/1,234.56/);
  await click(el,el.querySelector('[data-chart-table]'));assert.match(el.innerHTML,/KSh 1,234.56/);assert.match(card.toCSV(),/123456,"KSh 1,234.56"/);
});

test('CSV preserves numeric source units and adds formatted currency without inventing missing values',()=>{
  const csv=chartCSV({...sample,format:v=>`KES ${(v/100).toFixed(2)}`});
  assert.match(csv,/Income \(raw supplied units\)/);assert.match(csv,/20000,"KES 200.00"/);assert.match(csv,/-5000,"KES -50.00"/);
  assert.match(chartCSV({rows:[{label:'missing',value:null}]}),/Unavailable/);
});

test('legend toggles, table view and reset use the same visible series and data',async()=>{
  const el=host(),filters=[];const card=renderChartCard(el,{...sample,onFilter:f=>filters.push(f)});
  await click(el,el.querySelectorAll('[data-chart-legend]')[0]);
  assert.deepEqual(filters[0].seriesKeys,['expenses','net']);assert.doesNotMatch(card.toCSV(),/Income/);
  await click(el,el.querySelector('[data-chart-table]'));assert.match(el.innerHTML,/resource-table ui-table/);assert.match(el.innerHTML,/Sep/);
  await click(el,el.querySelectorAll('[data-chart-legend]')[1]);await click(el,el.querySelectorAll('[data-chart-legend]')[2]);
  assert.match(el.innerHTML,/All series hidden/);await click(el,el.querySelector('[data-chart-reset]'));
  assert.match(card.toCSV(),/Income/);card.destroy();assert.equal(el.innerHTML,'');assert.deepEqual(Object.keys(el.listeners),[]);
});

test('keyboard exploration, tooltip and drill deliver the exact supplied row and series',async()=>{
  const el=host(),drills=[];renderChartCard(el,{...sample,onDrill:d=>drills.push(d)});
  const points=el.querySelectorAll('[data-chart-point]');assert.equal(points[0].attrs.tabindex,'0');
  let prevented=false;el.listeners.keydown({target:points[0],key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(document.activeElement,points[1]);assert.equal(points[1].attrs.tabindex,'0');
  assert.match(el.querySelector('[data-chart-tooltip-text]').textContent,/Sep · Income: 0/);
  el.listeners.keydown({target:points[1],key:'Enter',preventDefault(){}});
  assert.equal(drills[0].row,sample.rows[1]);assert.equal(drills[0].seriesKey,'income');assert.equal(drills[0].value,0);
  el.listeners.keydown({target:points[1],key:'Escape'});assert.equal(el.querySelector('[data-chart-tooltip]').hidden,true);
});

test('empty action, retry and skeleton states expose useful controls without fabricated data',async()=>{
  const el=host();let adds=0,retries=0;
  const card=renderChartCard(el,{title:'Expenses',rows:[],emptyAction:{label:'Add expense',onClick(){adds++;}}});
  assert.match(el.innerHTML,/No data for this period/);await click(el,el.querySelector('[data-chart-empty]'));assert.equal(adds,1);
  card.update({loading:true});assert.match(el.innerHTML,/Loading records/);assert.equal(el.querySelector('svg'),null);
  card.update({loading:false,error:'Offline',onRetry(){retries++;}});assert.match(el.innerHTML,/Offline/);await click(el,el.querySelector('[data-chart-retry]'));assert.equal(retries,1);
});

test('an explicit chart empty state retains exact supplied zero rows for tables and CSV',async()=>{
  const el=host(),rows=[{month:'Nov',income:0,expenses:0,net:0}];
  const card=renderChartCard(el,{...sample,rows,emptyChart:true,emptyTitle:'No recorded cash movement',emptyText:'View the data table or choose another period.',format:v=>`KSh ${v/100}`});
  assert.match(el.innerHTML,/No recorded cash movement/);assert.equal(el.querySelector('svg'),null);
  assert.equal(el.querySelector('[data-chart-png]').disabled,true);assert.equal(el.querySelector('[data-chart-csv]').disabled,false);
  assert.equal(el.querySelector('[data-chart-table]').disabled,false);assert.match(card.toCSV(),/"Nov",0,"KSh 0",0,"KSh 0",0,"KSh 0"/);
  await click(el,el.querySelector('[data-chart-table]'));assert.match(el.innerHTML,/resource-table ui-table/);assert.match(el.innerHTML,/Nov/);assert.match(el.innerHTML,/KSh 0/);
  await click(el,el.querySelector('[data-chart-table]'));assert.match(el.innerHTML,/No recorded cash movement/);assert.equal(el.querySelector('svg'),null);
  card.update({rows:sample.rows,emptyChart:false});assert.ok(el.querySelector('svg'));assert.equal(el.querySelector('[data-chart-png]').disabled,false);
  card.destroy();
});
