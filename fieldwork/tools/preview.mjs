// Local, in-memory sample backend for usability checks. Never connects to Supabase.
// Run: node tools/preview.mjs [port]   Sample login: owner@fieldwork.test / sample123
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4175);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid local port.');
const roles = ['owner', 'manager', 'worker'];
const date = new Date().toISOString().slice(0, 10), month = `${date.slice(0, 7)}-01`;
const at = `${date}T09:00:00Z`;
const tables = Object.fromEntries(['profiles','workspace_members','farms','categories','vendors','tasks','checklists','checklist_items',
  'checklist_runs','checklist_run_items','transactions','budgets','month_closings','recurring_payments','projects','enterprises',
  'enterprise_records','workers','funding_opportunities','fx_rates','seed_merchants','audit_log'].map((name) => [name, []]));
tables.workspaces = [{ id: 'workspace-a', name: 'ENKISHON sample workspace', currency: 'KES' }, { id: 'workspace-b', name: 'Second sample workspace', currency: 'USD' }];
tables.currencies = [{ code: 'KES', name: 'Kenyan shilling', exponent: 2 }, { code: 'USD', name: 'US dollar', exponent: 2 }, { code: 'UGX', name: 'Ugandan shilling', exponent: 0 }];
for (const role of roles) {
  tables.profiles.push({ id: `preview-${role}`, full_name: `Sample ${role}`, active_workspace: 'workspace-a', theme_pref: 'system' });
  for (const ws of tables.workspaces) tables.workspace_members.push({ user_id: `preview-${role}`, workspace_id: ws.id, role });
}
tables.farms = [{ id: 'farm-a', workspace_id: 'workspace-a', name: 'Ol Kalou sample farm', county: 'Nyandarua', location_text: 'Sample farm near Ol Kalou', created_at: at },
  { id: 'farm-b', workspace_id: 'workspace-a', name: 'Mashuru sample farm', county: 'Kajiado', location_text: 'Sample farm near Mashuru', created_at: at },
  { id: 'farm-other', workspace_id: 'workspace-b', name: 'Other workspace sample farm', created_at: at }];
for (const ws of tables.workspaces) for (const [key, name, kind] of [['seed','Seed','expense'],['feed','Feed','expense'],['labour','Labour','expense'],['sales','Crop sales','income']]) {
  tables.categories.push({ id: `${ws.id}-${key}`, workspace_id: ws.id, name, kind });
}
tables.tasks = [{ id: 'task-a', workspace_id: 'workspace-a', farm_id: 'farm-a', title: 'Inspect the water tank', cadence: 'once', status: 'open', due_date: date, created_at: at },
  { id: 'task-b', workspace_id: 'workspace-a', farm_id: null, title: 'Review today’s farm notes', cadence: 'daily', status: 'open', created_at: at },
  { id: 'task-other', workspace_id: 'workspace-b', farm_id: 'farm-other', title: 'Other workspace task', cadence: 'once', status: 'open', created_at: at }];
tables.transactions = [{ id: 'txn-a', workspace_id: 'workspace-a', farm_id: 'farm-a', kind: 'income', txn_date: date, amount: 1000000, currency: 'KES', fx_rate: 1, amount_base: 1000000, category_id: 'workspace-a-sales', description: 'Sample crop sale', created_at: at },
  { id: 'txn-b', workspace_id: 'workspace-a', farm_id: 'farm-b', kind: 'expense', txn_date: date, amount: 250000, currency: 'KES', fx_rate: 1, amount_base: 250000, category_id: 'workspace-a-feed', description: 'Sample feed purchase', created_at: at },
  { id: 'txn-other', workspace_id: 'workspace-b', farm_id: 'farm-other', kind: 'income', txn_date: date, amount: 123400, currency: 'USD', fx_rate: 1, amount_base: 123400, category_id: 'workspace-b-sales', description: 'Other workspace sale', created_at: at }];
tables.fx_rates = [{ workspace_id: 'workspace-a', currency: 'USD', rate: 129, as_of: date }, { workspace_id: 'workspace-a', currency: 'UGX', rate: 3.5, as_of: date }, { workspace_id: 'workspace-b', currency: 'KES', rate: 0.00775, as_of: date }];

