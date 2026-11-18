import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const code = await readFile(new URL('../../js/permissions.js', import.meta.url), 'utf8');
const P = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('all declared roles can reach their profile/settings and report entry points', () => {
  for (const role of P.ROLES) {
    assert.equal(P.canReadModule(role, 'settings'), true, role);
    assert.equal(P.canReadModule(role, 'overview'), true, role);
    assert.equal(P.has(role, 'reports.read'), true, role);
  }
  assert.equal(P.canReadModule('unknown', 'settings'), false);
  assert.equal(P.canWriteModule('viewer', 'settings'), false);
});

test('worker and viewer never receive financial or pay controls', () => {
  for (const role of ['worker', 'viewer']) {
    for (const key of ['finances', 'vendors', 'funding', 'audit']) assert.equal(P.canReadModule(role, key), false, `${role}:${key}`);
    for (const capability of ['finance.read', 'finance.write', 'pay.read', 'pay.write', 'members.manage', 'audit.read']) assert.equal(P.has(role, capability), false, `${role}:${capability}`);
    assert.equal(P.canReadModule(role, 'workers'), true, 'redacted worker directory remains available');
    assert.equal(P.canWriteModule(role, 'workers'), false);
    assert.equal(P.canReadModule(role, 'infrastructure'), true, 'redacted operational projects remain available');
    assert.equal(P.canWriteModule(role, 'infrastructure'), false);
  }
});

test('workers can enter field activity while viewers remain read-only', () => {
  for (const key of ['daily', 'livestock']) {
    assert.equal(P.canReadModule('worker', key), true);
    assert.equal(P.canWriteModule('worker', key), true);
    assert.equal(P.canReadModule('viewer', key), true);
    assert.equal(P.canWriteModule('viewer', key), false);
  }
  assert.equal(P.has('worker', 'operations.templates'), false);
});

test('accountants can manage financial records but cannot edit unrelated operations or membership', () => {
  for (const key of ['finances', 'vendors', 'workers']) assert.equal(P.canWriteModule('accountant', key), true, key);
  for (const key of ['daily', 'livestock', 'farms', 'infrastructure', 'funding', 'members']) assert.equal(P.canWriteModule('accountant', key), false, key);
  assert.equal(P.canReadModule('accountant', 'daily'), false);
  assert.equal(P.canReport('accountant', 'finances'), true);
});

test('an administrator cannot grant or remove owner/administrator access', () => {
  assert.equal(P.canManageMembers('admin'), true);
  assert.equal(P.canManageMember('admin', 'worker', 'manager'), true);
  assert.equal(P.canManageMember('admin', 'worker', 'owner'), false);
  assert.equal(P.canManageMember('admin', 'worker', 'admin'), false);
  assert.equal(P.canManageMember('admin', 'owner', 'viewer'), false);
  assert.equal(P.canManageMember('admin', 'admin', 'viewer'), false);
  assert.equal(P.canManageMember('owner', 'admin', 'owner'), true);
  assert.equal(P.has('admin', 'workspace.delete'), false);
  assert.equal(P.has('owner', 'workspace.delete'), true);
});

test('restricted membership grants only explicit farm IDs and no shared records', () => {
  const restricted = { role: 'manager', farm_scope: 'farms', farm_ids: ['allowed'] };
  assert.equal(P.canAccessFarm(restricted, 'allowed'), true);
  assert.equal(P.canAccessFarm(restricted, 'other'), false);
  assert.equal(P.canAccessFarm(restricted, null), false);
  assert.equal(P.canAccessFarm({ role: 'viewer', farm_scope: 'farms', farm_ids: [] }, 'allowed'), false);
  assert.equal(P.canAccessFarm({ role: 'manager', farm_scope: 'all' }, null), true);
  assert.equal(P.canAccessFarm(null, 'allowed'), false);
});
