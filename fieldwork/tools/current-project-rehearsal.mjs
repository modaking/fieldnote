// Artifact preparation only: this module has no database/network client.
// node fieldwork/tools/current-project-rehearsal.mjs [--out <workspace directory>]
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=fileURLToPath(new URL('../',import.meta.url));
const workspace=path.resolve(app,'../..');
export const PROJECT='nwuyizxxtfrncigorfji';
export const INPUTS=Object.freeze([
  ['migration','db/migrations/20261118_members_roles.sql'],
  ['migration','db/migrations/20261118_dashboard.sql'],
  ['migration','db/migrations/20261118_account.sql'],
  ['suite','db/tests/20261118_members_roles.test.sql'],
  ['suite','db/tests/20261118_dashboard.test.sql'],
  ['suite','db/tests/20261118_account.test.sql'],
]);
const hash=text=>createHash('sha256').update(text).digest('hex');
const uuidPattern=/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi;
const approvedPrefix=/^(?:9[7-9a-f]|b[1-8]|d[1-8])000000$/i;
const networkPattern='(net[.]http_[a-z_]*|http_request|http_get|http_post|dblink[a-z_]*|aws_lambda[.]invoke)[[:space:]]*[(]';
const trustedPublicTriggers=['fw_audit','fw_new_user','fw_new_workspace','fw_txn_defaults','fw_lock_base','rls_auto_enable','pgrst_ddl_watch','pgrst_drop_watch'];
const sqlLiteral=value=>"'"+value.replaceAll("'","''")+"'";
// Root reviewed this exact live provider definition: HTTP names occur only in
// transactional GRANT/REVOKE signatures. No invocation, and our batch cannot
// contain CREATE EXTENSION. Identity, owner, hash and attachment must all match.
export const REVIEWED_MANAGED_TRIGGER=Object.freeze({nspname:'extensions',proname:'grant_pg_net_access',definition_md5:'1d06ef4fb47bb0ab6e6f8818a62013bb',owner_name:'supabase_admin',trigger_kind:'event',event_name:'ddl_command_end',event_tags:['CREATE EXTENSION']});
export function isReviewedManagedTrigger(row){return ['nspname','proname','definition_md5','owner_name','trigger_kind','event_name'].every(key=>row[key]===REVIEWED_MANAGED_TRIGGER[key])&&JSON.stringify(row.event_tags)===JSON.stringify(REVIEWED_MANAGED_TRIGGER.event_tags);}
export function reviewedTriggerPredicate(){const r=REVIEWED_MANAGED_TRIGGER;return `(nspname=${sqlLiteral(r.nspname)} and proname=${sqlLiteral(r.proname)} and owner_name=${sqlLiteral(r.owner_name)} and trigger_kind='event' and event_name='ddl_command_end' and event_tags=array['CREATE EXTENSION']::text[] and md5(definition)=${sqlLiteral(r.definition_md5)})`;}

