import test from 'node:test';
import assert from 'node:assert/strict';
import {readAll,readForList,readRpcAll,calendarMonth} from '../js/read-all.js';

function server(count,cap=333){const rows=Array.from({length:count},(_,id)=>({id,name:'Same name'})),calls=[];return{rows,calls,db:{async select(_table,query){const p=new URLSearchParams(query),offset=Number(p.get('offset')||0),limit=Number(p.get('limit')||1000);calls.push({offset,limit,order:p.get('order')});return rows.slice(offset,offset+Math.min(cap,limit));}}};}
test('complete reads use actual offsets and continue through a lower server cap until EMPTY',async()=>{
  const s=server(1001);const rows=await readAll(s.db,'items','workspace_id=eq.a&order=name.asc');
  assert.equal(rows.length,1001);assert.deepEqual(s.calls.map(c=>c.offset),[0,333,666,999,1001]);assert.equal(s.calls[0].order,'name.asc,id.asc');
});
test('a capped list distinguishes exactly10000 records from an incomplete10001 record list',async()=>{
  for(const count of [10000,10001]){const s=server(count,250),result=await readForList(s.db,'items');assert.equal(result.rows.length,10000);assert.equal(result.complete,count===10000);assert.equal(s.calls.at(-1).offset,10000);assert.equal(s.calls.at(-1).limit,1);}
});
test('required reads reject incomplete limits, failed pages, and repeated rows instead of returning partial data',async()=>{
  const s=server(1001,250);await assert.rejects(readAll(s.db,'items','',{maxRows:1000}),/too large to load completely/);
  await assert.rejects(readAll(s.db,'items','limit=1'),/partial page/);
  await assert.rejects(readAll({select:async()=>[{id:'same'}]},'items'),/changed while loading/);
  let calls=0;await assert.rejects(readAll({select:async()=>{if(calls++)throw new Error('Offline');return[{id:'one'}];}},'items'),/Offline/);
});
test('an account change stops a complete read before another page is requested',async()=>{
  let active=true,calls=0;await assert.rejects(readAll({select:async()=>{calls++;active=false;return[{id:1}];}},'items','',{active:()=>active}),/account or workspace changed/);assert.equal(calls,1);
});
test('posting calendar months preserve year and leap boundaries independently of a report range',()=>{
  assert.equal(calendarMonth('2026-12').to,'2027-01-01');assert.equal(calendarMonth('2024-02').to,'2024-03-01');assert.equal(calendarMonth('2026-11').from,'2026-11-01');assert.throws(()=>calendarMonth('2026-13'),/valid month/);
});

test('TABLE RPC reads retain every member below a lower server cap using user_id rather than a nonexistent id',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({user_id:`user-${i}`,full_name:'Same name'})),calls=[],args={p_workspace_id:'workspace'};
  const result=await readRpcAll({rpc:async(name,body,query)=>{const p=new URLSearchParams(query),offset=Number(p.get('offset')||0);calls.push({name,body,offset,order:p.get('order')});return rows.slice(offset,offset+Math.min(200,Number(p.get('limit')||1000)));}},'fw_list_members',args,'',{key:'user_id',order:'full_name.asc'});
  assert.equal(result.length,1001);assert.deepEqual(calls.map(c=>c.offset),[0,200,400,600,800,1000,1001]);assert.ok(calls.every(c=>c.name==='fw_list_members'&&c.body===args&&c.order==='full_name.asc,user_id.asc'));
});
test('TABLE RPC pagination retains operational rows and never repeats a scalar or mutation RPC',async()=>{
  for(const name of ['fw_operational_workers','fw_operational_projects','fw_list_invites']){
    const s=server(1001,127),rows=await readRpcAll({rpc:(_name,_args,query)=>s.db.select('',query)},name,{p_workspace_id:'workspace'});assert.equal(rows.length,1001);assert.equal(s.calls.at(-1).offset,1001);
  }
  let called=false;assert.throws(()=>readRpcAll({rpc:()=>{called=true;}},'fw_close_month',{}),/not a paged record list/);assert.equal(called,false);
});
