import { button, field, tabs, notice, escapeHTML as esc } from './components.js';

// Auth uses the same controls and inline validation as the rest of the app.
export function formErrors(form, errors = {}) {
  let first;
  for (const input of form.querySelectorAll('[name]')) {
    const target = form.querySelector(`[data-error-for="${input.name}"]`), message = errors[input.name] || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (target) { target.textContent = message; target.hidden = !message; }
    if (message && !first) first = input;
  }
  first?.focus(); return !first;
}
export function busy(button, state) { button.disabled = state; button.setAttribute('aria-busy', String(state)); }
export function wirePasswords(form) {
  form.querySelectorAll('input[type=password]').forEach((input) => {
    input.insertAdjacentHTML('afterend', button({ label: 'Show password', variant: 'ghost', size: 'sm', attrs: { 'data-password-for': input.id, 'aria-controls': input.id, 'aria-pressed': 'false' } }));
  });
  form.querySelectorAll('[data-password-for]').forEach((toggle) => { toggle.onclick = () => {
    const input = form.querySelector(`[id="${toggle.dataset.passwordFor}"]`), shown = input.type === 'password';
    input.type = shown ? 'text' : 'password'; toggle.setAttribute('aria-pressed', String(shown)); toggle.querySelector('span').textContent = shown ? 'Hide password' : 'Show password';
  }; });
}
const emailError = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? '' : 'Enter a valid email address.';

