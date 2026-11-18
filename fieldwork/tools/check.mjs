// Read-only checks for this Stage 3 application. No application or API code is executed.
// Run: node --experimental-vm-modules tools/check.mjs
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const problems = [];
const assets = new Set();
const modules = new Map();
const sources = new Map();
const rel = (file) => path.relative(root, file).replaceAll(path.sep, '/');

async function filesIn(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tools', 'tests', 'preview', 'docs', 'db'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else files.push(file);
  }
  return files;
}

function addAsset(reference, from) {
  if (!reference || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return;
  const urlPath = reference.split(/[?#]/)[0];
  if (!urlPath || urlPath.startsWith('/api/')) return;
  const decoded = decodeURIComponent(urlPath);
  assets.add(decoded === '/' ? path.join(root, 'index.html') : decoded.startsWith('/')
    ? path.join(root, decoded.slice(1)) : path.resolve(path.dirname(from), decoded));
}

async function check() {
  if (!vm.SourceTextModule) throw new Error('Use node --experimental-vm-modules tools/check.mjs.');
  const files = await filesIn(root);
  let apiCount = 0;
  for (const file of files.filter((file) => file.endsWith('.js'))) {
    const source = await readFile(file, 'utf8');
    sources.set(file, source);
    try {
      if (rel(file).startsWith('api/')) {
        // Vercel API handlers in this repository use CommonJS.
        new vm.Script(source, { filename: file });
        apiCount++;
      } else modules.set(file, new vm.SourceTextModule(source, { identifier: file }));
    } catch (error) { problems.push(`${rel(file)}: ${error.message}`); }
  }
  for (const [file, module] of modules) {
    if (module.status !== 'unlinked') continue;
    try {
      await module.link((specifier, parent) => {
        if (!specifier.startsWith('.')) throw new Error(`Unsupported browser import ${specifier}`);
        const target = path.resolve(path.dirname(parent.identifier), specifier);
        if (!modules.has(target)) throw new Error(`Missing browser module ${rel(target)}`);
        return modules.get(target);
      });
    } catch (error) { problems.push(`${rel(file)}: ${error.message}`); }
  }

  // The app dispatches navigation through the imported modules namespace.
  const app = sources.get(path.join(root, 'js', 'app.js')) || '';
  const routeList = /const\s+MODULES\s*=\s*\[([\s\S]*?)\];/.exec(app)?.[1] || '';
  const routes = [...routeList.matchAll(/\[\s*['"](\w+)['"]\s*,/g)].map((match) => match[1]);
  if (!routes.length) problems.push('No navigation routes found in js/app.js.');
  const views = modules.get(path.join(root, 'js', 'modules.js'));
  const names = views?.status === 'linked' ? Reflect.ownKeys(views.namespace) : [];
  for (const route of routes) {
    if (route !== 'overview' && !names.includes(route)) problems.push(`Navigation route ${route} has no exported module.`);
  }

  const index = path.join(root, 'index.html');
  const html = await readFile(index, 'utf8');
  for (const match of html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi)) addAsset(match[1], index);
  for (const file of files.filter((file) => file.endsWith('.css'))) {
    const css = await readFile(file, 'utf8');
    for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) addAsset(match[1], file);
  }
  for (const file of files.filter((file) => file.endsWith('.webmanifest'))) {
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    for (const icon of manifest.icons || []) addAsset(icon.src, file);
  }
  for (const file of assets) {
    try { if (!(await stat(file)).isFile()) throw new Error('not a file'); }
    catch { problems.push(`Missing local asset: ${rel(file)}`); }
  }

  // Preserve this repository's hosting policy. If a CSP is introduced later,
  // catch a stale hash that would block the inline theme initialization.
  const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const policies = (vercel.headers || []).flatMap((block) => block.headers || [])
    .filter((header) => header.key.toLowerCase() === 'content-security-policy').map((header) => header.value);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const hash = `'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`;
    for (const policy of policies) {
      const directive = /(?:^|;)\s*script-src\s+([^;]+)/.exec(policy)?.[1]
        || /(?:^|;)\s*default-src\s+([^;]+)/.exec(policy)?.[1];
      if (!directive) continue;
      const tokens = directive.split(/\s+/);
      const permitsInline = tokens.includes("'unsafe-inline'") && !tokens.some((token) => /^'(?:sha\d+-|nonce-)/.test(token));
      if (!permitsInline && !tokens.includes(hash)) problems.push('Configured CSP blocks the inline theme script; update its hash.');
    }
  }

  if (problems.length) {
    console.error(`Checks failed (${problems.length}):`);
    problems.forEach((problem) => console.error(`- ${problem}`));
    process.exitCode = 1;
  } else {
    console.log(`Passed: ${modules.size} browser modules link, ${apiCount} API handler${apiCount === 1 ? '' : 's'} parse, ${routes.length} navigation routes resolve, ${assets.size} local assets exist.`);
    console.log(policies.length ? 'Configured CSP permits the inline theme script.' : 'No CSP header is configured; hosting policy is unchanged.');
    console.log('No live Supabase requests or database migration checks were performed.');
  }
}

check().catch((error) => { console.error(error.message); process.exitCode = 1; });