const user = (role) => ({ id: `preview-${role}`, email: `${role}@fieldwork.test`, email_confirmed_at: at });
const token = (req) => roles.find((role) => req.headers.authorization === `Bearer preview-${role}`);
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const failure = (res, code, message) => json(res, code, { message });
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Sample request too large.'); }
  return text ? JSON.parse(text) : {};
}
function split(value) {
  const parts = []; let start = 0, depth = 0;
  for (let i = 0; i < value.length; i++) { if (value[i] === '(') depth++; if (value[i] === ')') depth--; if (value[i] === ',' && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; } }
  return [...parts, value.slice(start)];
}
function condition(row, key, expression) {
  const value = row[key], dot = expression.indexOf('.'), op = expression.slice(0, dot), expected = expression.slice(dot + 1);
  if (op === 'not') return !condition(row, key, expected);
  if (op === 'is') return expected === 'null' ? value == null : String(value) === expected;
  if (op === 'in') return split(expected.replace(/^\(|\)$/g, '')).map((s) => s.replace(/^"|"$/g, '')).includes(String(value));
  if (op === 'eq') return String(value) === expected;
  if (op === 'neq') return String(value) !== expected;
  const a = typeof value === 'number' ? value : String(value ?? ''), b = typeof value === 'number' ? Number(expected) : expected;
  return op === 'gte' ? a >= b : op === 'gt' ? a > b : op === 'lte' ? a <= b : op === 'lt' ? a < b : false;
}
function matches(row, params) {
  return [...params].every(([key, value]) => {
    if (['select','order','limit','offset','on_conflict'].includes(key)) return true;
    if (key === 'or') return split(value.replace(/^\(|\)$/g, '')).some((part) => { const dot = part.indexOf('.'); return condition(row, part.slice(0, dot), part.slice(dot + 1)); });
    return condition(row, key, value);
  });
}
function related(name, row) {
  if (name === 'workspace_members') return { ...row, workspaces: tables.workspaces.find((ws) => ws.id === row.workspace_id) };
  if (name === 'checklists') return { ...row, checklist_items: tables.checklist_items.filter((item) => item.checklist_id === row.id) };
  if (name === 'checklist_runs') return { ...row, checklist_run_items: tables.checklist_run_items.filter((item) => item.run_id === row.id) };
  return row;
}
function normalize(name, row) {
  const result = { ...row };
  if (name === 'tasks') { result.status ??= 'open'; result.cadence ??= 'once'; }
  if (name === 'transactions') {
    result.currency ??= tables.workspaces.find((ws) => ws.id === row.workspace_id)?.currency || 'KES';
    result.fx_rate = result.currency === tables.workspaces.find((ws) => ws.id === row.workspace_id)?.currency ? 1 : Number(result.fx_rate || 1);
    result.amount_base = Math.round(Number(result.amount) * result.fx_rate);
  }
  if (name === 'workers') result.active ??= true;
  return result;
}
async function rest(req, res, url) {
  const role = token(req), name = url.pathname.slice('/__preview/rest/v1/'.length);
  if (!role) return failure(res, 401, 'Use a sample @fieldwork.test account.');
  if (!tables[name]) return failure(res, 404, 'Sample table not found.');
  const readable = (row) => name === 'profiles' ? row.id === user(role).id : !row.workspace_id || tables.workspace_members.some((m) => m.user_id === user(role).id && m.workspace_id === row.workspace_id);
  let rows = tables[name].filter((row) => readable(row) && matches(row, url.searchParams));
  if (req.method === 'GET') {
    const order = url.searchParams.get('order') || '';
    if (['projects','enterprises'].includes(name) && order.split(',').some((part) => part.split('.')[0] === 'created_at')) return failure(res, 400, `column ${name}.created_at does not exist`);
    const fields = order.split(',').filter(Boolean).map((part) => part.split('.'));
    rows.sort((a, b) => { for (const [key, direction] of fields) { const x = a[key], y = b[key]; if (x === y) continue; return (x == null ? 1 : y == null ? -1 : x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1); } return 0; });
    const start = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
    return json(res, 200, rows.slice(start, start + limit).map((row) => related(name, row)));
  }
  const crew = ['tasks','checklist_runs','checklist_run_items','transactions'];
  if (role === 'worker' && (!crew.includes(name) || req.method === 'DELETE')) return failure(res, 403, 'This sample role cannot change that record.');
  if (req.method === 'DELETE') { tables[name] = tables[name].filter((row) => !rows.includes(row)); return json(res, 200, []); }
  const data = await body(req);
  if (req.method === 'PATCH') {
    const updated = rows.map((row) => { Object.assign(row, normalize(name, { ...row, ...data })); return row; });
    return json(res, 200, updated);
  }
  if (req.method !== 'POST') return failure(res, 405, 'Sample operation unsupported.');
  const conflict = (url.searchParams.get('on_conflict') || '').split(',').filter(Boolean), inserted = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if (item.workspace_id && !tables.workspace_members.some((m) => m.user_id === user(role).id && m.workspace_id === item.workspace_id)) return failure(res, 403, 'Sample workspace unavailable.');
    const existing = conflict.length && tables[name].find((row) => conflict.every((key) => row[key] === item[key]));
    if (existing) { Object.assign(existing, normalize(name, { ...existing, ...item })); inserted.push(existing); continue; }
    if (name === 'transactions' && item.source_type && tables.transactions.some((row) => row.source_type === item.source_type && row.source_id === item.source_id && row.source_period === item.source_period)) return failure(res, 409, 'This sample payment is already posted.');
    const row = normalize(name, { ...(!['projects','enterprises','categories','currencies','fx_rates'].includes(name) ? { created_at: new Date().toISOString() } : {}), id: randomUUID(), ...item });
    tables[name].push(row); inserted.push(row);
    if (name === 'workspaces') tables.workspace_members.push({ workspace_id: row.id, user_id: user(role).id, role: 'owner' });
  }
  return json(res, 201, inserted);
}