export function renderAuth(container, { auth, onSignedIn, brand, invitePending = false }, mode = 'in', savedEmail = '') {
  window.onhashchange = null;
  const up = mode === 'up', magic = mode === 'magic', recover = mode === 'recover', verify = mode === 'verify';
  const title = up ? 'Create your account' : magic ? 'Email me a sign-in link' : recover ? 'Reset your password' : verify ? 'Verify your email' : 'Welcome back';
  const primary = up ? 'Create account' : magic ? 'Send sign-in link' : recover ? 'Send reset link' : verify ? 'Resend verification email' : 'Sign in';
  container.innerHTML = `<div class="center auth-screen"><main class="panel auth-panel">${brand()}<h1>${title}</h1><p class="muted">${invitePending ? 'Sign in with the invited email to join your team.' : 'Your farms, people and plans. One clear workspace.'}</p>
    ${tabs([{ id: 'in', label: 'Sign in' }, { id: 'up', label: 'Create account' }], { label: 'Account access', active: up ? 'up' : 'in' })}
    <form id="auth" novalidate>${up ? field({ label: 'Your name', name: 'name', required: true, attrs: { autocomplete: 'name', maxlength: 120 } }) : ''}
    ${field({ label: 'Email address', name: 'email', type: 'email', value: savedEmail, required: true, attrs: { autocomplete: 'email', inputmode: 'email', autocapitalize: 'none' } })}
    ${!magic && !recover && !verify ? field({ label: 'Password', name: 'password', type: 'password', required: true, hint: up ? 'Use at least 8 characters.' : '', attrs: { autocomplete: up ? 'new-password' : 'current-password', minlength: up ? 8 : 1 } }) : ''}
    <div id="auth-message" aria-live="polite"></div>${button({ label: primary, type: 'submit', attrs: { id: 'auth-submit' } })}
    </form><div class="auth-links">${!up && !recover && !verify ? button({ label: magic ? 'Use a password' : 'Use a magic link', variant: 'ghost', attrs: { 'data-mode': magic ? 'in' : 'magic' } }) : ''}
    ${!up && !recover && !magic && !verify ? button({ label: 'Forgot password?', variant: 'ghost', attrs: { 'data-mode': 'recover' } }) : ''}
    ${recover || verify ? button({ label: 'Back to sign in', variant: 'ghost', attrs: { 'data-mode': 'in' } }) : ''}</div>
    ${!recover && !verify ? `<div id="auth-google-option" hidden><div class="auth-divider"><span>or</span></div>${button({ label: 'Continue with Google', variant: 'secondary', attrs: { id: 'google',disabled:true } })}</div><div id="auth-provider-message" aria-live="polite"></div>` : ''}
    <p class="caption muted">${up ? 'Create an account to set up your farm workspace.' : 'Sign in securely with the account you use for your workspace.'}</p></main></div>`;
  const form = container.querySelector('#auth'), message = container.querySelector('#auth-message');
  const controls=[...container.querySelectorAll('button')];let requestPending=false,googleAvailable=false;
  const current=()=>container.querySelector('#auth')===form;
  const pending=(state)=>{requestPending=state;controls.forEach(control=>control.disabled=state);form.setAttribute('aria-busy',String(state));};
  const change = (next) => renderAuth(container, { auth, onSignedIn, brand, invitePending }, next, form.elements.email.value);
  const providerSlot=container.querySelector('#auth-google-option'),providerMessage=container.querySelector('#auth-provider-message');
  const loadProviders=async(refresh=false)=>{if(!providerSlot)return;try{const options=await auth.capabilities({refresh});if(!current())return;googleAvailable=options.google===true;providerSlot.hidden=!googleAvailable;container.querySelector('#google').disabled=requestPending||!googleAvailable;providerMessage.innerHTML='';}
    catch(error){if(!current())return;googleAvailable=false;providerSlot.hidden=true;providerMessage.innerHTML=notice({text:'Other sign-in options are temporarily unavailable. '+error.message,tone:'warning',action:button({label:'Try again',variant:'ghost',attrs:{id:'provider-retry'}})});providerMessage.querySelector('#provider-retry')?.addEventListener('click',()=>loadProviders(true));}};
  loadProviders();
  container.querySelectorAll('[data-tab], [data-mode]').forEach((tab) => { tab.onclick = () => {if(!requestPending)change(tab.dataset.tab || tab.dataset.mode);}; });
  wirePasswords(form);
  container.querySelector('#google')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget; if (btn.disabled) return; pending(true);busy(btn, true); message.innerHTML = '';
    try { await auth.google(); } catch (error) { if(current())message.innerHTML = notice({ text: error.message, tone: 'negative' }); pending(false);busy(btn, false); }
  });
  form.onsubmit = async (event) => {
    event.preventDefault(); const btn = form.querySelector('[type=submit]'); if (btn.disabled) return;
    const values = Object.fromEntries(new FormData(form)), errors = { email: emailError(values.email) };
    if (up && !values.name.trim()) errors.name = 'Enter your name.';
    if ('password' in values && values.password.length < (up ? 8 : 1)) errors.password = up ? 'Use at least 8 characters.' : 'Enter your password.';
    if (!formErrors(form, errors)) return;
    pending(true);busy(btn, true); message.innerHTML = '';
    try {
      if (magic || recover || verify) {
        await (magic ? auth.magicLink(values.email) : recover ? auth.reset(values.email) : auth.resendVerification(values.email));
        message.innerHTML = notice({ title: 'Check your email', text: magic ? 'If this email has an account, a sign-in link will arrive shortly. The link can be used once.' : recover ? 'If this email has an account, a reset link will arrive shortly.' : 'A fresh verification link has been requested. Check your inbox and spam folder.', tone: 'positive' });
      } else {
        if (up) { const result = await auth.signUp(values.email, values.password, values.name.trim()); if(!current())return;if (!result.signedIn) return change('verify'); }
        else await auth.signIn(values.email, values.password);
        if(!current())return;
        await onSignedIn();
      }
    } catch (error) {
      if(!current())return;
      const guidance=!up&&!magic&&!recover&&!verify&&[400,401].includes(error.status)&&!/confirm|verif/i.test(error.message)?` If you joined with another sign-in method, try ${googleAvailable?'Google or a magic link':'a magic link'}.`:'';
      message.innerHTML = notice({ text: error.message+guidance, tone: 'negative', action: /confirm|verif/i.test(error.message) ? button({ label: 'Resend verification', variant: 'ghost', attrs: { id: 'verify-email' } }) : '' });
      message.querySelector('#verify-email')?.addEventListener('click', () => change('verify'));
    } finally { pending(false);busy(btn, false); }
  };
}

