import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTIONS,PAGES,sectionURL,resolveNavigation,navigationItems,rememberRecent,recentItems} from '../js/navigation.js';
test('five top-level destinations retain every inventoried module as a distinct section',()=>{
  assert.equal(PAGES.length,5);assert.equal(new Set(SECTIONS.map(item=>item.id)).size,SECTIONS.length);
  for(const id of ['tasks','checklists','enterprises','records','infrastructure','transactions','budgets','recurring','categories','vendors','bills','merchants','funding','workers','members','invitations'])assert.ok(SECTIONS.some(item=>item.id===id),id);
  for(const section of SECTIONS){const route=resolveNavigation(sectionURL(section.id));assert.equal(route.section,section.id);assert.equal(route.module,section.module);}
});
test('old links resolve without dropping add, report or filter parameters',()=>{
  for(const[hash,section]of [['#/daily?tab=checklists','checklists'],['#/livestock?add=1','records'],['#/vendors?tab=bills','bills'],['#/finances?tab=budget&category_id=one','budgets'],['#/members?tab=invites','invitations']])assert.equal(resolveNavigation(hash).section,section);
  const route=resolveNavigation('#/finances?tab=budget&category_id=one');assert.equal(route.params.get('category_id'),'one');
});
test('navigation obeys current role and migration availability',()=>{
  const items=navigationItems(key=>['overview','daily','livestock','workers','reports'].includes(key),false);
  assert.deepEqual(items.map(item=>item.id),['overview','operations','people','reports']);
});
test('recent records stay in the current account and workspace and tolerate blocked storage',()=>{
  const rows=new Map(),storage={getItem:key=>rows.get(key),setItem:(key,value)=>rows.set(key,value)};
  rememberRecent('a','first',{section:'tasks',id:'one',label:'Sample task'},storage);
  assert.equal(recentItems('a','first',storage).length,1);assert.deepEqual(recentItems('b','first',storage),[]);assert.deepEqual(recentItems('a','other',storage),[]);
  assert.doesNotThrow(()=>rememberRecent('a','first',{section:'tasks',id:'two'},null));
});
