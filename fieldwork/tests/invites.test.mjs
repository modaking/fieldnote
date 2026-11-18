import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const code = await readFile(new URL('../js/invites.js', import.meta.url), 'utf8');
const { buildInviteURL, readInviteURL } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const token = 'a1'.repeat(32), other = 'b2'.repeat(32);
const base = { origin: 'https://fieldnote.example.invalid', pathname: '/farm/' };

test('a generated invitation can be consumed end to end and its token scrubbed', () => {
  const url = new URL(buildInviteURL(base, token));
  const invitation = readInviteURL(url);
  assert.equal(url.origin, base.origin); assert.equal(url.pathname, base.pathname);
  assert.equal(invitation.token, token); assert.equal(invitation.invalid, false);
  assert.equal(invitation.cleanURL, '/farm/');
});

test('legacy generated fragment invitation links are still accepted and scrubbed', () => {
  assert.deepEqual(readInviteURL({ ...base, search: '', hash: `#/invite?token=${token}` }), {
    token, found: true, invalid: false, cleanURL: '/farm/',
  });
});

test('query parameters and unrelated navigation fragments survive token scrubbing', () => {
  const value = readInviteURL({ ...base, search: `?keep=one%20two&invite=${token}&page=2`, hash: '#/daily?add=1' });
  const cleaned = new URL(value.cleanURL, base.origin);
  assert.equal(value.token, token);
  assert.equal(cleaned.searchParams.get('keep'), 'one two'); assert.equal(cleaned.searchParams.get('page'), '2');
  assert.equal(cleaned.searchParams.has('invite'), false); assert.equal(cleaned.hash, '#/daily?add=1');
});

test('an auth callback fragment is not treated as an invitation', () => {
  const hash = `#access_token=${token}&refresh_token=${other}&type=recovery`;
  assert.deepEqual(readInviteURL({ ...base, search: '', hash }), { token: null, found: false, invalid: false, cleanURL: null });
  const combined = readInviteURL({ ...base, search: `?invite=${token}&keep=1`, hash });
  assert.equal(combined.token, token); assert.ok(combined.cleanURL.endsWith(hash));
});

test('legacy fragment parsing keeps its other query parameters without keeping a secret', () => {
  const result = readInviteURL({ ...base, search: '?keep=1', hash: `#/invite?token=${token}&from=team%20page` });
  assert.equal(result.token, token);
  assert.equal(result.cleanURL, '/farm/?keep=1#/invite?from=team+page');
});

test('invalid, missing and ambiguous tokens are rejected and scrubbed instead of stored', () => {
  for (const invalid of ['', 'short', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), ' '+token]) {
    const value = readInviteURL({ ...base, search: '?invite='+encodeURIComponent(invalid), hash: '' });
    assert.equal(value.token, null); assert.equal(value.invalid, true); assert.equal(value.cleanURL, '/farm/');
    assert.throws(() => buildInviteURL(base, invalid), /invalid/);
  }
  const conflict = readInviteURL({ ...base, search: `?invite=${token}`, hash: `#/invite?token=${other}` });
  assert.equal(conflict.token, null); assert.equal(conflict.invalid, true); assert.equal(conflict.cleanURL, '/farm/');
  const duplicate = readInviteURL({ ...base, search: `?invite=${token}&invite=${other}`, hash: '' });
  assert.equal(duplicate.token, null); assert.equal(duplicate.invalid, true);
});

test('a fragment only carries invitations on the explicit invitation route', () => {
  for (const hash of [`#/daily?token=${token}`, `#token=${token}`, `#/reports?invite=${token}`, '#/invite']) {
    const value = readInviteURL({ ...base, search: '', hash });
    assert.equal(value.found, false); assert.equal(value.cleanURL, null);
  }
});

test('generated addresses cannot move invitations to another origin or non-web scheme', () => {
  assert.throws(() => buildInviteURL({ origin: base.origin, pathname: '//other.example.invalid/' }, token), /invalid/);
  assert.throws(() => buildInviteURL({ origin: 'file:///', pathname: '/' }, token), /invalid/);
});