export function renderInvitationVerification(container,{auth,email,needsRecovery,returnTo=location.hash,inviteToken='',isActive=()=>container.isConnected}){
  container.innerHTML=notice({title:needsRecovery?'Secure your account before joining':'Verify your email to continue',text:needsRecovery?'Open the recovery email and choose a new password. This ends other sign-ins before incoming invitations become available.':'Open a fresh email sign-in link to review and respond to your invitations.'})+`<p>The link is sent to ${esc(email)}. Open the latest link in this same browser; a new tab is fine.</p>${button({label:needsRecovery?'Send recovery email':'Send verification link',attrs:{'data-invite-proof':true}})}<div data-invite-proof-message aria-live="polite"></div>`;
  const control=container.querySelector('[data-invite-proof]'),message=container.querySelector('[data-invite-proof-message]');
  control.onclick=async()=>{if(control.disabled||!isActive())return;busy(control,true);const options={invitation:true,returnTo,...(inviteToken?{inviteToken}:{})};try{await(needsRecovery?auth.reset(email,options):auth.magicLink(email,options));if(isActive())message.innerHTML=notice({title:'Check your email',text:'Open the latest link in this same browser to continue. Your invitation is preserved.',tone:'positive'});}catch(error){if(isActive())message.innerHTML=notice({text:error.message,tone:'negative'});}finally{if(isActive())busy(control,false);}};
}

export function renderReset(container, { auth, onSignedIn, brand, invitationRecovery = false,isActive=()=>true,onSessionEnded,onRecoveryExpired }) {
  window.onhashchange = null;
  const recovery=auth.recoveryPending?.();let passwordSaved=recovery?.passwordSaved===true,verificationFinished=false;
  container.innerHTML = `<div class="center auth-screen"><main class="panel auth-panel">${brand()}<h1>${passwordSaved?'Finish email verification':'Choose a new password'}</h1><p class="muted">${invitationRecovery?'Save a new password to end other sign-ins, then finish verification before reviewing incoming invitations.':'Use a password you haven’t used on this account before.'}</p><form id="reset" novalidate>
    ${field({ label: 'New password', name: 'password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: { autocomplete: 'new-password', minlength: 8 } })}
    ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', required: true, attrs: { autocomplete: 'new-password', minlength: 8 } })}
    <div id="reset-message" aria-live="polite"></div>${button({ label: 'Save new password', type: 'submit' })}</form></main></div>`;
  const form = container.querySelector('form'); wirePasswords(form);
  const sameForm=()=>container.querySelector('form')===form,current=()=>isActive()&&sameForm()&&(verificationFinished||!recovery?.userId||(auth.recoveryPending?.()?.userId===recovery.userId&&auth.recoveryPending?.()?.sessionId===recovery.sessionId));
  const expiredHere=()=>sameForm()&&isActive()&&recovery?.userId&&!auth.recoveryPending?.()&&auth.isRecoverySession?.(recovery)===true;
  const saved=()=>{form.querySelectorAll('input').forEach(input=>input.disabled=true);form.querySelector('[type=submit]').textContent='Finish verification';};if(passwordSaved)saved();
  form.onsubmit = async (event) => {
    event.preventDefault(); const btn = form.querySelector('[type=submit]'); if (btn.disabled) return;
    if(!current()){if(expiredHere()){const message=container.querySelector('#reset-message');message.innerHTML=notice({title:'Recovery link expired',text:'Request a new recovery email before continuing. Your invitation is preserved.',tone:'warning',action:onRecoveryExpired?button({label:'Request a new link',variant:'secondary',attrs:{'data-reset-new-link':true}}):''});message.querySelector('[data-reset-new-link]')?.addEventListener('click',()=>{if(expiredHere())onRecoveryExpired();});}return;}
    const values = Object.fromEntries(new FormData(form));
    if (!passwordSaved&&!formErrors(form, { password: values.password.length < 8 ? 'Use at least 8 characters.' : '', confirm: values.password !== values.confirm ? 'The passwords don’t match.' : '' })) return;
    busy(btn, true);
    try {if(!passwordSaved){await auth.updatePassword(values.password);if(!current())return;passwordSaved=true;auth.markRecoveryPasswordSaved?.();saved();}
      if(invitationRecovery)await auth.completeInviteRecovery();if(!current())return;verificationFinished=true;auth.finishRecovery?.();await onSignedIn(); }
    catch (error) {if(sameForm()&&error.status===401)onSessionEnded?.();if(sameForm()&&(current()||error.status===401))container.querySelector('#reset-message').innerHTML = notice({ text: (passwordSaved?'Your password was saved. ':'')+error.message, tone: 'negative' }); }
    finally { if(sameForm())busy(btn, false); }
  };
}
