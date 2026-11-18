import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sqlStatements} from '../tools/current-project-rehearsal.mjs';

const source=await readFile(new URL('../db/migrations/20261118_account.sql',import.meta.url),'utf8');
const statements=sqlStatements(source);
const declarations=statements.filter(item=>/^create or replace function\b/i.test(item.code));
const declaration=name=>{
  const found=declarations.filter(item=>new RegExp(`^create or replace function ${name.replaceAll('.','\\.')}\\(`,'i').test(item.code));
  assert.equal(found.length,1,`Exactly one ${name} declaration must be installed.`);return found[0];
};

// These are source-surface checks, not simulated PostgreSQL authorization. The
// rollback SQL suite exercises the actual positive/negative permission states.
test('invitation verification exposes two no-argument server contracts rather than caller-selected users or proof values',()=>{
  for(const name of ['public.fw_invitation_verification','public.fw_complete_invite_recovery']){
    const item=declaration(name);
    assert.match(item.code.replace(/\s+/g,' '),/\(\) returns jsonb language plpgsql (stable|volatile) security definer set search_path=pg_catalog,public as/i);
  }
  assert.match(declaration('public.fw_invitation_verification').raw,/jsonb_build_object\('needs_recovery',[^;]+'proof_recent'/);
  assert.match(declaration('public.fw_complete_invite_recovery').raw,/return public\.fw_invitation_verification\(\)/);
});

test('installing the account migration never rotates existing credentials or writes farm rows',()=>{
  const directWrites=statements.filter(item=>/^(insert|update|delete|truncate)\b/i.test(item.code));
  assert.equal(directWrites.length,1,'Existing rows must change only through later explicit account actions.');
  assert.match(directWrites[0].code,/^insert into storage\.buckets\b/i);
  assert.match(directWrites[0].raw,/on conflict\(id\) do nothing/i);
});

test('recovery completion can mutate only its authenticated user app metadata and cannot read password hashes or editable user proof',()=>{
  const item=declaration('public.fw_complete_invite_recovery'),body=item.raw.slice(item.raw.indexOf('$$')+2,item.raw.lastIndexOf('$$')).replace(/--[^\n]*/g,'');
  const writes=[...body.matchAll(/\b(insert\s+into|update|delete\s+from)\s+([a-z_][\w.]*)\b/gi)];
  assert.deepEqual(writes.map(match=>[match[1].toLowerCase(),match[2]]),[['update','auth.users']]);
  assert.doesNotMatch(body,/\bencrypted_password\b|\braw_user_meta_data\b/);
  assert.match(body,/set raw_app_meta_data=coalesce\(raw_app_meta_data,'\{\}'::jsonb\)\|\|jsonb_build_object\([\s\S]*?where id=uid/);
});
