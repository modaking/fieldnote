// Pure invitation URL helpers. Do not confuse auth callback fragments with invites.
const validToken = (token) => typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token);

export function buildInviteURL({ origin, pathname }, token) {
  if (!validToken(token)) throw new Error('This invitation token is invalid. Create a new invitation.');
  const base = new URL(origin), url = new URL(pathname || '/', base);
  if (!['https:', 'http:'].includes(base.protocol) || url.origin !== base.origin) throw new Error('This invitation address is invalid.');
  url.search = ''; url.hash = ''; url.searchParams.set('invite', token);
  return url.href;
}

export function readInviteURL({ pathname = '/', search = '', hash = '' }) {
  const query = new URLSearchParams(search), candidates = query.getAll('invite');
  let found = query.has('invite'), cleanHash = hash;
  if (found) query.delete('invite');
  const match = /^#\/?invite(?:\?(.*))?$/.exec(hash);
  if (match) {
    const fragment = new URLSearchParams(match[1] || '');
    if (fragment.has('token')) {
      found = true; candidates.push(...fragment.getAll('token')); fragment.delete('token');
      cleanHash = fragment.size ? `#/invite?${fragment}` : '';
    }
  }
  const unique = [...new Set(candidates)];
  const token = found && unique.length === 1 && validToken(unique[0]) ? unique[0] : null;
  return {
    token, found, invalid: found && !token,
    cleanURL: found ? pathname + (query.size ? '?' + query : '') + cleanHash : null,
  };
}
