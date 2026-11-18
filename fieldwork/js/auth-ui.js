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
    ${!recover && !verify ? `<div class="auth-divider"><span>or</span></div>${button({ label: 'Continue with Google', variant: 'secondary', attrs: { id: 'google' } })}` : ''}
    <p class="caption muted">${up ? 'We’ll send an email to verify your address before you start.' : 'Sign in securely with the account you use for your workspace.'}</p></main></div>`;
  const form = container.querySelector('#auth'), message = container.querySelector('#auth-message');
  const controls=[...container.querySelectorAll('button')];let requestPending=false;
  const current=()=>container.querySelector('#auth')===form;
  const pending=(state)=>{requestPending=state;controls.forEach(control=>control.disabled=state);form.setAttribute('aria-busy',String(state));};
  const change = (next) => renderAuth(container, { auth, onSignedIn, brand, invitePending }, next, form.elements.email.value);
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
      const guidance=!up&&!magic&&!recover&&!verify&&[400,401].includes(error.status)&&!/confirm|verif/i.test(error.message)?' If you joined with another sign-in method, try Google or a magic link.':'';
      message.innerHTML = notice({ text: error.message+guidance, tone: 'negative', action: /confirm|verif/i.test(error.message) ? button({ label: 'Resend verification', variant: 'ghost', attrs: { id: 'verify-email' } }) : '' });
      message.querySelector('#verify-email')?.addEventListener('click', () => change('verify'));
    } finally { pending(false);busy(btn, false); }
  };
}

export function renderReset(container, { auth, onSignedIn, brand }) {
  window.onhashchange = null;
  container.innerHTML = `<div class="center auth-screen"><main class="panel auth-panel">${brand()}<h1>Choose a new password</h1><p class="muted">Use a password you haven’t used on this account before.</p><form id="reset" novalidate>
    ${field({ label: 'New password', name: 'password', type: 'password', required: true, hint: 'At least 8 characters.', attrs: { autocomplete: 'new-password', minlength: 8 } })}
    ${field({ label: 'Confirm new password', name: 'confirm', type: 'password', required: true, attrs: { autocomplete: 'new-password', minlength: 8 } })}
    <div id="reset-message" aria-live="polite"></div>${button({ label: 'Save new password', type: 'submit' })}</form></main></div>`;
  const form = container.querySelector('form'); wirePasswords(form);
  form.onsubmit = async (event) => {
    event.preventDefault(); const btn = form.querySelector('[type=submit]'); if (btn.disabled) return;
    const values = Object.fromEntries(new FormData(form));
    if (!formErrors(form, { password: values.password.length < 8 ? 'Use at least 8 characters.' : '', confirm: values.password !== values.confirm ? 'The passwords don’t match.' : '' })) return;
    busy(btn, true);
    try { await auth.updatePassword(values.password); await onSignedIn(); }
    catch (error) { container.querySelector('#reset-message').innerHTML = notice({ text: error.message, tone: 'negative' }); }
    finally { busy(btn, false); }
  };
}
