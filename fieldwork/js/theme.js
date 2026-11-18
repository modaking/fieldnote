// ES module. Stage 1 wires this to the top-bar toggle and the profiles.theme_pref sync.
const KEY = 'fw-theme';
const CHROME = { light: '#F5F1E6', dark: '#0E1A14' };
const mq = matchMedia('(prefers-color-scheme: dark)');

const normalise = (pref) => ['light', 'dark', 'system'].includes(pref) ? pref : 'system';
export const getPref = () => { try { return normalise(localStorage.getItem(KEY)); } catch { return 'system'; } };
const resolve = (p) => (p === 'system' ? (mq.matches ? 'dark' : 'light') : p);

export function applyTheme(pref = getPref()) {
  pref = normalise(pref);
  const t = resolve(pref), root = document.documentElement;
  root.setAttribute('data-theme', t);
  root.setAttribute('data-theme-pref', pref);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[t]);
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t, pref } }));
  return t;
}

/** pref: 'light' | 'dark' | 'system'. syncRemote(pref) is injected by the app (Supabase profile update). */
export function setPref(pref, syncRemote) {
  pref = normalise(pref);
  try { localStorage.setItem(KEY, pref); } catch {}
  applyTheme(pref);
  syncRemote?.(pref)?.catch?.(() => {});   // best effort; localStorage wins on this device
}

mq.addEventListener('change', () => getPref() === 'system' && applyTheme('system'));

// Printing and PDF export are always light.
let before;
addEventListener('beforeprint', () => { before = document.documentElement.getAttribute('data-theme'); document.documentElement.setAttribute('data-theme', 'light'); });
addEventListener('afterprint', () => document.documentElement.setAttribute('data-theme', before || resolve(getPref())));
