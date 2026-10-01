const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const S = require('./public/shared.js');
const createStore = require('./storage');
try { for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch {}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const store = createStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const now = () => new Date().toISOString();
const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, no) => {
  let b = '', n = 0;
  req.on('data', (c) => { n += c.length; if (n > 25e6) { no(new Error('Body too large')); req.destroy(); } else b += c; });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(new Error('Bad JSON')); } });
});

// ---- auth: name + PIN login, cookie sessions, roles
const ROLES = { staff: 1, manager: 2, admin: 3 };
const SESSION_DAYS = 14;
const hashPin = (pin, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pin), salt, 32).toString('hex') });
const pinOk = (u, pin) => {
  const a = Buffer.from(hashPin(pin, u.salt).hash, 'hex'), b = Buffer.from(u.hash || '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const validPin = (pin) => /^\d{4,8}$/.test(String(pin || ''));
const publicUser = (u) => u && { id: u.id, name: u.name, role: u.role, active: u.active !== false, createdAt: u.createdAt };
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const sessionCache = new Map(); // token -> { userId, expires }
async function currentUser(req) {
  const tok = cookies(req).sid;
  if (!tok || !/^[a-f0-9]{48}$/.test(tok)) return null;
  let sess = sessionCache.get(tok);
  if (!sess) { sess = await store.get('sessions', tok); if (sess) sessionCache.set(tok, sess); }
  if (!sess || sess.expires < now()) return null;
  const u = await store.get('users', sess.userId);
  return u && u.active !== false ? u : null;
}
async function startSession(res, req, user) {
  const tok = crypto.randomBytes(24).toString('hex');
  const sess = { id: tok, userId: user.id, expires: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() };
  await store.put('sessions', tok, sess); sessionCache.set(tok, sess);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
const loginFails = new Map(); // userId -> { n, until }
const httpError = (code, error) => Object.assign(new Error(error), { code });
// managers manage staff; only admins touch managers/admins
const canManage = (actor, role) => actor.role === 'admin' || (actor.role === 'manager' && role === 'staff');

// ---- media: move data-URL photos/signatures to storage (Firebase Storage in firebase mode)
async function offloadMedia(run) {
  for (const [qid, a] of Object.entries(run.answers || {})) {
    if (typeof a.value === 'string' && a.value.startsWith('data:'))
      a.value = await store.putFile(`runs/${run.id}/${qid}-sig-${Date.now()}.png`, a.value);
    if (a.photos) a.photos = await Promise.all(a.photos.map((p, i) =>
      p.startsWith('data:') ? store.putFile(`runs/${run.id}/${qid}-${Date.now()}-${i}.jpg`, p) : p));
  }
}
// lists never ship inline media
function light(run) {
  const { answers, ...rest } = run;
  return { ...rest, photoCount: Object.values(answers || {}).reduce((n, a) => n + (a.photos ? a.photos.length : 0), 0) };
}

function applyScore(run) {
  const r = S.score(run.checklist, run.answers);
  Object.assign(run, { percent: r.percent, earned: r.earned, max: r.max, progress: r.progress, passed: r.passed, fails: r.fails, criticalFails: r.criticalFails });
}

async function seed() {
  if ((await store.list('checklists')).length) return;
  const q = (type, label, extra = {}) => Object.assign(S.newQuestion(type), { label }, extra);
  const list = [
    { name: 'Opening Kitchen Audit', category: 'Opening', frequency: 'daily', dueTime: '09:00', passScore: 85, description: 'Complete before first service.',
      questions: [
        q('section', 'Hygiene & Safety'),
        q('passfail', 'Hand-wash stations stocked (soap, paper towels)', { critical: true, noteOn: 'fail', photoOn: 'fail' }),
        q('yesno', 'Any signs of pests?', { passOn: 'no', critical: true, photoOn: 'fail', noteOn: 'fail' }),
        q('tick', 'Staff uniform check', { options: [{ label: 'Clean aprons' }, { label: 'Hair restraints' }, { label: 'Closed-toe shoes' }, { label: 'No jewelry' }] }),
        q('section', 'Equipment'),
        q('temperature', 'Walk-in cooler temperature', { critical: true, noteOn: 'fail' }),
        q('temperature', 'Freezer temperature', { min: -10, max: 0, critical: true, noteOn: 'fail' }),
        q('choice', 'Fryer oil condition', { options: [{ label: 'Clear', score: 100 }, { label: 'Dark - change soon', score: 50 }, { label: 'Change now', score: 0 }] }),
        q('rating', 'Overall prep-area cleanliness', { passMin: 4 }),
        q('longtext', 'Anything else to flag?', { required: false }),
        q('signature', 'Manager sign-off'),
      ] },
    { name: 'Walk-in Temp Log', category: 'Food safety', frequency: 'daily', dueTime: '14:00', passScore: 100, description: 'Mid-day temperature log.',
      questions: [
        q('temperature', 'Walk-in cooler', { critical: true, noteOn: 'fail' }),
        q('temperature', 'Prep fridge', { critical: true, noteOn: 'fail' }),
        q('temperature', 'Hot-hold unit', { min: 135, max: 200, critical: true, noteOn: 'fail' }),
        q('photo', 'Photo of temp log sheet', { required: false }),
      ] },
    { name: 'Closing Checklist', category: 'Closing', frequency: 'daily', dueTime: '22:00', passScore: 90, description: 'Lock down the kitchen.',
      questions: [
        q('tick', 'Shutdown tasks', { options: [{ label: 'Grill cleaned' }, { label: 'Fryers filtered' }, { label: 'Floors mopped' }, { label: 'Trash out' }, { label: 'Gas off' }] }),
        q('passfail', 'Food covered, labeled & dated', { noteOn: 'fail' }),
        q('yesno', 'Equipment issues to report?', { passOn: 'no', required: true }),
        q('text', 'Describe the issue', { required: true, points: 0, showIf: { qid: '', op: 'eq', value: 'yes' } }),
        q('signature', 'Closer sign-off'),
      ] },
  ];
  const closing = list[2].questions; closing[3].showIf.qid = closing[2].id;
  for (const c of list) { const id = S.uid('c'); await store.put('checklists', id, { id, ...c, createdAt: now(), updatedAt: now() }); }
  await store.put('board', 'main', {
    id: 'main', title: 'Kitchen Board', rotateSeconds: 12, theme: 'dark',
    slides: [{ type: 'today', on: true }, { type: 'scores', on: true }, { type: 'actions', on: true }, { type: 'live', on: false }, { type: 'announce', on: true }],
    liveChecklistIds: [],
    announcements: [{ id: S.uid('a'), text: 'Welcome! Complete your checklists on time.', level: 'info' }],
  });
}

const routes = [];
// role: 'public' | 'staff' | 'manager' | 'admin' (minimum role required)
const route = (m, re, fn, role = 'staff') => routes.push([m, new RegExp('^' + re + '$'), fn, role]);

// ---- checklists
route('GET', '/api/checklists', async () => (await store.list('checklists')).sort((a, b) => a.name.localeCompare(b.name)));
route('POST', '/api/checklists', async (r, b) => {
  const id = S.uid('c');
  return store.put('checklists', id, { passScore: 80, frequency: 'daily', days: [], questions: [], ...b, id, createdAt: now(), updatedAt: now() });
}, 'manager');
route('GET', '/api/checklists/([\\w-]+)', async (r, b, [id]) => (await store.get('checklists', id)) || 404);
route('PUT', '/api/checklists/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('checklists', id); if (!cur) return 404;
  return store.put('checklists', id, { ...cur, ...b, id, createdAt: cur.createdAt, updatedAt: now() });
}, 'manager');
route('DELETE', '/api/checklists/([\\w-]+)', async (r, b, [id]) => { await store.del('checklists', id); return { ok: true }; }, 'manager');
route('POST', '/api/checklists/([\\w-]+)/duplicate', async (r, b, [id]) => {
  const cur = await store.get('checklists', id); if (!cur) return 404;
  const nid = S.uid('c');
  return store.put('checklists', nid, { ...cur, id: nid, name: cur.name + ' (copy)', createdAt: now(), updatedAt: now() });
}, 'manager');

// ---- runs (audits)
route('GET', '/api/runs', async (r) => {
  let runs = await store.list('runs');
  const q = r.query;
  if (q.status) runs = runs.filter((x) => x.status === q.status);
  if (q.checklistId) runs = runs.filter((x) => x.checklistId === q.checklistId);
  if (q.since) runs = runs.filter((x) => (x.submittedAt || x.startedAt) >= q.since);
  return runs.sort((a, b) => (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt)).slice(0, Number(q.limit) || 500).map(light);
});
route('POST', '/api/runs', async (r, b) => {
  const c = await store.get('checklists', b.checklistId); if (!c) return 404;
  const id = S.uid('r');
  const run = { id, checklistId: c.id, checklistName: c.name, checklist: c, status: 'draft', userId: r.user.id, auditor: r.user.name, location: b.location || '', answers: {}, startedAt: now() };
  applyScore(run);
  return store.put('runs', id, run);
});
route('GET', '/api/runs/([\\w-]+)', async (r, b, [id]) => (await store.get('runs', id)) || 404);
route('PUT', '/api/runs/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('runs', id); if (!cur) return 404;
  if (cur.status === 'submitted') return { error: 'Already submitted' };
  const run = { ...cur, answers: b.answers || cur.answers, location: b.location ?? cur.location, updatedAt: now(), updatedBy: r.user.name };
  await offloadMedia(run); applyScore(run);
  await store.put('runs', id, run);
  return run;
});
route('POST', '/api/runs/([\\w-]+)/submit', async (r, b, [id]) => {
  const cur = await store.get('runs', id); if (!cur) return 404;
  if (cur.status === 'submitted') return cur;
  const run = { ...cur, answers: b.answers || cur.answers, location: b.location ?? cur.location };
  await offloadMedia(run);
  const problems = S.validate(run.checklist, run.answers);
  if (problems.length) return { error: 'Missing required items', problems };
  applyScore(run);
  run.status = 'submitted'; run.submittedAt = now(); run.submittedBy = r.user.name; run.submittedById = r.user.id;
  await store.put('runs', id, run);
  // corrective actions for every failed item
  const sc = S.score(run.checklist, run.answers);
  for (const q of run.checklist.questions) {
    if (sc.items[q.id] && sc.items[q.id].status === 'fail') {
      const aid = S.uid('x');
      await store.put('actions', aid, { id: aid, runId: id, checklistName: run.checklistName, qid: q.id, title: q.label, note: (run.answers[q.id] || {}).note || '', critical: !!q.critical, status: 'open', createdAt: now(), location: run.location });
    }
  }
  return run;
});
route('DELETE', '/api/runs/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('runs', id); if (!cur) return 404;
  // staff may only discard their own drafts; managers can delete anything
  if (ROLES[r.user.role] < ROLES.manager && !(cur.status === 'draft' && cur.userId === r.user.id)) throw httpError(403, 'Only managers can delete this audit');
  await store.del('runs', id); return { ok: true };
});

