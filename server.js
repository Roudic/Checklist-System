const http = require('http');
const fs = require('fs');
const path = require('path');
const S = require('./public/shared.js');
const createStore = require('./storage');
try { for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; } } catch {}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const store = createStore(path.join(__dirname, 'data'));
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
const route = (m, re, fn) => routes.push([m, new RegExp('^' + re + '$'), fn]);

// ---- checklists
route('GET', '/api/checklists', async () => (await store.list('checklists')).sort((a, b) => a.name.localeCompare(b.name)));
route('POST', '/api/checklists', async (r, b) => {
  const id = S.uid('c');
  return store.put('checklists', id, { passScore: 80, frequency: 'daily', questions: [], ...b, id, createdAt: now(), updatedAt: now() });
});
route('GET', '/api/checklists/([\\w-]+)', async (r, b, [id]) => (await store.get('checklists', id)) || 404);
route('PUT', '/api/checklists/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('checklists', id); if (!cur) return 404;
  return store.put('checklists', id, { ...cur, ...b, id, createdAt: cur.createdAt, updatedAt: now() });
});
route('DELETE', '/api/checklists/([\\w-]+)', async (r, b, [id]) => { await store.del('checklists', id); return { ok: true }; });
route('POST', '/api/checklists/([\\w-]+)/duplicate', async (r, b, [id]) => {
  const cur = await store.get('checklists', id); if (!cur) return 404;
  const nid = S.uid('c');
  return store.put('checklists', nid, { ...cur, id: nid, name: cur.name + ' (copy)', createdAt: now(), updatedAt: now() });
});

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
  const run = { id, checklistId: c.id, checklistName: c.name, checklist: c, status: 'draft', auditor: b.auditor || '', location: b.location || '', answers: {}, startedAt: now() };
  applyScore(run);
  return store.put('runs', id, run);
});
route('GET', '/api/runs/([\\w-]+)', async (r, b, [id]) => (await store.get('runs', id)) || 404);
route('PUT', '/api/runs/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('runs', id); if (!cur) return 404;
  if (cur.status === 'submitted') return { error: 'Already submitted' };
  const run = { ...cur, answers: b.answers || cur.answers, auditor: b.auditor ?? cur.auditor, location: b.location ?? cur.location, updatedAt: now() };
  await offloadMedia(run); applyScore(run);
  await store.put('runs', id, run);
  return run;
});
route('POST', '/api/runs/([\\w-]+)/submit', async (r, b, [id]) => {
  const cur = await store.get('runs', id); if (!cur) return 404;
  if (cur.status === 'submitted') return cur;
  const run = { ...cur, answers: b.answers || cur.answers, auditor: b.auditor ?? cur.auditor, location: b.location ?? cur.location };
  await offloadMedia(run);
  const problems = S.validate(run.checklist, run.answers);
  if (problems.length) return { error: 'Missing required items', problems };
  applyScore(run);
  run.status = 'submitted'; run.submittedAt = now();
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
route('DELETE', '/api/runs/([\\w-]+)', async (r, b, [id]) => { await store.del('runs', id); return { ok: true }; });

// ---- corrective actions
route('GET', '/api/actions', async (r) => {
  let a = await store.list('actions'); if (r.query.status) a = a.filter((x) => x.status === r.query.status);
  return a.sort((x, y) => Number(y.critical) - Number(x.critical) || y.createdAt.localeCompare(x.createdAt));
});
route('PUT', '/api/actions/([\\w-]+)', async (r, b, [id]) => {
  const cur = await store.get('actions', id); if (!cur) return 404;
  const next = { ...cur, ...b, id };
  if (b.status === 'done' && cur.status !== 'done') next.resolvedAt = now();
  if (b.status === 'open') delete next.resolvedAt;
  return store.put('actions', id, next);
});

// ---- board / TV
route('GET', '/api/board', async () => (await store.get('board', 'main')) || { id: 'main', slides: [], announcements: [], rotateSeconds: 12 });
route('PUT', '/api/board', async (r, b) => store.put('board', 'main', { ...b, id: 'main' }));
route('GET', '/api/tv', async () => {
  const since = new Date(Date.now() - 8 * 864e5).toISOString();
  const [board, checklists, runs, actions] = await Promise.all([
    store.get('board', 'main'), store.list('checklists'), store.list('runs'), store.list('actions')]);
  const recent = runs.filter((x) => (x.submittedAt || x.startedAt) >= since);
  return { board: board || {}, checklists, serverTime: now(), storage: store.kind,
    runs: recent.map((x) => ({ ...light(x),
      states: Object.fromEntries(Object.entries(S.score(x.checklist, x.answers).items).map(([k, v]) => [k, v.status])) })),
    actions: actions.filter((a) => a.status === 'open') };
});
route('GET', '/api/health', async () => ({ ok: true, storage: store.kind }));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      for (const [m, re, fn] of routes) {
        const mt = m === req.method && re.exec(url.pathname);
        if (!mt) continue;
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await fn({ query: Object.fromEntries(url.searchParams) }, body, mt.slice(1));
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
    console.error(e); send(res, 500, { error: e.message });
  }
});

seed().then(() => server.listen(PORT, () => console.log(`Checklist System on http://localhost:${PORT}  (storage: ${store.kind})  TV: /tv`)));
