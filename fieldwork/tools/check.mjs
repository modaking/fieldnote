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

// Read registry literals without evaluating application code. The regular module
// linker still verifies every static named import; these checks cover dispatch
// tables whose property accesses cannot be validated by the JavaScript linker.
function registry(source,name){
  const body=new RegExp(`export\\s+const\\s+${name}\\s*=\\s*Object\\.freeze\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`).exec(source)?.[1];
  if(body==null){problems.push(`Navigation registry ${name} is missing its static array.`);return [];}
  return [...body.matchAll(/\{([^{}]*)\}/g)].map(([_,entry])=>Object.fromEntries([...entry.matchAll(/(\w+)\s*:\s*['"]([^'"]*)['"]/g)].map(m=>[m[1],m[2]])));
}
function pieces(source,separator=null){
  const stack=[];let quote='',comment='',start=0;const output=[];
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(comment==='line'){if(c==='\n')comment='';continue;}
    if(comment==='block'){if(c==='*'&&next==='/'){comment='';i++;}continue;}
    if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
    if(c==='/'&&next==='/'){comment='line';i++;continue;}if(c==='/'&&next==='*'){comment='block';i++;continue;}
    if(['"',"'",'`'].includes(c)){quote=c;continue;}
    if('({['.includes(c))stack.push(c);
    if(')}]'.includes(c)){if(!stack.length)return separator?output:[source.slice(0,i),i];stack.pop();}
    if(separator&&c===separator&&!stack.length){output.push(source.slice(start,i).trim());start=i+1;}
  }
  return separator?[...output,source.slice(start).trim()].filter(Boolean):null;
}
function callable(expression,file,seen=new Set()){
  const value=expression.trim();if(/^(?:async(?=\s|\()\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/.test(value))return true;
  const name=/^[A-Za-z_$][\w$]*$/.test(value)?value:null,source=sources.get(file)||'',key=`${file}:${value}`;
  if(seen.has(key))return false;seen.add(key);
  if(name){
    if(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(source))return true;
    const assignment=new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*((?:async(?=\\s|\\()\\s*)?(?:function\\b|\\([^)]*\\)\\s*=>|[\\w$]+\\s*=>))`).exec(source);
    if(assignment)return true;
    for(const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)){
      const entry=match[1].split(',').map(s=>s.trim().split(/\s+as\s+/)).find(([original,alias])=>(alias||original)===name);
      if(entry)return callable(entry[0],path.resolve(path.dirname(file),match[2]),seen);
    }
  }
  const member=/^(\w+)\.(\w+)$/.exec(value);
  if(member)for(const match of source.matchAll(/import\s*\*\s*as\s*(\w+)\s*from\s*['"]([^'"]+)['"]/g))if(match[1]===member[1])return callable(member[2],path.resolve(path.dirname(file),match[2]),seen);
  return false;
}

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

  // Legacy module URLs are aliases. Five top-level pages dispatch through the
  // navigation registry to real, callable section renderers.
  const app = sources.get(path.join(root, 'js', 'app.js')) || '';
  const routeList = /const\s+MODULES\s*=\s*\[([\s\S]*?)\];/.exec(app)?.[1] || '';
  const routes = [...routeList.matchAll(/\[\s*['"](\w+)['"]\s*,/g)].map((match) => match[1]);
  if (!routes.length) problems.push('No navigation routes found in js/app.js.');
  const views = modules.get(path.join(root, 'js', 'modules.js'));
  const names = views?.status === 'linked' ? Reflect.ownKeys(views.namespace) : [];
  const dedicated = {
    overview: { file: 'dashboard.js', exported: 'dashboard', dynamic:true }, settings: { local: 'renderSettings' },
    reports: { file: 'reports.js', exported: 'renderReports' },
    members: { file: 'members.js', exported: 'members' },
    account: { file:'account.js',exported:'account' },
  };
  for (const route of routes) {
    if (names.includes(route)) continue;
    const handler = dedicated[route];
    if (!handler) { problems.push(`Navigation route ${route} has no module or dedicated handler.`); continue; }
    if (handler.local && !new RegExp(`(?:async\\s+)?function\\s+${handler.local}\\s*\\(`).test(app)) problems.push(`Navigation route ${route} is missing ${handler.local}.`);
    if (handler.file) {
      const target = modules.get(path.join(root, 'js', handler.file));
      if (target?.status !== 'linked' || !Reflect.ownKeys(target.namespace).includes(handler.exported)) problems.push(`Navigation route ${route} is missing ${handler.file}:${handler.exported}.`);
      if(handler.dynamic){if(!new RegExp(`import\\(['"]\\./${handler.file.replace('.','\\.')}['"]\\)`).test(app))problems.push(`Navigation route ${route} has no dynamic import of ${handler.file}.`);}
      else if (!new RegExp(`S\\.route\\s*===\\s*['"]${route}['"]`).test(app)) problems.push(`Navigation route ${route} is not dispatched by the app.`);
    }
  }
  const navigationFile=path.join(root,'js','navigation.js'),navigation=sources.get(navigationFile)||'';
  const sections=registry(navigation,'SECTIONS'),pages=registry(navigation,'PAGES');
  if(!sections.length)problems.push('Navigation registry contains no leaf sections.');
  if(pages.length!==5||new Set(pages.map(p=>p.id)).size!==5)problems.push('Navigation must declare five distinct top-level pages.');
  const sectionIds=new Set(),moduleFile=path.join(root,'js','modules.js'),moduleSource=sources.get(moduleFile)||'';
  const viewStart=/export\s+const\s+moduleViews\s*=\s*(?:Object\.freeze\(\s*)?\{/.exec(moduleSource);
  const body=viewStart?pieces(moduleSource.slice(viewStart.index+viewStart[0].length))?.[0]:null;
  const leafViews=new Map();
  if(body==null||!names.includes('moduleViews'))problems.push('modules.js must export a static, nonempty moduleViews map.');
  else for(const raw of pieces(body,',')){
    const entry=raw.replace(/^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'').trim();if(!entry)continue;
    const match=/^(?:['"]([\w$]+)['"]|([\w$]+))\s*(?::\s*([\s\S]+))?$/.exec(entry);
    if(!match){problems.push(`Unrecognized moduleViews entry: ${entry.slice(0,60)}`);continue;}
    const key=match[1]||match[2];if(leafViews.has(key))problems.push(`Duplicate moduleViews renderer ${key}.`);
    leafViews.set(key,match[3]||key);
  }
  for(const section of sections){
    if(!section.id||!section.page||!section.module){problems.push('A navigation section is missing id/page/module.');continue;}
    if(sectionIds.has(section.id))problems.push(`Duplicate navigation section ${section.id}.`);sectionIds.add(section.id);
    if(!pages.some(page=>page.id===section.page))problems.push(`Section ${section.id} targets unknown page ${section.page}.`);
    if(!routes.includes(section.module))problems.push(`Section ${section.id} targets unknown business module ${section.module}.`);
    if(section.module==='members'&&['members','invitations'].includes(section.id))continue;
    if(!leafViews.has(section.id))problems.push(`Section ${section.id} has no moduleViews renderer.`);
    else if(!callable(leafViews.get(section.id),moduleFile))problems.push(`Section ${section.id} renderer ${leafViews.get(section.id)} does not resolve to a declared/imported function.`);
  }
  for(const key of leafViews.keys())if(!sectionIds.has(key))problems.push(`moduleViews renderer ${key} has no navigation section.`);
  const navigationUI=modules.get(path.join(root,'js','navigation-ui.js'));
  if(navigationUI?.status!=='linked'||!['renderSectionPage','openCommandPalette','openMoreNavigation'].every(name=>Reflect.ownKeys(navigationUI.namespace).includes(name)))problems.push('Section navigation renderer exports are missing.');

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
    console.log(`Passed: ${modules.size} browser modules link, ${apiCount} API handler${apiCount === 1 ? '' : 's'} parse, ${routes.length} module routes, ${pages.length} pages and ${sections.length} sections resolve, ${assets.size} local assets exist.`);
    console.log(policies.length ? 'Configured CSP permits the inline theme script.' : 'No CSP header is configured; hosting policy is unchanged.');
    console.log('No live Supabase requests or database migration checks were performed.');
  }
}

check().catch((error) => { console.error(error.message); process.exitCode = 1; });