// ---- corrective actions
route('GET', '/api/actions', async (r) => {
  let a = await store.list('actions'); if (r.query.status) a = a.filter((x) => x.status === r.query.status);
  return a.sort((x, y) => Number(y.critical) - Number(x.critical) || y.createdAt.localeCompare(x.createdAt));
});
route('PUT', '/api/actions/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('actions', id); if (!cur) return 404;
  const next = { ...cur, ...b, id };
  if (b.status === 'done' && cur.status !== 'done') { next.resolvedAt = now(); next.resolvedBy = r.user.name; }
  if (b.status === 'open') { delete next.resolvedAt; delete next.resolvedBy; }
  return store.put('actions', id, next);
});

// ---- board / TV
async function getBoard() {
  let b = await store.get('board', 'main');
  if (!b) b = { id: 'main', title: 'Kitchen Board', slides: [], announcements: [], rotateSeconds: 12 };
  if (!b.tvKey) { b.tvKey = crypto.randomBytes(12).toString('hex'); await store.put('board', 'main', b); }
  return b;
}
route('GET', '/api/board', async () => getBoard(), 'manager');
route('PUT', '/api/board', async (r, b) => { const cur = await getBoard(); return store.put('board', 'main', { ...b, id: 'main', tvKey: cur.tvKey }); }, 'manager');
route('POST', '/api/board/tvkey', async () => { const b = await getBoard(); b.tvKey = crypto.randomBytes(12).toString('hex'); return store.put('board', 'main', b); }, 'manager');
// TV screens have no login: they pass ?key=<tvKey>. Logged-in users can view it too.
route('GET', '/api/tv', async (r) => {
  const board = await getBoard();
  if (!r.user && !(r.query.key && r.query.key.length === board.tvKey.length && crypto.timingSafeEqual(Buffer.from(r.query.key), Buffer.from(board.tvKey))))
    throw httpError(401, 'TV not paired');
  const since = new Date(Date.now() - 8 * 864e5).toISOString();
  const [checklists, runs, actions] = await Promise.all([store.list('checklists'), store.list('runs'), store.list('actions')]);
  const { tvKey, ...safeBoard } = board;
  const recent = runs.filter((x) => (x.submittedAt || x.startedAt) >= since);
  return { board: safeBoard, checklists, serverTime: now(), storage: store.kind,
    runs: recent.map((x) => ({ ...light(x),
      states: Object.fromEntries(Object.entries(S.score(x.checklist, x.answers).items).map(([k, v]) => [k, v.status])) })),
    actions: actions.filter((a) => a.status === 'open') };
}, 'public');
route('GET', '/api/health', async () => ({ ok: true, storage: store.kind }), 'public');

