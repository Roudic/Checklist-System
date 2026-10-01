/* Kitchen Audit — single-page app (vanilla JS, hash router) */
const { TYPES, evaluate, score, validate, isVisible, needs, newQuestion, uid, scheduledOn } = Shared;
let me = null; // logged-in user
const isMgr = () => me && (me.role === 'manager' || me.role === 'admin');
const $main = document.getElementById('main');
// replaceChildren() doesn't flatten arrays or skip null/false, so pages render through this
const mount = (...kids) => $main.replaceChildren(...kids.flat(9).filter((k) => k != null && k !== false));

// ---------- helpers
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v ?? '';
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const api = async (method, url, body) => {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/auth/')) { me = null; loginView(); throw new Error('Please log in'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), j);
  return j;
};
let toastT;
const toast = (m) => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); };
const fmtDate = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const scoreClass = (r) => r.passed ? 'pass' : 'fail';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const go = (hash) => { location.hash = hash; };

function nav(active) {
  const items = [['#/', '🏠', 'Dashboard'], ['#/checklists', '📋', 'Checklists', 1], ['#/audits', '🧾', 'Audits'], ['#/actions', '🛠️', 'Actions'], ['#/display', '📺', 'TV Display', 1], ['#/team', '👥', 'Team', 1]];
  const n = document.getElementById('nav');
  n.classList.remove('hide');
  n.replaceChildren(h('h1', {}, '🍳 Kitchen Audit'),
    ...items.filter((x) => !x[3] || isMgr()).map(([href, i, l]) => h('a', { href, class: href === active ? 'on' : '' }, i, l)),
    h('div', { class: 'sp' }),
    h('div', { class: 'me' }, h('b', {}, me.name), h('span', {}, me.role), h('button', { class: 'sm ghost', onclick: logout }, 'Log out')));
}