// Mask comments and quoted bodies, preserving offsets/newlines. In particular,
// PL/pgSQL BEGIN/END and transaction-looking text in strings are never wrappers.
export function maskSQL(source){
  const chars=source.split(''),blank=(a,b)=>{for(let k=a;k<b;k++)if(chars[k]!=='\n'&&chars[k]!=='\r')chars[k]=' ';};
  for(let i=0;i<source.length;){
    const start=i;
    if(source.startsWith('--',i)){i=source.indexOf('\n',i);if(i<0)i=source.length;blank(start,i);continue;}
    if(source.startsWith('/*',i)){let depth=1;i+=2;while(i<source.length&&depth){if(source.startsWith('/*',i)){depth++;i+=2;}else if(source.startsWith('*/',i)){depth--;i+=2;}else i++;}if(depth)throw new Error('Unclosed SQL comment');blank(start,i);continue;}
    if(source[i]==="'"||source[i]==='"'){
      const quote=source[i++],escaped=quote==="'"&&/[eE]/.test(source[start-1]||'')&&(start<2||!/[\w$]/.test(source[start-2]));let closed=false;
      while(i<source.length){if(source[i]===quote){if(source[i+1]===quote){i+=2;continue;}i++;closed=true;break;}if(source[i]==='\\'&&escaped){i+=2;continue;}i++;}
      if(!closed)throw new Error('Unclosed SQL quote');blank(start,i);continue;
    }
    const dollar=source.slice(i).match(/^\$(?:[a-z_][a-z_0-9]*)?\$/i)?.[0];
    if(dollar){const end=source.indexOf(dollar,i+dollar.length);if(end<0)throw new Error('Unclosed SQL dollar body');i=end+dollar.length;blank(start,i);continue;}
    i++;
  }
  return chars.join('');
}
export function sqlStatements(source){
  const code=maskSQL(source),statements=[];let start=0;
  for(let i=0;i<code.length;i++)if(code[i]===';'){const statement=code.slice(start,i+1).trim();if(statement)statements.push({code:statement,raw:source.slice(start,i+1),start,end:i+1});start=i+1;}
  if(code.slice(start).trim())throw new Error('SQL source has an unterminated outer statement');
  return statements;
}
export function stripWrappers(source,kind,label='SQL source'){
  const ending=kind==='migration'?'commit':'rollback',statements=sqlStatements(source);
  if(!/^begin\s*;$/i.test(statements[0]?.code||'')||!new RegExp('^'+ending+'\\s*;$','i').test(statements.at(-1)?.code||''))throw new Error(label+': expected outer begin/'+ending+' wrappers');
  const controls=statements.filter(s=>/^(begin|commit|rollback|end|abort|start\s+transaction|prepare\s+transaction)\b/i.test(s.code));
  if(controls.length!==2)throw new Error(label+': unexpected outer transaction command');
  const masked=maskSQL(source),matches=[...source.matchAll(/^[\t ]*(begin|commit|rollback)[\t ]*;[\t ]*\r?$/gim)].filter(m=>masked.slice(m.index,m.index+m[0].length).trim());
  if(matches.length!==2||matches[0][1].toLowerCase()!=='begin'||matches[1][1].toLowerCase()!==ending)throw new Error(label+': wrappers must be standalone, exactly one pair');
  let result=source;for(const match of matches.reverse())result=result.slice(0,match.index)+match[0].replace(/[^\r\n]/g,' ')+result.slice(match.index+match[0].length);
  return result;
}
export function reviewSuiteScope(source,label){
  const ids=[...source.matchAll(uuidPattern)].map(m=>m[1].toLowerCase());
  if(!ids.length||ids.some(id=>!approvedPrefix.test(id.slice(0,8))))throw new Error(label+': unexpected/nonfixture UUID literal');
  for(const statement of sqlStatements(source)){
    const code=statement.code.toLowerCase(),raw=statement.raw;
    if(/^(update|delete)\b/.test(code)){
      const where=raw.slice(raw.toLowerCase().lastIndexOf(' where '));
      const direct=/\b(?:id|user_id|workspace_id)\s*=\s*'[0-9a-f-]{36}'/i.test(where);
      const generatedInvite=/^update\s+public\.workspace_invites\b/.test(code)&&/where\s+id\s*=\s*\(select\s+\(payload->>'id'\)::uuid\s+from\s+fw_test_invites\s+where\s+label='expired'\)/i.test(raw);
      if((!direct&&!generatedInvite)||/\bor\b/i.test(maskSQL(where)))throw new Error(label+': unscoped fixture mutation');
    }
    if(/^insert\b/.test(code)&&![...raw.matchAll(uuidPattern)].length&&!/\binsert\s+into\s+(fw_test_invites|dashboard_outputs)\b/i.test(raw))throw new Error(label+': insert is missing a fixed fixture identity/workspace');
  }
  return [...new Set(ids.map(id=>id.slice(0,8)))].sort();
}
const triggerInventory=`with trigger_functions as (
  select distinct p.oid,n.nspname,p.proname,pg_get_userbyid(p.proowner)::text as owner_name,'table'::text as trigger_kind,null::text as event_name,null::text[] as event_tags,pg_get_functiondef(p.oid) as definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace cn on cn.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
    where not t.tgisinternal and t.tgenabled<>'D' and cn.nspname in ('public','auth','storage')
  union
  select distinct p.oid,n.nspname,p.proname,pg_get_userbyid(p.proowner)::text,'event'::text,e.evtevent::text,e.evttags,pg_get_functiondef(p.oid)
    from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace where e.evtenabled<>'D'
)`;
export function metadataReviewSQL(){return `-- READ ONLY metadata review for ${PROJECT}; no user rows/secrets returned.
begin transaction read only;
set local lock_timeout='1s';set local statement_timeout='5s';set local transaction_timeout='15s';set local idle_in_transaction_session_timeout='15s';
${triggerInventory}
select 'external_call_trigger_functions' as probe,count(*) as count from trigger_functions where definition ~* ${sqlLiteral(networkPattern)}
union all select 'reviewed_managed_signature_only_functions',count(*) from trigger_functions where definition ~* ${sqlLiteral(networkPattern)} and ${reviewedTriggerPredicate()}
union all select 'unreviewed_external_call_trigger_functions',count(*) from trigger_functions where definition ~* ${sqlLiteral(networkPattern)} and not coalesce(${reviewedTriggerPredicate()},false)
union all select 'transactional_notify_trigger_functions',count(*) from trigger_functions where definition ~* '(pg_notify[[:space:]]*[(]|\\mnotify\\M)'
union all select 'unexpected_public_trigger_functions',count(*) from trigger_functions where nspname='public' and proname<>all(array[${trustedPublicTriggers.map(sqlLiteral).join(',')}])
union all select 'public_views_or_materialized_views',count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m');
${triggerInventory}
select nspname,proname,owner_name,trigger_kind,event_name,event_tags,md5(definition) as definition_md5,${reviewedTriggerPredicate()} as reviewed_signature_only_exception,definition from trigger_functions order by nspname,proname;
rollback;
-- Review helper calls transitively: a wrapper can hide external network work.
-- Standard PostgREST NOTIFY is transactional and is not delivered on rollback.
`;}