// ---- auth routes
route('GET', '/api/auth/status', async (r) => {
  const users = await store.list('users');
  return { needsSetup: users.length === 0, user: publicUser(r.user) };
}, 'public');
// names for the login picker (no PINs, active users only)
route('GET', '/api/auth/users', async () => (await store.list('users')).filter((u) => u.active !== false)
  .map((u) => ({ id: u.id, name: u.name, role: u.role })).sort((a, b) => a.name.localeCompare(b.name)), 'public');
route('POST', '/api/auth/setup', async (r, b) => {
  if ((await store.list('users')).length) throw httpError(403, 'Setup already done');
  if (!String(b.name || '').trim()) throw httpError(400, 'Name required');
  if (!validPin(b.pin)) throw httpError(400, 'PIN must be 4-8 digits');
  const id = S.uid('u');
  const u = { id, name: b.name.trim(), role: 'admin', active: true, createdAt: now(), ...hashPin(b.pin) };
  await store.put('users', id, u);
  await startSession(r.res, r.req, u);
  return { user: publicUser(u) };
}, 'public');
route('POST', '/api/auth/login', async (r, b) => {
  const u = await store.get('users', String(b.userId || ''));
  if (!u || u.active === false) throw httpError(401, 'Wrong name or PIN');
  const f = loginFails.get(u.id);
  if (f && f.until > Date.now()) throw httpError(429, `Too many tries. Wait ${Math.ceil((f.until - Date.now()) / 60000)} min.`);
  if (!pinOk(u, b.pin)) {
    const n = (f && f.until <= Date.now() && f.until ? 0 : (f ? f.n : 0)) + 1;
    loginFails.set(u.id, { n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    throw httpError(401, n >= 5 ? 'Too many tries. Locked for 5 min.' : 'Wrong PIN');
  }
  loginFails.delete(u.id);
  await startSession(r.res, r.req, u);
  return { user: publicUser(u) };
}, 'public');
route('POST', '/api/auth/logout', async (r) => {
  const tok = cookies(r.req).sid;
  if (tok) { sessionCache.delete(tok); await store.del('sessions', tok).catch(() => {}); }
  r.res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
}, 'public');

// ---- team management
route('GET', '/api/users', async () => (await store.list('users')).map(publicUser).sort((a, b) => a.name.localeCompare(b.name)), 'manager');
route('POST', '/api/users', async (r, b) => {
  const role = ROLES[b.role] ? b.role : 'staff';
  if (!canManage(r.user, role)) throw httpError(403, 'Managers can only add staff');
  if (!String(b.name || '').trim()) throw httpError(400, 'Name required');
  if (!validPin(b.pin)) throw httpError(400, 'PIN must be 4-8 digits');
  const id = S.uid('u');
  const u = { id, name: b.name.trim(), role, active: true, createdAt: now(), ...hashPin(b.pin) };
  await store.put('users', id, u);
  return publicUser(u);
}, 'manager');
route('PUT', '/api/users/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('users', id); if (!cur) return 404;
  const isSelf = cur.id === r.user.id;
  if (!isSelf && !canManage(r.user, cur.role)) throw httpError(403, 'Not allowed');
  const next = { ...cur };
  if (b.name !== undefined) { if (!String(b.name).trim()) throw httpError(400, 'Name required'); next.name = String(b.name).trim(); }
  if (b.role !== undefined && b.role !== cur.role) {
    if (!ROLES[b.role] || r.user.role !== 'admin') throw httpError(403, 'Only admins change roles');
    next.role = b.role;
  }
  if (b.active !== undefined) { if (isSelf) throw httpError(400, "You can't deactivate yourself"); next.active = !!b.active; }
  if (b.pin !== undefined) { if (!validPin(b.pin)) throw httpError(400, 'PIN must be 4-8 digits'); Object.assign(next, hashPin(b.pin)); }
  // never leave the system without an active admin
  if (cur.role === 'admin' && (next.role !== 'admin' || !next.active)) {
    const admins = (await store.list('users')).filter((u) => u.role === 'admin' && u.active !== false);
    if (admins.length <= 1) throw httpError(400, 'Keep at least one active admin');
  }
  await store.put('users', id, next);
  if (!next.active) { // kill their sessions
    for (const s of await store.list('sessions')) if (s.userId === id) { sessionCache.delete(s.id); await store.del('sessions', s.id); }
  }
  return publicUser(next);
}, 'staff');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [m, re, fn, role] of routes) {
        const mt = m === req.method && re.exec(url.pathname);
        if (!mt) continue;
        const user = await currentUser(req);
        if (role !== 'public') {
          if (!user) return send(res, 401, { error: 'Please log in' });
          if (ROLES[user.role] < ROLES[role]) return send(res, 403, { error: `Needs ${role} access` });
        }
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await fn({ query: Object.fromEntries(url.searchParams), user, req, res }, body, mt.slice(1));
        if (out === 404) return send(res, 404, { error: 'Not found' });
        if (out && out.error) return send(res, 400, out);
        return send(res, 200, out);
      }
      return send(res, 404, { error: 'No such route' });
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname === '/tv' ? '/tv.html' : url.pathname;
    const file = path.join(PUBLIC, path.normalize(p));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    if (e.code && e.code >= 400 && e.code < 500) return send(res, e.code, { error: e.message });
    console.error(e); send(res, 500, { error: e.message });
  }
});

async function cleanSessions() {
  for (const x of await store.list('sessions')) if (x.expires < now()) await store.del('sessions', x.id);
}

seed().then(cleanSessions).then(() => server.listen(PORT, () => console.log(`Checklist System on http://localhost:${PORT}  (storage: ${store.kind})  TV: /tv`)));