const server = http.createServer(async (req, res) => {
  try {
    const origin = `http://127.0.0.1:${server.address().port}`, url = new URL(req.url, origin);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'");
    if (url.pathname === '/api/config') return json(res, 200, { url: `${origin}/__preview`, anonKey: 'LOCAL_PREVIEW_NOT_A_KEY' });
    if (url.pathname.startsWith('/__preview/auth/v1/')) {
      const data = req.method === 'GET' ? {} : await body(req);
      if (url.pathname.endsWith('/token') || url.pathname.endsWith('/signup')) {
        if (data.email && !/^[^@]+@fieldwork\.test$/i.test(data.email)) return failure(res, 400, 'Use owner@fieldwork.test, manager@fieldwork.test or worker@fieldwork.test.');
        const role = roles.find((r) => data.email?.toLowerCase().startsWith(r) || data.refresh_token === `preview-refresh-${r}`) || 'owner';
        return json(res, 200, { access_token: `preview-${role}`, refresh_token: `preview-refresh-${role}`, expires_in: 3600, user: user(role) });
      }
      if (url.pathname.endsWith('/user')) return token(req) ? json(res, 200, user(token(req))) : failure(res, 401, 'Sample session expired.');
      if (url.pathname.endsWith('/recover') || url.pathname.endsWith('/logout')) return json(res, 200, {});
      return failure(res, 404, 'Sample auth operation unsupported.');
    }
    if (url.pathname.startsWith('/__preview/rest/v1/')) return await rest(req, res, url);
    const pathname = decodeURIComponent(url.pathname), localPath = pathname === '/' ? '/index.html' : pathname;
    if (!/^\/(?:index\.html|icon\.svg|manifest\.webmanifest|(?:css|js)\/[\w./-]+\.(?:css|js))$/.test(localPath)) return failure(res, 404, 'Only application assets are served.');
    const file = path.resolve(root, `.${localPath}`);
    if (!file.startsWith(root)) return failure(res, 403, 'Unavailable path.');
    let content = await readFile(file);
    if (localPath === '/index.html') content = Buffer.from(content.toString().replace('<body>', '<body><aside role="status" style="padding:10px 16px;background:#fff1c2;color:#382700;border-bottom:2px solid #916400;font:600 14px system-ui">LOCAL SAMPLE PREVIEW — invented records only. Changes stay in memory. Sign in as owner@fieldwork.test, manager@fieldwork.test or worker@fieldwork.test with sample123.</aside>'));
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(content);
  } catch (error) { failure(res, error.code === 'ENOENT' ? 404 : 400, error.code === 'ENOENT' ? 'Sample asset not found.' : error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local sample preview: http://127.0.0.1:${server.address().port} — memory only; no Supabase connection.`));