// ---------- router
const routes = [
  [/^#\/?$/, dashboard, '#/'],
  [/^#\/checklists$/, checklists, '#/checklists'],
  [/^#\/builder\/(\w+)$/, builder, '#/checklists'],
  [/^#\/run\/(\w+)$/, runner, '#/'],
  [/^#\/audits$/, audits, '#/audits'],
  [/^#\/report\/(\w+)$/, report, '#/audits'],
  [/^#\/actions$/, actions, '#/actions'],
  [/^#\/display$/, display, '#/display', 1],
  [/^#\/team$/, team, '#/team', 1],
];
for (const r of routes) if (/checklists|builder/.test(r[2])) r[3] = 1;
async function render() {
  const hash = location.hash || '#/';
  if (!me) return;
  for (const [re, fn, navKey, mgr] of routes) {
    const m = re.exec(hash);
    if (m && mgr && !isMgr()) return go('#/');
    if (m) { nav(navKey); mount(h('p', { class: 'empty' }, 'Loading…')); window.scrollTo(0, 0);
      try { await fn(...m.slice(1)); } catch (e) { mount(h('p', { class: 'empty' }, '⚠️ ' + e.message)); } return; }
  }
  go('#/');
}
window.addEventListener('hashchange', render);

// ---------- dashboard
async function dashboard() {
  const [cl, runs, acts] = await Promise.all([api('GET', '/checklists'), api('GET', '/runs?limit=200'), api('GET', '/actions?status=open')]);
  const week = Date.now() - 7 * 864e5;
  const done = runs.filter((r) => r.status === 'submitted');
  const wk = done.filter((r) => new Date(r.submittedAt) > week);
  const avg = wk.length ? Math.round(wk.reduce((s, r) => s + r.percent, 0) / wk.length) : '–';
  const drafts = runs.filter((r) => r.status === 'draft');
  const today = new Date().toDateString();
  const todayState = (c) => {
    const d = done.find((r) => r.checklistId === c.id && new Date(r.submittedAt).toDateString() === today);
    if (d) return h('span', { class: 'pill ' + scoreClass(d) }, (d.passed ? '✓ Done ' : '✕ Failed ') + Math.round(d.percent) + '%');
    const p = drafts.find((r) => r.checklistId === c.id && new Date(r.startedAt).toDateString() === today);
    if (p) return h('span', { class: 'pill info' }, `In progress ${p.progress}%`);
    if (c.dueTime && scheduledOn(c) && new Date().toTimeString().slice(0, 5) > c.dueTime) return h('span', { class: 'pill fail' }, 'Overdue');
    return h('span', { class: 'pill' }, c.category || 'General');
  };
  const card = (c) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', {}, c.name), h('div', { class: 'sp' }), todayState(c)),
      h('p', { class: 'tempr' }, `${c.questions.filter((q) => q.type !== 'section').length} items · pass ${c.passScore}%${c.dueTime ? ' · due ' + c.dueTime : ''}`),
      h('button', { class: 'primary', onclick: () => startRun(c.id) }, '▶ Start audit'));
  const dueToday = cl.filter((c) => scheduledOn(c)), other = cl.filter((c) => !scheduledOn(c));
  mount(
    h('h2', {}, 'Dashboard'), h('p', { class: 'sub' }, new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })),
    h('div', { class: 'kpis' },
      kpi(wk.length, 'Audits this week'), kpi(avg + (avg === '–' ? '' : '%'), 'Avg score (7d)'),
      kpi(acts.length, 'Open actions'), kpi(drafts.length, 'In progress')),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, h('h3', { style: 'margin:0' }, 'Due today'), h('div', { class: 'sp' }), isMgr() ? h('a', { class: 'btn', href: '#/builder/new' }, '＋ New checklist') : null),
    dueToday.length ? h('div', { class: 'grid' }, dueToday.map(card)) : h('p', { class: 'empty card' }, cl.length ? 'Nothing scheduled today.' : 'No checklists yet.'),
    other.length ? [h('h3', { style: 'margin:22px 0 10px' }, 'Other checklists'), h('div', { class: 'grid' }, other.map(card))] : null,
    h('h3', { style: 'margin:26px 0 10px' }, 'Recent audits'), auditTable(done.slice(0, 6)));
}
const kpi = (v, l) => h('div', { class: 'card kpi' }, h('b', {}, v), h('span', {}, l));

async function startRun(checklistId) {
  const run = await api('POST', '/runs', { checklistId, location: localStorage.getItem('location') || '' });
  go('#/run/' + run.id);
}

// ---------- checklists list
async function checklists() {
  const cl = await api('GET', '/checklists');
  mount(
    h('div', { class: 'row' }, h('div', {}, h('h2', {}, 'Checklists'), h('p', { class: 'sub' }, 'Build and manage your audit templates.')), h('div', { class: 'sp' }),
      h('a', { class: 'btn primary', href: '#/builder/new' }, '＋ New checklist')),
    cl.length ? h('div', { class: 'card' }, h('table', {}, h('tr', {}, ['Name', 'Category', 'Items', 'Pass', 'Due', ''].map((x) => h('th', {}, x))),
      cl.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.name)), h('td', {}, c.category), h('td', {}, c.questions.filter((q) => q.type !== 'section').length), h('td', {}, c.passScore + '%'), h('td', {}, c.dueTime || '–'),
        h('td', { style: 'text-align:right;white-space:nowrap' },
          h('button', { class: 'sm primary', onclick: () => startRun(c.id) }, 'Start'), ' ',
          h('a', { class: 'btn sm', href: '#/builder/' + c.id }, 'Edit'), ' ',
          h('button', { class: 'sm', onclick: async () => { await api('POST', `/checklists/${c.id}/duplicate`); toast('Duplicated'); checklists(); } }, 'Copy'), ' ',
          h('button', { class: 'sm danger', onclick: async () => { if (confirm(`Delete "${c.name}"?`)) { await api('DELETE', '/checklists/' + c.id); checklists(); } } }, 'Delete')))))) : h('p', { class: 'empty' }, 'Nothing here yet.'));
}

// ---------- builder
async function builder(id) {
  const c = id === 'new' ? { name: '', category: 'General', description: '', frequency: 'daily', dueTime: '', passScore: 80, questions: [] } : await api('GET', '/checklists/' + id);
  const open = new Set();
  let dirty = false;
  const touch = () => { dirty = true; };
  const draw = () => {
    const groups = {};
    Object.entries(TYPES).forEach(([k, t]) => (groups[t.group] = groups[t.group] || []).push([k, t]));
    mount(
      h('div', { class: 'row' }, h('a', { href: '#/checklists', class: 'btn ghost' }, '← Back'), h('div', { class: 'sp' }),
        h('button', { class: 'primary', onclick: save }, '💾 Save checklist')),
      h('div', { class: 'builder', style: 'margin-top:12px' },
        h('div', {},
          h('div', { class: 'card', style: 'margin-bottom:14px' },
            h('label', { class: 'f' }, 'Checklist name'), h('input', { value: c.name, placeholder: 'e.g. Opening Kitchen Audit', oninput: (e) => { c.name = e.target.value; touch(); } }),
            h('label', { class: 'f' }, 'Description'), h('input', { value: c.description, oninput: (e) => { c.description = e.target.value; touch(); } }),
            h('label', { class: 'f' }, 'Schedule'),
            h('div', { class: 'row' },
              h('select', { style: 'width:auto', onchange: (e) => { c.frequency = e.target.value; c.days = c.days || []; touch(); draw(); } },
                [['daily', 'Every day'], ['days', 'Specific days'], ['none', 'On demand (not scheduled)']].map(([v, l]) => h('option', { value: v, selected: (c.frequency || 'daily') === v }, l))),
              c.frequency === 'days' ? h('div', { class: 'seg days' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => h('button', { class: (c.days || []).includes(i) ? 'on y' : '', onclick: () => { const s = new Set(c.days || []); s.has(i) ? s.delete(i) : s.add(i); c.days = [...s].sort(); touch(); draw(); } }, d))) : null),
          h('div', { class: 'three' },
              h('div', {}, h('label', { class: 'f' }, 'Category'), h('input', { value: c.category, oninput: (e) => { c.category = e.target.value; touch(); } })),
              h('div', {}, h('label', { class: 'f' }, 'Due time (TV board)'), h('input', { type: 'time', value: c.dueTime, oninput: (e) => { c.dueTime = e.target.value; touch(); } })),
              h('div', {}, h('label', { class: 'f' }, 'Pass score %'), h('input', { type: 'number', min: 0, max: 100, value: c.passScore, oninput: (e) => { c.passScore = Number(e.target.value); touch(); } })))),
          c.questions.length ? c.questions.map((q, i) => qCard(q, i)) : h('p', { class: 'empty card' }, 'Add your first question from the panel →')),
        h('div', { class: 'card palette' }, h('b', {}, 'Add question'),
          Object.entries(groups).map(([g, arr]) => [h('h4', {}, g), arr.map(([k, t]) => h('button', { class: 'sm', onclick: () => { const q = newQuestion(k); c.questions.push(q); open.clear(); open.add(q.id); touch(); draw(); } }, t.icon, t.label))]))));
  };
  function qCard(q, i) {
    const t = TYPES[q.type], isOpen = open.has(q.id);
    const mv = (d) => { const j = i + d; if (j < 0 || j >= c.questions.length) return; [c.questions[i], c.questions[j]] = [c.questions[j], c.questions[i]]; touch(); draw(); };
    return h('div', { class: 'q' + (q.type === 'section' ? ' sec' : '') },
      h('div', { class: 'qh', onclick: (e) => { if (e.target.closest('button')) return; isOpen ? open.delete(q.id) : open.add(q.id); draw(); } },
        h('span', {}, t.icon), h('div', { class: 't' }, h('b', {}, q.label || `(untitled ${t.label.toLowerCase()})`),
          h('small', {}, t.label + (q.required && q.type !== 'section' ? ' · required' : '') + (q.critical ? ' · 🚨 critical' : '') + (q.showIf ? ' · conditional' : ''))),
        h('button', { class: 'sm', onclick: () => mv(-1) }, '↑'), h('button', { class: 'sm', onclick: () => mv(1) }, '↓'),
        h('button', { class: 'sm danger', onclick: () => { c.questions.splice(i, 1); touch(); draw(); } }, '✕')),
      isOpen ? h('div', { class: 'qb' }, qEditor(q, i)) : null);
  }
  function qEditor(q, i) {
    const set = (k, v, redraw) => { q[k] = v; touch(); if (redraw) draw(); };
    const num = (v) => (v === '' ? null : Number(v));
    const optsEditor = (withScore) => h('div', {}, h('label', { class: 'f' }, withScore ? 'Options (score % of points earned)' : 'Items'),
      q.options.map((o, oi) => h('div', { class: 'opt' },
        h('input', { value: o.label, oninput: (e) => { o.label = e.target.value; touch(); } }),
        withScore ? h('input', { class: 'n', type: 'number', min: 0, max: 100, value: o.score ?? 100, title: 'Score %', oninput: (e) => { o.score = Number(e.target.value); touch(); } }) : null,
        h('button', { class: 'sm', onclick: () => { q.options.splice(oi, 1); touch(); draw(); } }, '✕'))),
      h('button', { class: 'sm', onclick: () => { q.options.push(withScore ? { label: 'Option', score: 100 } : { label: 'Item' }); touch(); draw(); } }, '＋ Add'));
    const prior = c.questions.slice(0, i).filter((x) => x.type !== 'section');
    const sIf = q.showIf;
    const body = [
      h('label', { class: 'f' }, q.type === 'section' ? 'Heading' : 'Question'), h('input', { value: q.label, autofocus: true, oninput: (e) => set('label', e.target.value) }),
      h('label', { class: 'f' }, 'Help text / instructions'), h('input', { value: q.help, oninput: (e) => set('help', e.target.value) }),
    ];
    if (q.type === 'yesno') body.push(h('label', { class: 'f' }, 'Passing answer'), h('select', { onchange: (e) => set('passOn', e.target.value) }, ['yes', 'no'].map((v) => h('option', { value: v, selected: (q.passOn || 'yes') === v }, v.toUpperCase()))));
    if (['choice', 'dropdown', 'multi'].includes(q.type)) body.push(optsEditor(true));
    if (q.type === 'tick') body.push(optsEditor(false));
    if (q.type === 'number' || q.type === 'temperature' || q.type === 'slider')
      body.push(h('div', { class: 'three' },
        h('div', {}, h('label', { class: 'f' }, q.type === 'temperature' ? 'Min safe' : 'Min'), h('input', { type: 'number', value: q.min ?? '', oninput: (e) => set('min', num(e.target.value)) })),
        h('div', {}, h('label', { class: 'f' }, q.type === 'temperature' ? 'Max safe' : 'Max'), h('input', { type: 'number', value: q.max ?? '', oninput: (e) => set('max', num(e.target.value)) })),
        h('div', {}, h('label', { class: 'f' }, 'Unit'), q.type === 'temperature'
          ? h('select', { onchange: (e) => set('unit', e.target.value) }, ['°F', '°C'].map((u) => h('option', { selected: q.unit === u }, u)))
          : h('input', { value: q.unit || '', oninput: (e) => set('unit', e.target.value) }))));
    if (q.type === 'slider') body.push(h('div', { class: 'two' },
      h('div', {}, h('label', { class: 'f' }, 'Step'), h('input', { type: 'number', value: q.step, oninput: (e) => set('step', Number(e.target.value) || 1) })),
      h('div', {}, h('label', { class: 'f' }, 'Minimum to pass'), h('input', { type: 'number', value: q.passMin ?? '', oninput: (e) => set('passMin', num(e.target.value)) }))));
    if (q.type === 'rating') body.push(h('div', { class: 'two' },
      h('div', {}, h('label', { class: 'f' }, 'Stars'), h('input', { type: 'number', min: 3, max: 10, value: q.max, oninput: (e) => set('max', Number(e.target.value) || 5) })),
      h('div', {}, h('label', { class: 'f' }, 'Minimum to pass'), h('input', { type: 'number', value: q.passMin ?? '', oninput: (e) => set('passMin', num(e.target.value)) }))));
    if (q.type !== 'section') {
      body.push(h('div', { class: 'three' },
        h('div', {}, h('label', { class: 'f' }, 'Points'), h('input', { type: 'number', min: 0, value: q.points, oninput: (e) => set('points', Number(e.target.value) || 0) })),
        h('div', {}, h('label', { class: 'f' }, 'Photo'), h('select', { onchange: (e) => set('photoOn', e.target.value) }, [['never', 'Optional'], ['fail', 'Required on fail'], ['always', 'Always required']].map(([v, l]) => h('option', { value: v, selected: q.photoOn === v }, l)))),
        h('div', {}, h('label', { class: 'f' }, 'Note'), h('select', { onchange: (e) => set('noteOn', e.target.value) }, [['never', 'Optional'], ['fail', 'Required on fail'], ['always', 'Always required']].map(([v, l]) => h('option', { value: v, selected: q.noteOn === v }, l))))));
      body.push(h('div', { class: 'tog' },
        h('label', {}, h('input', { type: 'checkbox', checked: q.required, onchange: (e) => set('required', e.target.checked) }), 'Required'),
        h('label', {}, h('input', { type: 'checkbox', checked: q.critical, onchange: (e) => set('critical', e.target.checked) }), '🚨 Critical (fail = audit fails)'),
        ['yesno', 'passfail'].includes(q.type) ? null : h('label', {}, h('input', { type: 'checkbox', checked: q.allowNA, onchange: (e) => set('allowNA', e.target.checked) }), 'Allow N/A')));
    }
    // conditional logic
    body.push(h('label', { class: 'f' }, 'Show this only when…'),
      h('div', { class: 'row' },
        h('select', { style: 'flex:2', onchange: (e) => { q.showIf = e.target.value ? { qid: e.target.value, op: 'fail', value: '' } : null; touch(); draw(); } },
          h('option', { value: '' }, 'Always show'), prior.map((p) => h('option', { value: p.id, selected: sIf && sIf.qid === p.id }, p.label || TYPES[p.type].label))),
        sIf ? h('select', { style: 'flex:1', onchange: (e) => { sIf.op = e.target.value; touch(); draw(); } }, [['fail', 'fails'], ['pass', 'passes'], ['eq', 'equals'], ['neq', 'not equals'], ['answered', 'is answered']].map(([v, l]) => h('option', { value: v, selected: sIf.op === v }, l))) : null,
        sIf && ['eq', 'neq'].includes(sIf.op) ? h('input', { style: 'flex:1', placeholder: 'value (e.g. yes)', value: sIf.value, oninput: (e) => { sIf.value = e.target.value; touch(); } }) : null));
    return body;
  }
  async function save() {
    if (!c.name.trim()) return toast('Give the checklist a name');
    const saved = id === 'new' ? await api('POST', '/checklists', c) : await api('PUT', '/checklists/' + id, c);
    dirty = false; toast('Saved ✓');
    if (id === 'new') go('#/builder/' + saved.id);
  }
  draw();
}

// ---------- runner
async function runner(id) {
  const run = await api('GET', '/runs/' + id);
  if (run.status === 'submitted') return go('#/report/' + id);
  const c = run.checklist, ans = run.answers;
  const A = (qid) => (ans[qid] = ans[qid] || {});
  let errs = new Set();
  const persist = debounce(async () => { try { await api('PUT', '/runs/' + id, { answers: ans, location: run.location }); } catch (e) { toast('⚠️ ' + e.message); } }, 700);
  const change = (redraw = true) => { persist(); updateProg(); if (redraw) drawQs(); };
  const prog = h('div', { class: 'bar' }, h('i', { style: 'width:0' })), progTxt = h('span', { class: 'tempr' });
  const qWrap = h('div', {});
  function updateProg() { const s = score(c, ans); prog.firstChild.style.width = s.progress + '%'; progTxt.textContent = `${s.answered}/${s.total} answered · score so far ${s.percent}%`; }

  function drawQs() {
    const focus = document.activeElement, fid = focus && focus.dataset && focus.dataset.k, pos = focus && focus.selectionStart;
    qWrap.replaceChildren(...c.questions.filter((q) => isVisible(q, c, ans)).map(qView));
    if (fid) { const el = qWrap.querySelector(`[data-k="${fid}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} } }
  }
  function qView(q) {
    if (q.type === 'section') return h('div', { style: 'margin:22px 0 8px' }, h('h3', { style: 'margin:0' }, q.label), q.help ? h('div', { class: 'tempr' }, q.help) : null);
    const a = A(q.id), res = evaluate(q, a);
    const showExtra = a.value !== undefined && !Shared.isBlank(a.value);
    const card = h('div', { class: 'card run-q' + (errs.has(q.id) ? ' err' : ''), id: 'q-' + q.id },
      h('div', { class: 'lab' }, q.label || TYPES[q.type].label, q.required ? h('span', { class: 'req' }, ' *') : null, q.critical ? ' 🚨' : ''),
      q.help ? h('div', { class: 'help' }, q.help) : null,
      a.na ? h('div', { class: 'pill' }, 'N/A') : input(q, a));
    if (q.allowNA && !['yesno', 'passfail'].includes(q.type)) card.append(h('label', { class: 'tempr', style: 'display:block;margin-top:8px' }, h('input', { type: 'checkbox', checked: !!a.na, onchange: (e) => { a.na = e.target.checked; change(); } }), ' Not applicable'));
    if (showExtra || needs(q, res, 'photo') || needs(q, res, 'note')) {
      const wantN = needs(q, res, 'note'), wantP = needs(q, res, 'photo');
      if (res.status === 'fail') card.append(h('div', { class: 'pill fail', style: 'margin-top:8px' }, 'Failed'));
      card.append(h('label', { class: 'f' }, 'Note' + (wantN ? ' (required)' : '')), h('textarea', { 'data-k': 'n' + q.id, value: a.note || '', oninput: (e) => { a.note = e.target.value; change(false); } }));
      card.append(photoBox(q, a, wantP));
    }
    return card;
  }
  function photoBox(q, a, req) {
    const box = h('div', { class: 'photos' }, (a.photos || []).map((p, i) => h('div', {}, h('img', { src: p }), h('br'), h('button', { class: 'sm', onclick: () => { a.photos.splice(i, 1); change(); } }, '✕'))));
    box.append(h('label', { class: 'btn sm' }, '📷 ' + (req ? 'Add photo (required)' : 'Add photo'),
      h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; (a.photos = a.photos || []).push(await shrink(f)); change(); } })));
    return box;
  }
  function input(q, a) {
    const set = (v) => { a.value = v; change(); };
    switch (q.type) {
      case 'yesno': return h('div', { class: 'seg' }, ['yes', 'no'].map((v) => h('button', { class: (a.value === v ? 'on ' : '') + ((q.passOn || 'yes') === v ? 'g' : 'r'), onclick: () => set(v) }, v.toUpperCase())));
      case 'passfail': return h('div', { class: 'seg' }, [['pass', 'PASS', 'g'], ['fail', 'FAIL', 'r'], ['na', 'N/A', 'n']].map(([v, l, k]) => h('button', { class: (a.value === v ? 'on ' : '') + k, onclick: () => set(v) }, l)));
      case 'choice': return h('div', {}, q.options.map((o) => h('label', { class: 'chk' + (a.value === o.label ? ' on' : '') }, h('input', { type: 'radio', name: q.id, checked: a.value === o.label, onchange: () => set(o.label) }), o.label)));
      case 'dropdown': return h('select', { onchange: (e) => set(e.target.value) }, h('option', { value: '' }, 'Select…'), q.options.map((o) => h('option', { selected: a.value === o.label }, o.label)));
      case 'multi': case 'tick': return h('div', {}, q.options.map((o) => { const on = (a.value || []).includes(o.label);
        return h('label', { class: 'chk' + (on ? ' on' : '') }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { const s = new Set(a.value || []); e.target.checked ? s.add(o.label) : s.delete(o.label); set(q.options.map((x) => x.label).filter((l) => s.has(l))); } }), o.label); }));
      case 'number': case 'temperature': return h('div', {}, h('div', { class: 'row' }, h('input', { type: 'number', step: 'any', inputmode: 'decimal', style: 'max-width:180px;font-size:20px', 'data-k': 'v' + q.id, value: a.value ?? '', oninput: (e) => { a.value = e.target.value === '' ? undefined : Number(e.target.value); change(true); } }), h('b', {}, q.unit || '')),
        (q.min != null || q.max != null) ? h('div', { class: 'tempr' }, `Acceptable: ${q.min ?? '–'} to ${q.max ?? '–'} ${q.unit || ''}`) : null);
      case 'slider': return h('div', { class: 'row' }, h('input', { type: 'range', min: q.min, max: q.max, step: q.step || 1, style: 'flex:1', value: a.value ?? q.min, oninput: (e) => { a.value = Number(e.target.value); e.target.nextSibling.textContent = a.value + (q.unit || ''); persist(); updateProg(); }, onchange: () => change() }), h('b', {}, a.value != null ? a.value + (q.unit || '') : 'tap to set'));
      case 'rating': return h('div', { class: 'stars' }, Array.from({ length: q.max || 5 }, (_, i) => h('span', { class: (a.value > i ? 'on' : ''), onclick: () => set(a.value === i + 1 ? undefined : i + 1) }, '★')));
      case 'text': return h('input', { 'data-k': 'v' + q.id, value: a.value || '', oninput: (e) => { a.value = e.target.value; change(false); } });
      case 'longtext': return h('textarea', { 'data-k': 'v' + q.id, value: a.value || '', oninput: (e) => { a.value = e.target.value; change(false); } });
      case 'date': return h('input', { type: 'date', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'time': return h('input', { type: 'time', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'datetime': return h('input', { type: 'datetime-local', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'photo': { const box = photoBox(q, a, q.required); return box; }
      case 'signature': return sigPad(a, () => change(false));
    }
  }
  drawQs(); updateProg();
  errs = new Set();
  const submitBtn = h('button', { class: 'primary', onclick: submit }, '✅ Submit audit');
  async function submit() {
    submitBtn.disabled = true;
    try { await api('POST', `/runs/${id}/submit`, { answers: ans, location: run.location }); go('#/report/' + id); }
    catch (e) {
      submitBtn.disabled = false;
      if (e.problems) { errs = new Set(e.problems.map((p) => p.qid)); drawQs(); toast(`${e.problems.length} item(s) need attention`); const el = document.getElementById('q-' + e.problems[0].qid); el && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else toast('⚠️ ' + e.message);
    }
  }
  mount(
    h('div', { class: 'row' }, h('a', { href: '#/', class: 'btn ghost' }, '← Exit (auto-saved)'), h('div', { class: 'sp' }), h('span', { class: 'pill info' }, 'Draft')),
    h('h2', {}, c.name), c.description ? h('p', { class: 'sub' }, c.description) : null,
    h('div', { class: 'card', style: 'margin-bottom:14px' }, h('div', { class: 'two' },
      h('div', {}, h('label', { class: 'f', style: 'margin-top:0' }, 'Auditor'), h('div', { style: 'padding:9px 0;font-weight:600' }, run.auditor || me.name, run.updatedBy && run.updatedBy !== run.auditor ? h('span', { class: 'tempr' }, ` · last edit ${run.updatedBy}`) : null)),
      h('div', {}, h('label', { class: 'f', style: 'margin-top:0' }, 'Location / station'), h('input', { value: run.location, placeholder: 'e.g. Main kitchen', oninput: (e) => { run.location = e.target.value; localStorage.setItem('location', run.location); persist(); } }))),
      h('div', { style: 'margin-top:12px' }, prog, progTxt)),
    qWrap, h('div', { class: 'sticky row' }, submitBtn, h('div', { class: 'sp' }), h('button', { class: 'danger', onclick: async () => { if (confirm('Discard this audit?')) { await api('DELETE', '/runs/' + id); go('#/'); } } }, 'Discard')));
}

function shrink(file, max = 900) {
  return new Promise((ok) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = img.width * s; cv.height = img.height * s; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); ok(cv.toDataURL('image/jpeg', 0.75)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file); });
}
function sigPad(a, onChange) {
  const cv = h('canvas', { class: 'sig', width: 700, height: 220 }), g = cv.getContext('2d');
  g.lineWidth = 3; g.lineCap = 'round'; g.strokeStyle = '#111';
  if (a.value) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, cv.width, cv.height); im.src = a.value; }
  let down = false;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = (e) => { down = true; cv.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); };
  cv.onpointermove = (e) => { if (!down) return; g.lineTo(...pt(e)); g.stroke(); };
  cv.onpointerup = () => { if (!down) return; down = false; a.value = cv.toDataURL('image/png'); onChange(); };
  return h('div', {}, cv, h('button', { class: 'sm', style: 'margin-top:6px', onclick: () => { g.clearRect(0, 0, cv.width, cv.height); a.value = undefined; onChange(); } }, 'Clear'));
}

// ---------- audits + report
function auditTable(runs) {
  if (!runs.length) return h('p', { class: 'empty card' }, 'No submitted audits yet.');
  return h('div', { class: 'card' }, h('table', {}, h('tr', {}, ['Checklist', 'Auditor', 'Location', 'Score', 'Result', 'When'].map((x) => h('th', {}, x))),
    runs.map((r) => h('tr', { class: 'link', onclick: () => go('#/report/' + r.id) }, h('td', {}, h('b', {}, r.checklistName)), h('td', {}, r.auditor || '–'), h('td', {}, r.location || '–'), h('td', {}, r.percent + '%'),
      h('td', {}, h('span', { class: 'pill ' + scoreClass(r) }, r.passed ? 'PASS' : 'FAIL')), h('td', {}, fmtDate(r.submittedAt))))));
}
async function audits() {
  const runs = (await api('GET', '/runs?status=submitted')), drafts = await api('GET', '/runs?status=draft');
  mount(h('h2', {}, 'Audits'), h('p', { class: 'sub' }, 'Every completed audit, newest first.'),
    drafts.length ? h('div', { class: 'card', style: 'margin-bottom:14px' }, h('b', {}, 'In progress'), drafts.map((d) => h('div', { class: 'row', style: 'padding:8px 0' }, d.checklistName, h('span', { class: 'tempr' }, `${d.progress}% · ${d.auditor || 'unknown'}`), h('div', { class: 'sp' }), h('a', { class: 'btn sm', href: '#/run/' + d.id }, 'Resume')))) : null,
    auditTable(runs));
}
async function report(id) {
  const run = await api('GET', '/runs/' + id), c = run.checklist, s = score(c, run.answers);
  const color = run.passed ? 'var(--ok)' : 'var(--bad)';
  mount(
    h('div', { class: 'row' }, h('a', { href: '#/audits', class: 'btn ghost' }, '← Audits'), h('div', { class: 'sp' }), h('button', { onclick: () => print() }, '🖨️ Print')),
    h('div', { class: 'card row', style: 'gap:24px;margin:12px 0 18px' },
      h('div', { class: 'ring', style: `--c:${color};--p:${run.percent}` }, h('i', {}, Math.round(run.percent) + '%')),
      h('div', {}, h('h2', {}, run.checklistName), h('span', { class: 'pill ' + scoreClass(run) }, run.passed ? 'PASSED' : 'FAILED'),
        h('p', { class: 'tempr' }, `${run.submittedBy || run.auditor || 'Unknown'} · ${run.location || 'No location'} · ${fmtDate(run.submittedAt)}`),
        h('p', { class: 'tempr' }, `${s.fails} failed item(s) · pass mark ${c.passScore}%` + (s.criticalFails.length ? ` · 🚨 ${s.criticalFails.length} critical failure(s)` : '')))),
    c.questions.map((q) => {
      if (q.type === 'section') return h('h3', { style: 'margin:20px 0 8px' }, q.label);
      if (!isVisible(q, c, run.answers)) return null;
      const a = run.answers[q.id] || {}, r = s.items[q.id] || { status: 'blank' };
      const cls = { pass: 'pass', fail: 'fail', partial: 'warn', na: '', info: 'info', blank: '' }[r.status];
      return h('div', { class: 'card', style: 'margin-bottom:8px' }, h('div', { class: 'row' }, h('b', {}, q.label), q.critical ? '🚨' : '', h('div', { class: 'sp' }), h('span', { class: 'pill ' + cls }, r.status.toUpperCase())),
        q.type === 'signature' && a.value ? h('img', { src: a.value, style: 'max-height:80px;background:#fff;border-radius:8px' }) : h('div', {}, displayVal(q, a)),
        a.note ? h('div', { class: 'tempr' }, '📝 ' + a.note) : null,
        (a.photos || []).length ? h('div', { class: 'photos' }, a.photos.map((p) => h('img', { src: p }))) : null);
    }));
}
const displayVal = (q, a) => a.na ? 'N/A' : Array.isArray(a.value) ? a.value.join(', ') : a.value == null || a.value === '' ? '—' : String(a.value) + (['number', 'temperature', 'slider'].includes(q.type) ? ' ' + (q.unit || '') : '');

// ---------- actions
async function actions() {
  const list = await api('GET', '/actions');
  const open = list.filter((a) => a.status === 'open'), done = list.filter((a) => a.status !== 'open');
  const row = (a) => h('div', { class: 'card', style: 'margin-bottom:8px' }, h('div', { class: 'row' },
    a.critical ? h('span', { class: 'pill fail' }, '🚨 CRITICAL') : h('span', { class: 'pill warn' }, 'Action'), h('b', {}, a.title), h('div', { class: 'sp' }),
    a.status === 'open' ? h('button', { class: 'sm primary', onclick: async () => { await api('PUT', '/actions/' + a.id, { status: 'done' }); actions(); } }, '✓ Mark fixed') : h('button', { class: 'sm', onclick: async () => { await api('PUT', '/actions/' + a.id, { status: 'open' }); actions(); } }, 'Reopen')),
    h('div', { class: 'tempr' }, `${a.checklistName}${a.location ? ' · ' + a.location : ''} · ${fmtDate(a.createdAt)}${a.note ? ' · ' + a.note : ''}`),
    a.resolvedBy ? h('div', { class: 'tempr' }, `Fixed by ${a.resolvedBy} · ${fmtDate(a.resolvedAt)}`) : null,
    a.status === 'open' ? h('input', { placeholder: 'Resolution note (optional)', value: a.resolution || '', style: 'margin-top:8px', onchange: (e) => api('PUT', '/actions/' + a.id, { resolution: e.target.value }) }) : (a.resolution ? h('div', { class: 'tempr' }, '✅ ' + a.resolution) : null));
  mount(h('h2', {}, 'Corrective actions'), h('p', { class: 'sub' }, 'Every failed item on a submitted audit lands here until someone fixes it.'),
    open.length ? open.map(row) : h('p', { class: 'empty card' }, '🎉 Nothing open. Kitchen is clean.'),
    done.length ? [h('h3', { style: 'margin:22px 0 8px' }, 'Resolved'), done.slice(0, 20).map(row)] : null);
}

// ---------- TV display settings
async function display() {
  const [b, cl] = await Promise.all([api('GET', '/board'), api('GET', '/checklists')]);
  b.announcements = b.announcements || []; b.liveChecklistIds = b.liveChecklistIds || [];
  const SL = { today: ['📋', "Today's checklists", 'Status of every checklist: done, in progress, due, overdue'], scores: ['🏆', 'Scores', 'Recent audit scores and 7-day average'], actions: ['🛠️', 'Open actions', 'Unresolved corrective actions'], live: ['📡', 'Live checklist', 'Item-by-item view of pinned checklists as staff complete them'], announce: ['📣', 'Announcements', 'Big-screen messages for the team'] };
  const save = async () => { Object.assign(b, await api('PUT', '/board', b)); toast('TV board saved ✓'); };
  const tvUrl = () => `${location.origin}/tv?key=${b.tvKey}`;
  const draw = () => mount(
    h('div', { class: 'row' }, h('div', {}, h('h2', {}, 'TV Display'), h('p', { class: 'sub' }, 'Turn any TV or tablet into a live digital board. Open it full screen and it refreshes itself.')), h('div', { class: 'sp' }),
      h('a', { class: 'btn', href: tvUrl(), target: '_blank' }, '🖥️ Open TV mode ↗'), h('button', { class: 'primary', onclick: save }, '💾 Save')),
    h('div', { class: 'card', style: 'margin-bottom:14px' }, h('b', {}, '🔗 TV link'),
      h('p', { class: 'tempr', style: 'margin:4px 0 8px' }, 'Open this on the TV once. No login needed, so keep it private. Anyone with the link can view the board.'),
      h('div', { class: 'row' }, h('input', { readonly: true, value: tvUrl(), style: 'flex:1;font-family:monospace;font-size:13px', onclick: (e) => e.target.select() }),
        h('button', { class: 'sm', onclick: async () => { try { await navigator.clipboard.writeText(tvUrl()); toast('Link copied'); } catch { toast('Select the link and copy it'); } } }, '📋 Copy'),
        h('button', { class: 'sm danger', onclick: async () => { if (!confirm('Make a new link? Every TV using the old one will stop until you open the new link on it.')) return; Object.assign(b, await api('POST', '/board/tvkey')); toast('New TV link created'); draw(); } }, '↻ New link'))),
    h('div', { class: 'card' }, h('div', { class: 'two' },
      h('div', {}, h('label', { class: 'f' }, 'Board title'), h('input', { value: b.title || '', oninput: (e) => (b.title = e.target.value) })),
      h('div', {}, h('label', { class: 'f' }, 'Seconds per slide'), h('input', { type: 'number', min: 4, value: b.rotateSeconds || 12, oninput: (e) => (b.rotateSeconds = Number(e.target.value) || 12) })))),
    h('h3', { style: 'margin:20px 0 8px' }, 'Slides (in order)'),
    b.slides.map((s, i) => h('div', { class: 'card row', style: 'margin-bottom:8px' }, h('input', { type: 'checkbox', checked: s.on, onchange: (e) => (s.on = e.target.checked) }), SL[s.type][0], h('div', {}, h('b', {}, SL[s.type][1]), h('div', { class: 'tempr' }, SL[s.type][2])), h('div', { class: 'sp' }),
      h('button', { class: 'sm', onclick: () => { if (i) { [b.slides[i - 1], b.slides[i]] = [b.slides[i], b.slides[i - 1]]; draw(); } } }, '↑'), h('button', { class: 'sm', onclick: () => { if (i < b.slides.length - 1) { [b.slides[i + 1], b.slides[i]] = [b.slides[i], b.slides[i + 1]]; draw(); } } }, '↓'))),
    h('h3', { style: 'margin:20px 0 8px' }, 'Pinned for "Live checklist" slide'),
    h('div', { class: 'card' }, cl.map((c) => h('label', { class: 'chk' + (b.liveChecklistIds.includes(c.id) ? ' on' : ''), style: 'font-size:15px' }, h('input', { type: 'checkbox', checked: b.liveChecklistIds.includes(c.id), onchange: (e) => { const s = new Set(b.liveChecklistIds); e.target.checked ? s.add(c.id) : s.delete(c.id); b.liveChecklistIds = [...s]; draw(); } }), c.name))),
    h('h3', { style: 'margin:20px 0 8px' }, 'Announcements'),
    h('div', { class: 'card' }, b.announcements.map((a, i) => h('div', { class: 'opt' }, h('select', { style: 'width:110px', onchange: (e) => (a.level = e.target.value) }, ['info', 'warn', 'alert'].map((l) => h('option', { selected: a.level === l }, l))),
      h('input', { value: a.text, oninput: (e) => (a.text = e.target.value) }), h('button', { class: 'sm', onclick: () => { b.announcements.splice(i, 1); draw(); } }, '✕'))),
      h('button', { class: 'sm', onclick: () => { b.announcements.push({ id: uid('a'), text: '', level: 'info' }); draw(); } }, '＋ Add announcement')),
    h('p', { class: 'tempr', style: 'margin-top:14px' }, 'Tip: add &slides=today,scores to the TV link to show only those slides on a specific screen. Arrow keys skip slides, Space pauses.'));
  draw();
}

// ---------- team
async function team() {
  const users = await api('GET', '/users');
  const roleOpts = me.role === 'admin' ? ['staff', 'manager', 'admin'] : ['staff'];
  const form = { name: '', role: 'staff', pin: '' };
  const add = async () => {
    try { await api('POST', '/users', form); toast(`${form.name} added`); team(); } catch (e) { toast('⚠️ ' + e.message); }
  };
  const pinPrompt = async (u) => {
    const pin = prompt(`New PIN for ${u.name} (4-8 digits)`);
    if (pin == null) return;
    try { await api('PUT', '/users/' + u.id, { pin }); toast('PIN updated'); } catch (e) { toast('⚠️ ' + e.message); }
  };
  const can = (u) => u.id === me.id || me.role === 'admin' || (me.role === 'manager' && u.role === 'staff');
  mount(
    h('h2', {}, 'Team'), h('p', { class: 'sub' }, 'Everyone who can log in. Staff run audits and fix actions. Managers also build checklists, run the TV and add staff. Admins control everything.'),
    h('div', { class: 'card', style: 'margin-bottom:16px' }, h('b', {}, 'Add a person'),
      h('div', { class: 'three' },
        h('div', {}, h('label', { class: 'f' }, 'Name'), h('input', { placeholder: 'e.g. Marcus', oninput: (e) => (form.name = e.target.value) })),
        h('div', {}, h('label', { class: 'f' }, 'Role'), h('select', { onchange: (e) => (form.role = e.target.value) }, roleOpts.map((r) => h('option', { value: r }, r)))),
        h('div', {}, h('label', { class: 'f' }, 'PIN (4-8 digits)'), h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, oninput: (e) => (form.pin = e.target.value) }))),
      h('button', { class: 'primary', style: 'margin-top:12px', onclick: add }, '＋ Add')),
    h('div', { class: 'card' }, h('table', {}, h('tr', {}, ['Name', 'Role', 'Status', ''].map((x) => h('th', {}, x))),
      users.map((u) => h('tr', {},
        h('td', {}, h('b', {}, u.name), u.id === me.id ? h('span', { class: 'tempr' }, ' (you)') : null),
        h('td', {}, me.role === 'admin' && u.id !== me.id
          ? h('select', { style: 'width:auto', onchange: async (e) => { try { await api('PUT', '/users/' + u.id, { role: e.target.value }); toast('Role updated'); } catch (er) { toast('⚠️ ' + er.message); team(); } } }, ['staff', 'manager', 'admin'].map((r) => h('option', { selected: u.role === r }, r)))
          : h('span', { class: 'pill' + (u.role === 'admin' ? ' fail' : u.role === 'manager' ? ' info' : '') }, u.role)),
        h('td', {}, h('span', { class: 'pill ' + (u.active ? 'pass' : '') }, u.active ? 'Active' : 'Deactivated')),
        h('td', { style: 'text-align:right;white-space:nowrap' }, can(u) ? [
          h('button', { class: 'sm', onclick: () => pinPrompt(u) }, 'Reset PIN'), ' ',
          u.id !== me.id ? h('button', { class: 'sm ' + (u.active ? 'danger' : ''), onclick: async () => { try { await api('PUT', '/users/' + u.id, { active: !u.active }); team(); } catch (e) { toast('⚠️ ' + e.message); } } }, u.active ? 'Deactivate' : 'Reactivate') : null] : null))))));
}

// ---------- auth screens
function authShell(...kids) {
  document.getElementById('nav').classList.add('hide');
  mount(h('div', { class: 'auth' }, h('div', { class: 'logo' }, '🍳'), ...kids));
}
function pinPad(onDone, label = 'Enter PIN') {
  let pin = '';
  const dots = h('div', { class: 'dots' }), msg = h('div', { class: 'msg' });
  const paint = () => dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
  const press = async (k) => {
    msg.textContent = '';
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (k === '✓') { if (pin.length < 4) { msg.textContent = 'At least 4 digits'; return; } const p = pin; pin = ''; paint(); const err = await onDone(p); if (err) msg.textContent = err; return; }
    else if (pin.length < 8) pin += k;
    paint();
  };
  const onKey = (e) => { if (!document.body.contains(dots)) return document.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Enter') press('✓'); };
  document.addEventListener('keydown', onKey);
  paint();
  return h('div', {}, h('div', { class: 'tempr', style: 'text-align:center' }, label), dots, msg,
    h('div', { class: 'pad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => h('button', { class: k === '✓' ? 'primary' : '', onclick: () => press(k) }, k))));
}
async function loginView() {
  const users = await api('GET', '/auth/users');
  const pick = (u) => authShell(h('h2', {}, `Hey ${u.name} 👋`),
    pinPad(async (pin) => { try { me = (await api('POST', '/auth/login', { userId: u.id, pin })).user; enter(); } catch (e) { return e.message; } }),
    h('button', { class: 'ghost', style: 'margin:14px auto 0;display:flex', onclick: loginView }, '← Not you?'));
  authShell(h('h2', {}, 'Who’s checking in?'), h('p', { class: 'sub' }, 'Tap your name'),
    h('div', { class: 'people' }, users.map((u) => h('button', { onclick: () => pick(u) }, h('span', { class: 'av' }, u.name.slice(0, 1).toUpperCase()), u.name))));
}
function setupView() {
  let name = '';
  const step2 = () => {
    if (!name.trim()) return toast('Enter your name');
    let first = null;
    const ask = () => authShell(h('h2', {}, first ? 'Confirm PIN' : 'Pick your PIN'), h('p', { class: 'sub' }, first ? 'Type it one more time' : '4 to 8 digits. You’ll use it to log in.'),
      pinPad(async (pin) => {
        if (!first) { first = pin; ask(); return; }
        if (pin !== first) { first = null; ask(); toast('PINs didn’t match. Try again.'); return; }
        try { me = (await api('POST', '/auth/setup', { name, pin })).user; toast('You’re the admin. Let’s go!'); enter(); } catch (e) { return e.message; }
      }));
    ask();
  };
  authShell(h('h2', {}, 'Welcome to Kitchen Audit'), h('p', { class: 'sub' }, 'First things first. Create the owner (admin) account.'),
    h('input', { placeholder: 'Your name', style: 'font-size:18px', oninput: (e) => (name = e.target.value), onkeydown: (e) => e.key === 'Enter' && step2() }),
    h('button', { class: 'primary', style: 'width:100%;justify-content:center;margin-top:12px;padding:13px', onclick: step2 }, 'Next →'));
}
async function logout() { await api('POST', '/auth/logout'); me = null; location.hash = '#/'; loginView(); }
function enter() { render(); }

(async function boot() {
  const st = await api('GET', '/auth/status');
  me = st.user;
  if (st.needsSetup) return setupView();
  if (!me) return loginView();
  render();
})();