export function metadataFingerprintSQL(prefixes){const fingerprint=`with items as (
  select 'table:'||n.nspname::text||'.'||c.relname::text||':'||c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') as item
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','fw_private','auth','storage','net','extensions') and c.relkind in ('r','p','v','m')
  union all select 'column:'||n.nspname::text||'.'||c.relname::text||'.'||a.attname::text||':'||a.attnum::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||a.attidentity::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname in ('public','fw_private','auth','storage','net','extensions') and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
  union all select 'constraint:'||n.nspname::text||'.'||c.relname::text||'.'||x.conname::text||':'||pg_get_constraintdef(x.oid,true)
    from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','fw_private','auth','storage','net','extensions')
  union all select 'index:'||n.nspname::text||'.'||c.relname::text||':'||pg_get_indexdef(c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','fw_private','auth','storage','net','extensions') and c.relkind in ('i','I')
  union all select 'policy:'||n.nspname::text||'.'||c.relname::text||'.'||p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','fw_private','auth','storage','net','extensions')
  union all select 'function:'||n.nspname::text||'.'||p.proname::text||':'||p.proowner::text||':'||coalesce(p.proacl::text,'')||':'||pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','fw_private','auth','storage','net','extensions') and p.prokind in ('f','p')
  union all select 'trigger:'||n.nspname::text||'.'||c.relname::text||'.'||t.tgname::text||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid,true)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','fw_private','auth','storage','net','extensions')
  union all select 'schema:'||nspname::text||':'||nspowner::text||':'||coalesce(nspacl::text,'') from pg_namespace where nspname in ('public','fw_private','auth','storage','net','extensions')
  union all select 'bucket_config:'||b.id||':'||to_jsonb(b)::text from storage.buckets b
  union all select 'event_trigger:'||e.evtname::text||':'||e.evtevent::text||':'||e.evtenabled::text||':'||e.evtfoid::regprocedure::text||':'||coalesce(e.evttags::text,'') from pg_event_trigger e
  union all select 'role:'||rolname::text||':'||rolsuper::text||':'||rolinherit::text||':'||rolcreaterole::text||':'||rolcreatedb::text||':'||rolcanlogin::text||':'||rolbypassrls::text from pg_roles where rolname in ('anon','authenticated','service_role','postgres')
  union all select 'membership:'||pg_get_userbyid(roleid)::text||':'||pg_get_userbyid(member)::text||':'||admin_option::text from pg_auth_members
    where pg_get_userbyid(member) in ('anon','authenticated','service_role','postgres')
)
select 'catalog_fingerprint' as probe,count(*) as catalog_items,md5(string_agg(item,E'\\n' order by item)) as fingerprint from items;`;
return `-- Run this READ-ONLY batch before AND after the rehearsal on ${PROJECT}.
-- Last result is the actual comparable fingerprint after rollback, not a constant.
-- Includes bucket configuration and net/extensions ACLs. No sequence values/logs.
begin transaction read only;
set local lock_timeout='1s';set local statement_timeout='5s';set local transaction_timeout='15s';set local idle_in_transaction_session_timeout='15s';
do $fixture_absence$ declare col record; n bigint; total bigint:=0; prefixes text[]:=array[${prefixes.map(sqlLiteral).join(',')}]; begin
  for col in select n.nspname,c.relname,a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype loop
    execute format('select count(*) from %I.%I where left(%I::text,8)=any($1)',col.nspname,col.relname,col.attname) into n using prefixes;total:=total+n;
  end loop;
  if total<>0 then raise exception 'Reserved fixture UUID cells remain/exist: count=%',total;end if;
end $fixture_absence$;
rollback;
${fingerprint}
`;}

