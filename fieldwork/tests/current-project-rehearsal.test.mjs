import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {INPUTS,maskSQL,sqlStatements,stripWrappers,reviewSuiteScope,buildRehearsal,metadataReviewSQL,metadataFingerprintSQL,REVIEWED_MANAGED_TRIGGER,isReviewedManagedTrigger,reviewedTriggerPredicate} from '../tools/current-project-rehearsal.mjs';
const inputs=await Promise.all(INPUTS.map(async([kind,file])=>({kind,file,text:await readFile(new URL('../'+file,import.meta.url),'utf8')})));
test('wrapper stripping preserves comments and quoted/PLpgSQL body transaction words exactly',()=>{
  const source="-- 🧪 begin;\nbegin;\ndo $body$\nbegin\n  perform 'commit;';\nend\n$body$;\nselect 'rollback;';\ncommit;\n";
  const stripped=stripWrappers(source,'migration');assert.match(stripped,/-- 🧪 begin;/);assert.match(stripped,/perform 'commit;';/);assert.match(stripped,/select 'rollback;';/);assert.equal(sqlStatements(stripped).length,2);assert.equal(maskSQL(source).length,source.length);
});
test('unexpected, duplicate, inline and mismatched transaction boundaries fail closed',()=>{
  for(const source of ['begin;\nbegin;\nselect 1;\ncommit;','begin;select 1;commit;','begin;\nselect 1;\nrollback;','begin;\nselect 1;\ncommit;\ncommit;'])assert.throws(()=>stripWrappers(source,'migration'),/wrapper|transaction|standalone/);
  assert.throws(()=>stripWrappers('begin;\nselect 1;\ncommit;','suite'),/wrappers/);assert.throws(()=>sqlStatements("select 'unfinished"),/Unclosed/);
});
test('fixture DML guards reject unknown identities and unbounded/OR-expanded updates',()=>{
  assert.throws(()=>reviewSuiteScope("update public.transactions set amount=0 where description='Farm A1';",'unsafe'),/UUID|unscoped/);
  assert.throws(()=>reviewSuiteScope("delete from public.farms where id='99000000-0000-4000-8000-000000000001' or true;",'unsafe'),/unscoped/);
  assert.throws(()=>reviewSuiteScope("insert into public.farms(id) values('12345678-0000-4000-8000-000000000001');",'unsafe'),/nonfixture/);
});
test('actual six inputs yield one bounded transaction and three fixture-isolating savepoints',()=>{
  const original=inputs.map(i=>i.text),built=buildRehearsal(inputs),code=sqlStatements(built.sql).map(s=>s.code.toLowerCase());
  assert.equal(code.filter(s=>/^begin\s*;$/.test(s)).length,1);assert.equal(code.filter(s=>/^rollback\s*;$/.test(s)).length,1);assert.equal(code.filter(s=>/^rollback to savepoint rehearsal_suite_[1-3];$/.test(s)).length,3);assert.equal(code.filter(s=>/^release savepoint rehearsal_suite_[1-3];$/.test(s)).length,3);assert.ok(!code.some(s=>/^(commit|end|abort|prepare transaction)\b/.test(s)));
  assert.ok(built.sql.indexOf('SOURCE db/migrations/20261118_members_roles.sql')<built.sql.indexOf('SOURCE db/migrations/20261118_dashboard.sql'));assert.ok(built.sql.indexOf('SOURCE db/migrations/20261118_dashboard.sql')<built.sql.indexOf('SOURCE db/migrations/20261118_account.sql'));
  assert.equal(code.filter(s=>s==="set local transaction_timeout=     ;").length,1);assert.match(built.sql,/transaction_timeout='15s'/);assert.equal((built.sql.match(/set local request\.jwt\.claims='\{\}';/g)||[]).length,4);
  assert.ok(code.at(-2)==='rollback;');assert.match(code.at(-1),/^select/);assert.match(built.sql,/left\(%I::text,8\)=any\(\$1\)/);assert.match(built.sql,/never.*reset/i);assert.equal(built.manifest.fixture_uuid_prefixes.length,25);assert.deepEqual(inputs.map(i=>i.text),original);
});
test('manifest pins every untouched source and final generated batch by SHA256',()=>{
  const built=buildRehearsal(inputs);assert.equal(built.manifest.sha256,createHash('sha256').update(built.sql).digest('hex'));for(let i=0;i<inputs.length;i++)assert.equal(built.manifest.source_files[i].sha256,createHash('sha256').update(inputs[i].text).digest('hex'));
  assert.throws(()=>buildRehearsal(inputs.slice().reverse()),/reviewed six/);
});
test('separate metadata review/postflight scripts are read-only and never touch sequence state',()=>{
  for(const text of [metadataReviewSQL(),metadataFingerprintSQL(['97000000'])]){const statements=sqlStatements(text).map(s=>s.code.toLowerCase());assert.equal(statements[0],'begin transaction read only;');assert.ok(statements.some(s=>s==='rollback;'));assert.ok(!statements.some(s=>/^(insert|update|delete|create|alter|drop|grant|revoke|commit)\b/.test(s)));assert.doesNotMatch(maskSQL(text),/\b(setval|nextval)\s*\(/i);}
  assert.match(metadataReviewSQL(),/transactional_notify_trigger_functions/);assert.match(metadataFingerprintSQL(['97000000']),/catalog_fingerprint/);
  const fingerprint=sqlStatements(metadataFingerprintSQL(['97000000']));assert.equal(fingerprint.at(-2).code,'rollback;');assert.match(fingerprint.at(-1).code,/with items as/);assert.match(metadataFingerprintSQL(['97000000']),/bucket_config/);assert.match(metadataFingerprintSQL(['97000000']),/'net','extensions'/);
});
test('provider false-positive exception is pinned to exact owner, definition and event attachment',()=>{
  assert.equal(isReviewedManagedTrigger({...REVIEWED_MANAGED_TRIGGER}),true);
  for(const change of [{definition_md5:'0'.repeat(32)},{proname:'another_function'},{nspname:'public'},{owner_name:'postgres'},{trigger_kind:'table'},{event_name:'ddl_command_start'},{event_tags:['CREATE TABLE']},{event_tags:['CREATE EXTENSION','CREATE TABLE']}])assert.equal(isReviewedManagedTrigger({...REVIEWED_MANAGED_TRIGGER,...change}),false);
  const predicate=reviewedTriggerPredicate();for(const value of ['supabase_admin','extensions','grant_pg_net_access','1d06ef4fb47bb0ab6e6f8818a62013bb','ddl_command_end','CREATE EXTENSION'])assert.ok(predicate.includes(value));
  assert.match(metadataReviewSQL(),/unreviewed_external_call_trigger_functions/);assert.match(metadataReviewSQL(),/reviewed_managed_signature_only_functions/);
  const altered=inputs.map(i=>({...i}));altered[0].text=altered[0].text.replace(/\bcommit;\s*$/i,'create extension pg_net;\ncommit;');assert.throws(()=>buildRehearsal(altered),/CREATE EXTENSION/);
});
