// Account-only Auth/Storage calls reuse the app's refreshed, same-user request path.
// No service-role credential belongs in this module or any browser configuration.
import { authorized, getPublicConfig, session, auth } from './supabase.js';

export const AVATAR_BUCKET = 'fw-avatars';
const fail = (message, status = 0) => Object.assign(new Error(message), { status });
const sameUser = (uid) => { if (!uid || session()?.user.id !== uid) throw fail('Your account changed. Reopen Account to continue.', 401); };
export function sessionClaims(token = session()?.access_token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
export function recentlyAuthenticated(claims = sessionClaims(), now = Date.now()) {
  return Array.isArray(claims.amr) && claims.amr.some((item) => ['password','oauth','otp','magiclink','sso/saml'].includes(item.method)
    && Number.isFinite(item.timestamp) && now / 1000 - item.timestamp >= -30 && now / 1000 - item.timestamp <= 600);
}
async function direct(path, { method = 'GET', body, binary = false } = {}) {
  const uid = session()?.user.id;
  await authorized('/auth/v1/user'); sameUser(uid);
  const cfg = getPublicConfig(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path.startsWith('/api/') ? path : cfg.url + path, { method, signal: controller.signal,
      headers: { Authorization: 'Bearer ' + session().access_token, ...(path.startsWith('/api/') ? {} : { apikey: cfg.anonKey }),
        'Content-Type': binary ? 'image/webp' : 'application/json', ...(binary ? { 'x-upsert': 'true' } : {}) },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
    const text = await response.text(); sameUser(uid);
    let data; try { data = text ? JSON.parse(text) : null; } catch { throw fail('The account service returned an unexpected response.', 502); }
    if (!response.ok) throw fail(data?.message || data?.error || `Account request failed (${response.status}).`, response.status);
    return data;
  } catch (error) { if (error.status != null) throw error; throw fail('Couldn’t reach the account service. Check your connection and try again.'); }
  finally { clearTimeout(timer); }
}
export async function prepareAvatar(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw fail('Choose a JPEG, PNG or WebP photo.', 400);
  if (file.size > 10 * 1024 * 1024) throw fail('Choose a photo smaller than 10 MB.', 400);
  let image;
  try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw fail('This photo could not be opened. Try a JPEG or PNG.', 400); }
  try {
    const canvas = document.createElement('canvas'), size = 256;
    canvas.width = size; canvas.height = size;
    const side = Math.min(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, (image.width-side)/2, (image.height-side)/2, side, side, 0, 0, size, size);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp' || blob.size > 1024 * 1024) throw fail('This photo could not be prepared. Try another photo.', 400);
    return blob; // Re-encoding removes embedded EXIF/location metadata.
  } finally { image.close?.(); }
}
const factorId = (id) => { if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw fail('Choose a valid authenticator.', 400); return encodeURIComponent(id); };
const toBase64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

export const accountClient = {
  async getUser() { const user = await authorized('/auth/v1/user'); auth.syncUser?.(user); return user; },
  async getFactors() { const user = await accountClient.getUser(); return Array.isArray(user.factors) ? user.factors : []; },
  sendReauthentication: () => authorized('/auth/v1/reauthenticate'),
  async reauthenticatePassword(password, totpCode = '') {
    const user = await accountClient.getUser(), uid = user.id;
    if (!password) throw fail('Enter your current password.', 400);
    const verified = (user.factors || []).find((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
    if (verified && !/^\d{6}$/.test(totpCode)) throw fail('Enter the six-digit code from your authenticator.', 400);
    await auth.signIn(user.email, password); sameUser(uid);
    if (verified) await accountClient.verifyFactor(verified.id, totpCode);
    return accountClient.getUser();
  },
  signOutOthers: () => authorized('/auth/v1/logout?scope=others', { method: 'POST' }),
  enrollTOTP: (friendlyName) => authorized('/auth/v1/factors', { method: 'POST', body: { factor_type: 'totp', friendly_name: friendlyName || 'My authenticator', issuer: 'Fieldnote' } }),
  async verifyFactor(id, code) {
    if (!/^\d{6}$/.test(code)) throw fail('Enter the six-digit authenticator code.', 400);
    const path = '/auth/v1/factors/' + factorId(id);
    const challenge = await authorized(path + '/challenge', { method: 'POST', body: {} });
    const next = await authorized(path + '/verify', { method: 'POST', body: { challenge_id: challenge.id, code } });
    await auth.adoptSession(next);
    return next;
  },
  unenrollFactor: (id) => authorized('/auth/v1/factors/' + factorId(id), { method: 'DELETE' }),
  async connectGoogle() {
    const uid = session()?.user.id, verifier = toBase64url(crypto.getRandomValues(new Uint8Array(48)));
    try { sessionStorage.setItem('fw-pkce', JSON.stringify({ verifier, at: Date.now(), userId: uid })); }
    catch { throw fail('Allow browser storage before connecting Google.'); }
    const challenge = toBase64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const query = new URLSearchParams({ provider: 'google', redirect_to: location.origin + location.pathname,
      code_challenge_method: 's256', code_challenge: challenge, skip_http_redirect: 'true' });
    const result = await authorized('/auth/v1/user/identities/authorize?' + query);
    sameUser(uid);
    let url;try{url=new URL(result?.url);}catch{throw fail('Google linking returned an invalid address.',502);}
    if (url.protocol !== 'https:') throw fail('Google linking returned an invalid address.', 502);
    location.assign(url.href);
  },
  async unlinkGoogle() {
    const uid=session()?.user.id,user=await accountClient.getUser();sameUser(uid);
    const identities=Array.isArray(user.identities)?user.identities:[],identity=identities.find(item=>item.provider==='google');
    if(!identity)throw fail('Google is not connected to this account. Refresh Account.',409);
    if(identities.length<2)throw fail('Keep another sign-in method before removing Google. Connect and verify another method first.',409);
    if(typeof identity.identity_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.identity_id))throw fail('Google connection details are unavailable. Refresh Account before trying again.',502);
    await authorized('/auth/v1/user/identities/'+encodeURIComponent(identity.identity_id),{method:'DELETE'});
    sameUser(uid);return identity.identity_id;
  },
  async uploadAvatar(blob) {
    const uid = session()?.user.id; if (!uid) throw fail('Sign in before uploading a photo.', 401);
    if (blob?.type !== 'image/webp' || blob.size > 1024*1024) throw fail('Prepare the profile photo before uploading it.', 400);
    const path = `${uid}/avatar.webp`;
    await direct(`/storage/v1/object/${AVATAR_BUCKET}/${path}`, { method: 'POST', body: blob, binary: true });
    sameUser(uid); return path;
  },
  async avatarURL(path) {
    const uid = session()?.user.id; if (!path || !uid || !path.startsWith(uid+'/')) return null;
    const result = await direct(`/storage/v1/object/sign/${AVATAR_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, { method:'POST',body:{expiresIn:300} });
    if(typeof result?.signedURL!=='string'||!result.signedURL.startsWith('/object/sign/'))throw fail('The profile photo address was unavailable.',502);
    return getPublicConfig().url + '/storage/v1' + result.signedURL;
  },
  async removeAvatar(path) {
    const uid = session()?.user.id; if (!path || !uid || !path.startsWith(uid+'/')) throw fail('This profile photo does not belong to your account.', 403);
    await direct('/storage/v1/object/'+AVATAR_BUCKET, { method:'DELETE',body:{prefixes:[path]} });
  },
  availability: () => direct('/api/account'),
  changeEmail: (email) => direct('/api/account', { method:'POST',body:{action:'change_email',email} }),
  changePassword: (password, nonce = '', currentPassword = '') => direct('/api/account', { method:'POST',body:{action:'change_password',password,nonce,current_password:currentPassword} }),
  deleteAccount: (email) => direct('/api/account', { method:'DELETE',body:{confirmation:'DELETE MY ACCOUNT',email} }),
};