function preflight(prefixes){return `-- ABORT on UUID-prefix collisions before temporary DDL or fixture insertion.
do $rehearsal_preflight$
declare col record; collision boolean; prefixes text[]:=array[${prefixes.map(sqlLiteral).join(',')}]; risks bigint;
begin
  if current_user<>'postgres' then raise exception 'Stop: current_user must be postgres for complete owner-level collision checks';end if;
  if current_setting('transaction_read_only')<>'off' then raise exception 'Rehearsal needs a rollback-only read/write transaction';end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')) then
    raise exception 'Stop: unexpected public view/materialized-view metadata needs review';
  end if;
  for col in select n.nspname,c.relname,a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','storage') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and a.atttypid='uuid'::regtype
    order by n.nspname,c.relname,a.attnum loop
    execute format('select exists(select 1 from %I.%I where left(%I::text,8)=any($1))',col.nspname,col.relname,col.attname) into collision using prefixes;
    if collision then raise exception 'Stop: reserved fixture UUID prefix exists in %.%.%',col.nspname,col.relname,col.attname;end if;
  end loop;
  ${triggerInventory}
  select count(*) into risks from trigger_functions where (definition ~* ${sqlLiteral(networkPattern)} and not coalesce(${reviewedTriggerPredicate()},false))
    or (nspname='public' and proname<>all(array[${trustedPublicTriggers.map(sqlLiteral).join(',')}]));
  if risks<>0 then raise exception 'Stop: external-call or unreviewed public trigger functions count=%',risks;end if;
end
$rehearsal_preflight$;
-- Metadata only: audit identity sequence advancement can survive rollback.
-- Do not read/change/reset its value; never use setval to remove test gaps.
select 'audit_identity_sequence_may_advance_despite_rollback' as caveat,
  count(*) as identity_columns from pg_attribute where attrelid='public.audit_log'::regclass and attname='id' and attidentity<>'';
`;}

export function buildRehearsal(inputs){
  if(inputs.length!==INPUTS.length||inputs.some((item,index)=>item.kind!==INPUTS[index][0]||item.file!==INPUTS[index][1]))throw new Error('Expected the reviewed six SQL inputs in migration/suite order');
  const reviewed=inputs.map(item=>({...item,body:stripWrappers(item.text,item.kind,item.file),sha256:hash(item.text)}));
  const prefixes=[...new Set(reviewed.filter(item=>item.kind==='suite').flatMap(item=>reviewSuiteScope(item.body,item.file)))].sort();
  const parts=[`-- GENERATED, UNEXECUTED ROLLBACK REHEARSAL for current project ${PROJECT}.
-- One connection, stop on FIRST error; rollback/close if the batch stops early.
-- Review current-project-trigger-review.sql and all transitive trigger helpers FIRST.
-- Temporarily takes DDL locks on live tables; other sessions cannot see these
-- uncommitted permissions, but their work may wait until rollback. No HTTP tests.
-- Audit identity sequence gaps and operational logs/metrics can remain. NEVER reset.
-- Only the final success marker is evidence of completion; inspect every error.
begin;
set local lock_timeout='1s';set local statement_timeout='5s';set local transaction_timeout='15s';set local idle_in_transaction_session_timeout='15s';
set local request.jwt.claim.sub='';set local request.jwt.claim.role='';set local request.jwt.claims='{}';
`,preflight(prefixes)];
  for(const item of reviewed.filter(item=>item.kind==='migration'))parts.push(`-- SOURCE ${item.file} sha256=${item.sha256}\n${item.body}`);
  let number=0;
  for(const item of reviewed.filter(item=>item.kind==='suite')){number++;const name='rehearsal_suite_'+number;parts.push(`-- SOURCE ${item.file} sha256=${item.sha256}\nreset role;\nset local request.jwt.claim.sub='';set local request.jwt.claim.role='';set local request.jwt.claims='{}';\nsavepoint ${name};\n${item.body}\nreset role;\nselect 'PASS: rehearsal suite ${number} (${item.file})' as suite_result;\nrollback to savepoint ${name};\nrelease savepoint ${name};`);}
  parts.push(`reset role;\nrollback;\nselect 'PASS: all three proposed migrations and rollback-isolated SQL suites completed; no migrations or fixtures retained' as result;\n`);
  const sql=parts.join('\n'),statements=sqlStatements(sql);
  const controls=statements.filter(item=>/^(begin|commit|rollback|end|abort|start\s+transaction|prepare\s+transaction)\b/i.test(item.code));
  if(controls.filter(item=>/^begin\s*;$/i.test(item.code)).length!==1||controls.filter(item=>/^rollback\s*;$/i.test(item.code)).length!==1||controls.filter(item=>/^rollback\s+to\s+savepoint\s+rehearsal_suite_[1-3]\s*;$/i.test(item.code)).length!==3||controls.length!==5)throw new Error('Generated batch has unexpected transaction boundaries');
  if(statements.some(item=>/^(commit|end|abort|prepare\s+transaction|alter\s+system|vacuum|create\s+database)\b|^create\s+(?:unique\s+)?index\s+concurrently\b/i.test(item.code)))throw new Error('Generated batch contains a non-rehearsal command');
  if(statements.some(item=>/^create\s+extension\b/i.test(item.code)))throw new Error('CREATE EXTENSION is outside the reviewed provider exception context');
  return{sql,manifest:{target_project:PROJECT,execution:'NOT EXECUTED: artifact preparation only',sha256:hash(sql),fixture_uuid_prefixes:prefixes,source_files:reviewed.map(({file,kind,sha256})=>({file,kind,sha256})),reviewed_managed_trigger_exception:REVIEWED_MANAGED_TRIGGER,transaction:{outer:1,suite_savepoints:3,final_rollback:1},required_review:['Confirm SQL editor/project identity before running','Review enabled table/event trigger definitions and transitive helpers','Review DDL lock impact; abort on lock_timeout','Accept normal audit identity sequence gaps; never reset live sequence','No Auth REST, email, MFA HTTP, object upload/delete, or server deletion tests are included']}};
}

async function main(){
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw new Error('Usage: node tools/current-project-rehearsal.mjs [--out <workspace directory>]');
  const out=path.resolve(args[1]||path.join(workspace,'fieldwork-export-checks')),relative=path.relative(workspace,out);
  if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw new Error('Artifacts must stay within the ENKISHON workspace');
  const inputs=await Promise.all(INPUTS.map(async([kind,file])=>({kind,file,text:await readFile(path.join(app,file),'utf8')}))),built=buildRehearsal(inputs);
  await mkdir(out,{recursive:true});const output=path.join(out,'current-project-rehearsal.sql');
  await writeFile(output,built.sql);await writeFile(path.join(out,'current-project-rehearsal.manifest.json'),JSON.stringify(built.manifest,null,2)+'\n');await writeFile(path.join(out,'current-project-trigger-review.sql'),metadataReviewSQL());await writeFile(path.join(out,'current-project-catalog-fingerprint.sql'),metadataFingerprintSQL(built.manifest.fixture_uuid_prefixes));
  process.stdout.write(JSON.stringify({prepared:output,sha256:built.manifest.sha256,source_files:inputs.length,fixture_prefixes:built.manifest.fixture_uuid_prefixes.length,executed:false},null,2)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
