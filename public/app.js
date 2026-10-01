/* Kitchen Audit — single-page app (vanilla JS, hash router) */
const { TYPES, evaluate, score, validate, isVisible, needs, newQuestion, uid, scheduledOn } = Shared;
let me = null; // logged-in user
const isMgr = () => me && (me.role === 'manager' || me.role === 'admin');
const $main = document.getElementById('main');
// replaceChildren() doesn't flatten arrays or skip null/false, so pages render through this
const mount = (...kids) => $main.replaceChildren(h('div', { class: 'wrap' }, ...kids));

// ---------- helpers
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v ?? '';
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function icon(name, cls = '') {
  // size classes are ic-sm / ic-lg: plain .sm is the small-button class and would add padding
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('class', 'ic ' + cls.replace(/\b(sm|lg)\b/g, 'ic-$1')); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use'); u.setAttribute('href', '/icons.svg#' + name); s.append(u); return s;
}
const tint = (name, kind = 'brand', cls = '') => h('span', { class: `tint ${kind} ${cls}` }, icon(name, cls.includes('lg') ? '' : 'sm'));
const chip = (text, kind = '', plain) => h('span', { class: `chip ${kind}${plain ? ' plain' : ''}` }, text);
const hue = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatar = (name, cls = '') => h('span', { class: 'av ' + cls, style: `--h:${hue(name)}`, title: name }, initials(name));
const bar = (pct, kind = '') => h('div', { class: 'bar ' + kind }, h('i', { style: `width:${Math.max(0, Math.min(100, pct))}%` }));
const ring = (pct, size, color, sub) => h('div', { class: 'ring', style: `--p:${pct};--s:${size}px;--c:${color}` }, h('div', {}, h('b', {}, Math.round(pct) + '%'), sub ? h('small', {}, sub) : null));
const btn = (label, ic, onclick, cls = '') => h('button', { class: cls, onclick }, ic ? icon(ic, 'sm') : null, label);
const iconBtn = (ic, title, onclick, cls = 'ghost') => h('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, onclick }, icon(ic, 'sm'));
const empty = (ic, title, sub, action) => h('div', { class: 'empty' }, tint(ic, 'gray', 'lg'), h('b', {}, title), sub ? h('div', {}, sub) : null, action ? h('div', { style: 'margin-top:14px' }, action) : null);
const head = (title, sub, ...acts) => h('div', { class: 'head' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null), acts.length ? h('div', { class: 'acts' }, acts) : null);
const panel = (title, opts = {}, ...body) => h('section', { class: 'panel ' + (opts.cls || '') },
  title ? h('div', { class: 'panel-h' }, opts.icon ? tint(opts.icon, opts.tint || 'brand') : null, h('div', {}, h('h2', {}, title), opts.sub ? h('p', {}, opts.sub) : null), opts.acts ? h('div', { class: 'acts' }, opts.acts) : null) : null,
  ...body);
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('div', { class: 'hint', style: 'margin-top:6px' }, hint) : null);

const api = async (method, url, body) => {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/auth/')) { me = null; loginView(); throw new Error('Please log in'); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), j);
  return j;
};
let toastT;
function toast(m, err) {
  const t = document.getElementById('toast');
  t.replaceChildren(icon(err ? 'circle-alert' : 'circle-check', 'sm'), m);
  t.className = 'show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => (t.className = ''), 2600);
}
const fail = (e) => toast(e.message, true);
const fmtDate = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const fmtTime = (s) => s ? new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
const fmtDue = (t) => { if (!t) return ''; const [hh, mm] = t.split(':').map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const go = (hash) => { location.hash = hash; };
const itemCount = (c) => c.questions.filter((q) => q.type !== 'section').length;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const schedText = (c) => c.frequency === 'none' ? 'On demand' : c.frequency === 'days' ? ((c.days || []).length ? c.days.map((d) => DAYS[d]).join(', ') : 'No days set') : 'Daily';
const resultChip = (r) => r.passed ? chip('Passed', 'ok') : chip('Failed', 'bad');
const scoreKind = (p) => (p >= 90 ? 'ok' : p >= 75 ? 'warn' : 'bad');
const scoreColor = (p) => `var(--${scoreKind(p)})`;

// per question-type icon + tint
const TYPE_UI = { yesno: ['toggle-right', 'brand'], passfail: ['circle-check', 'ok'], tick: ['list-checks', 'ok'], choice: ['circle-dot', 'info'], dropdown: ['square-chevron-down', 'info'], multi: ['list-todo', 'info'], number: ['hash', 'warn'], temperature: ['thermometer', 'bad'], slider: ['sliders-horizontal', 'warn'], rating: ['star', 'warn'], text: ['type', 'gray'], longtext: ['align-left', 'gray'], photo: ['camera', 'brand'], signature: ['signature', 'brand'], date: ['calendar', 'gray'], time: ['clock', 'gray'], datetime: ['calendar-clock', 'gray'], section: ['heading', 'gray'] };
const typeTint = (t) => tint(TYPE_UI[t][0], TYPE_UI[t][1]);

/** Where does a checklist stand today? */
function todayStatus(c, runs) {
  const today = new Date().toDateString();
  const done = runs.filter((r) => r.checklistId === c.id && r.status === 'submitted' && new Date(r.submittedAt).toDateString() === today).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (done) return { k: done.passed ? 'done' : 'failed', run: done, chip: done.passed ? chip(`Passed · ${Math.round(done.percent)}%`, 'ok') : chip(`Failed · ${Math.round(done.percent)}%`, 'bad') };
  const draft = runs.find((r) => r.checklistId === c.id && r.status === 'draft' && new Date(r.startedAt).toDateString() === today);
  if (draft) return { k: 'progress', run: draft, chip: chip(`In progress · ${draft.progress}%`, 'info') };
  if (!scheduledOn(c)) return { k: 'ondemand', chip: chip('On demand', '', true) };
  if (c.dueTime && new Date().toTimeString().slice(0, 5) > c.dueTime) return { k: 'overdue', chip: chip('Overdue', 'bad') };
  return { k: 'due', chip: chip(c.dueTime ? `Due ${fmtDue(c.dueTime)}` : 'To do', 'warn') };
}

// ---------- shell
let openActions = 0;
function nav(active) {
  const n = document.getElementById('nav');
  n.classList.remove('hide');
  const link = ([href, ic, label, badge]) => h('a', { href, class: href === active ? 'on' : '' }, icon(ic), h('span', {}, label), badge ? h('span', { class: 'badge' }, badge) : null);
  n.replaceChildren(
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, icon('chef-hat')), h('div', {}, h('b', {}, 'Kitchen Audit'), h('small', {}, 'Operations'))),
    h('nav', {},
      h('div', { class: 'nav-label' }, 'Operations'),
      link(['#/', 'layout-dashboard', 'Dashboard']), link(['#/audits', 'file-check-2', 'Audits']), link(['#/actions', 'wrench', 'Actions', openActions || null]),
      isMgr() ? [h('div', { class: 'nav-label' }, 'Manage'), link(['#/checklists', 'clipboard-list', 'Checklists']), link(['#/display', 'monitor', 'TV Display']), link(['#/team', 'users', 'Team'])] : null),
    h('div', { class: 'grow' }),
    h('div', { class: 'me' }, avatar(me.name), h('div', {}, h('b', {}, me.name), h('small', {}, me.role)), h('button', { title: 'Log out', 'aria-label': 'Log out', onclick: logout }, icon('log-out', 'sm'))));
}
const refreshBadge = () => api('GET', '/actions?status=open').then((a) => { if (a.length !== openActions) { openActions = a.length; const on = document.querySelector('.side nav a.on'); nav(on ? on.getAttribute('href') : '#/'); } }).catch(() => {});

// ---------- router
const routes = [
  [/^#\/?$/, dashboard, '#/'],
  [/^#\/checklists$/, checklists, '#/checklists', 1],
  [/^#\/builder\/(\w+)$/, builder, '#/checklists', 1],
  [/^#\/run\/(\w+)$/, runner, '#/'],
  [/^#\/audits$/, audits, '#/audits'],
  [/^#\/report\/(\w+)$/, report, '#/audits'],
  [/^#\/actions$/, actions, '#/actions'],
  [/^#\/display$/, display, '#/display', 1],
  [/^#\/team$/, team, '#/team', 1],
];
let leaveGuard = null; // returns true to block navigation (unsaved builder changes)
let lastHash = location.hash;
async function render() {
  if (!me) return;
  if (leaveGuard && location.hash !== lastHash && leaveGuard()) { history.replaceState(null, '', lastHash || '#/'); return; }
  leaveGuard = null; lastHash = location.hash;
  const hash = location.hash || '#/';
  for (const [re, fn, navKey, mgr] of routes) {
    const m = re.exec(hash);
    if (!m) continue;
    if (mgr && !isMgr()) return go('#/');
    nav(navKey); refreshBadge();
    mount(h('div', { class: 'skeleton' })); window.scrollTo(0, 0);
    try { await fn(...m.slice(1)); } catch (e) { mount(empty('circle-alert', 'Something went wrong', e.message)); }
    return;
  }
  go('#/');
}
window.addEventListener('hashchange', render);

// ---------- dashboard
async function dashboard() {
  const [cl, runs, acts] = await Promise.all([api('GET', '/checklists'), api('GET', '/runs?limit=300'), api('GET', '/actions?status=open')]);
  const done = runs.filter((r) => r.status === 'submitted');
  const wk = done.filter((r) => new Date(r.submittedAt) > Date.now() - 7 * 864e5);
  const avg = wk.length ? wk.reduce((s, r) => s + r.percent, 0) / wk.length : null;
  const passRate = wk.length ? Math.round((wk.filter((r) => r.passed).length / wk.length) * 100) : null;
  const rows = cl.map((c) => ({ c, s: todayStatus(c, runs) }));
  const order = { overdue: 0, progress: 1, due: 2, failed: 3, done: 4 };
  const today = rows.filter((x) => x.s.k !== 'ondemand').sort((a, b) => order[a.s.k] - order[b.s.k] || (a.c.dueTime || '').localeCompare(b.c.dueTime || ''));
  const other = rows.filter((x) => x.s.k === 'ondemand');
  const finished = today.filter((x) => x.s.k === 'done' || x.s.k === 'failed').length;
  const overdue = today.filter((x) => x.s.k === 'overdue').length;
  const critical = acts.filter((a) => a.critical).length;
  const hr = new Date().getHours();

  const row = ({ c, s }) => h('div', { class: 'item' },
    h('span', { class: 'tint ' + ({ done: 'ok', failed: 'bad', overdue: 'bad', progress: 'info' }[s.k] || 'gray') }, icon({ done: 'circle-check', failed: 'circle-x', overdue: 'triangle-alert', progress: 'timer' }[s.k] || 'clipboard-list', 'sm')),
    h('div', { class: 'main' }, h('div', { class: 't' }, c.name),
      h('div', { class: 'm' }, h('span', {}, `${itemCount(c)} items`), c.dueTime && s.k !== 'ondemand' ? h('span', { class: 'dotsep' }, `Due ${fmtDue(c.dueTime)}`) : null, c.category ? h('span', { class: 'dotsep' }, c.category) : null,
        s.run && s.run.status === 'submitted' ? h('span', { class: 'dotsep' }, `${s.run.submittedBy || s.run.auditor} at ${fmtTime(s.run.submittedAt)}`) : null)),
    h('div', { class: 'side-r' }, s.k === 'progress' ? h('div', { style: 'width:90px' }, bar(s.run.progress)) : null, s.chip,
      s.k === 'progress' ? btn('Resume', 'play', () => go('#/run/' + s.run.id), 'sm primary')
        : s.k === 'done' || s.k === 'failed' ? btn('View', null, () => go('#/report/' + s.run.id), 'sm')
          : btn('Start', 'play', () => startRun(c.id), 'sm primary')));

  mount(
    head(`Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${me.name.split(' ')[0]}`, new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
      isMgr() ? btn('New checklist', 'plus', () => go('#/builder/new'), 'primary') : null),
    h('div', { class: 'kpis' },
      h('div', { class: 'panel kpi' }, h('div', { class: 'kpi-top' }, tint('list-checks', 'brand'), "Today's checklists"), h('div', { class: 'kpi-v' }, `${finished}/${today.length}`), bar(today.length ? (finished / today.length) * 100 : 0)),
      h('div', { class: 'panel kpi' }, h('div', { class: 'kpi-top' }, tint('trending-up', avg == null ? 'gray' : scoreKind(avg)), 'Avg score · 7 days'), h('div', { class: 'kpi-v' }, avg == null ? '—' : Math.round(avg) + '%'), h('div', { class: 'kpi-s' }, `${wk.length} audit${wk.length === 1 ? '' : 's'} completed`)),
      h('div', { class: 'panel kpi' }, h('div', { class: 'kpi-top' }, tint('wrench', acts.length ? 'warn' : 'ok'), 'Open actions'), h('div', { class: 'kpi-v' }, acts.length), h('div', { class: 'kpi-s' }, critical ? h('span', { style: 'color:var(--bad);font-weight:600' }, `${critical} critical`) : 'Nothing critical')),
      h('div', { class: 'panel kpi' }, h('div', { class: 'kpi-top' }, tint('clock', overdue ? 'bad' : 'ok'), 'Overdue'), h('div', { class: 'kpi-v' }, overdue), h('div', { class: 'kpi-s' }, overdue ? 'Needs attention now' : 'All on track'))),
    h('div', { class: 'grid-main' },
      h('div', { class: 'stack' },
        panel("Today's checklists", { sub: `${finished} of ${today.length} complete` }, today.length ? h('div', { class: 'list' }, today.map(row)) : empty('calendar', 'Nothing scheduled today', cl.length ? 'On-demand checklists are listed below.' : 'Create your first checklist to get started.', !cl.length && isMgr() ? btn('New checklist', 'plus', () => go('#/builder/new'), 'primary') : null)),
        other.length ? panel('On demand', { sub: 'Run these whenever they are needed' }, h('div', { class: 'list' }, other.map(row))) : null),
      h('div', { class: 'stack' },
        panel('Performance', { sub: 'Last 7 days' }, h('div', { class: 'panel-b row', style: 'gap:22px;flex-wrap:nowrap' },
          avg == null ? ring(0, 104, 'var(--line)', 'No data') : ring(avg, 104, scoreColor(avg), 'avg score'),
          h('div', { class: 'stats', style: 'margin:0;display:grid;gap:12px' },
            h('div', {}, h('b', {}, passRate == null ? '—' : passRate + '%'), 'Pass rate'),
            h('div', {}, h('b', {}, wk.length), 'Audits completed')))),
        panel('Open actions', { acts: acts.length ? h('a', { class: 'btn sm ghost', href: '#/actions' }, 'View all') : null },
          acts.length ? h('div', { class: 'list' }, acts.slice(0, 4).map((a) => h('div', { class: 'item link', onclick: () => go('#/actions') },
            tint(a.critical ? 'siren' : 'wrench', a.critical ? 'bad' : 'warn'),
            h('div', { class: 'main' }, h('div', { class: 't' }, a.title), h('div', { class: 'm' }, a.checklistName, h('span', { class: 'dotsep' }, fmtDate(a.createdAt)))))))
            : empty('shield-check', 'All clear', 'No open corrective actions.')),
        panel('Recent audits', { acts: done.length ? h('a', { class: 'btn sm ghost', href: '#/audits' }, 'View all') : null },
          done.length ? h('div', { class: 'list' }, done.slice(0, 5).map((r) => h('div', { class: 'item link', onclick: () => go('#/report/' + r.id) },
            avatar(r.submittedBy || r.auditor), h('div', { class: 'main' }, h('div', { class: 't' }, r.checklistName), h('div', { class: 'm' }, `${r.submittedBy || r.auditor} · ${fmtDate(r.submittedAt)}`)),
            h('b', { class: 'num', style: `color:${scoreColor(r.percent)}` }, Math.round(r.percent) + '%'))))
            : empty('file-check-2', 'No audits yet', 'Completed audits show up here.')))));
}

async function startRun(checklistId) {
  try { const run = await api('POST', '/runs', { checklistId, location: localStorage.getItem('location') || '' }); go('#/run/' + run.id); } catch (e) { fail(e); }
}

// ---------- checklists
async function checklists() {
  const cl = await api('GET', '/checklists');
  const del = async (c) => { if (!confirm(`Delete "${c.name}"? Past audits are kept.`)) return; try { await api('DELETE', '/checklists/' + c.id); toast('Checklist deleted'); checklists(); } catch (e) { fail(e); } };
  const dup = async (c) => { try { await api('POST', `/checklists/${c.id}/duplicate`); toast('Checklist duplicated'); checklists(); } catch (e) { fail(e); } };
  mount(head('Checklists', 'Build the templates your team audits against.', btn('New checklist', 'plus', () => go('#/builder/new'), 'primary')),
    h('section', { class: 'panel' }, cl.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
      h('tr', {}, h('th', {}, 'Checklist'), h('th', { class: 'hide-sm' }, 'Schedule'), h('th', { class: 'hide-sm' }, 'Items'), h('th', { class: 'hide-sm' }, 'Pass mark'), h('th', { class: 'r' }, '')),
      cl.map((c) => h('tr', { class: 'link', onclick: (e) => { if (!e.target.closest('button')) go('#/builder/' + c.id); } },
        h('td', {}, h('div', { class: 'cell' }, tint('clipboard-list', 'brand'), h('div', {}, h('b', {}, c.name), h('small', {}, c.category || 'General')))),
        h('td', { class: 'hide-sm' }, h('div', {}, schedText(c)), c.dueTime && c.frequency !== 'none' ? h('small', { class: 'hint' }, 'Due ' + fmtDue(c.dueTime)) : null),
        h('td', { class: 'hide-sm n' }, itemCount(c)),
        h('td', { class: 'hide-sm n' }, c.passScore + '%'),
        h('td', { class: 'r', style: 'white-space:nowrap' }, btn('Start', 'play', () => startRun(c.id), 'sm'), ' ',
          iconBtn('pencil', 'Edit', () => go('#/builder/' + c.id)), iconBtn('copy', 'Duplicate', () => dup(c)), iconBtn('trash-2', 'Delete', () => del(c)))))))
      : empty('clipboard-list', 'No checklists yet', 'Create your first checklist. Opening, closing, temperature logs, anything.', btn('New checklist', 'plus', () => go('#/builder/new'), 'primary'))));
}

// ---------- builder
async function builder(id) {
  const c = id === 'new' ? { name: '', category: 'General', description: '', frequency: 'daily', days: [], dueTime: '', passScore: 80, questions: [] } : await api('GET', '/checklists/' + id);
  const open = new Set();
  let dirty = false;
  const stateEl = h('span', { class: 'save-state' });
  const touch = () => { dirty = true; stateEl.replaceChildren(icon('circle-dashed', 'sm'), 'Unsaved changes'); };
  leaveGuard = () => dirty && !confirm('You have unsaved changes. Leave anyway?');
  const groups = {};
  Object.entries(TYPES).forEach(([k, t]) => (groups[t.group] = groups[t.group] || []).push([k, t]));
  const list = h('div', {});
  const drawList = () => list.replaceChildren(...(c.questions.length ? c.questions.map((q, i) => qCard(q, i)) : [h('section', { class: 'panel' }, empty('plus', 'No questions yet', 'Pick a question type from the panel to add your first one.'))]));
  const draw = () => { drawList(); };

  function qCard(q, i) {
    const t = TYPES[q.type], isOpen = open.has(q.id);
    const n = c.questions.slice(0, i + 1).filter((x) => x.type !== 'section').length;
    const mv = (d) => { const j = i + d; if (j < 0 || j >= c.questions.length) return; [c.questions[i], c.questions[j]] = [c.questions[j], c.questions[i]]; touch(); draw(); };
    return h('div', { class: 'q' + (q.type === 'section' ? ' sec' : '') + (isOpen ? ' open' : '') },
      h('div', { class: 'qh', onclick: (e) => { if (e.target.closest('button')) return; isOpen ? open.delete(q.id) : open.add(q.id); draw(); } },
        h('span', { class: 'qn' }, q.type === 'section' ? '' : n), typeTint(q.type),
        h('div', { class: 'main' }, h('div', { class: 't' + (q.label ? '' : ' empty') }, q.label || (q.type === 'section' ? 'Untitled section' : 'Untitled question')),
          h('div', { class: 'm' }, h('span', { class: 'hint' }, t.label), q.required && q.type !== 'section' ? chip('Required', '', true) : null, q.critical ? chip('Critical', 'bad') : null, q.showIf ? chip('Conditional', 'info', true) : null)),
        iconBtn('chevron-up', 'Move up', () => mv(-1)), iconBtn('chevron-down', 'Move down', () => mv(1)),
        iconBtn('trash-2', 'Delete question', () => { c.questions.splice(i, 1); touch(); draw(); })),
      isOpen ? h('div', { class: 'qb' }, qEditor(q, i)) : null);
  }
  function qEditor(q, i) {
    const set = (k, v, redraw) => { q[k] = v; touch(); if (redraw) draw(); };
    const num = (v) => (v === '' ? null : Number(v));
    const sel = (value, opts, onchange) => h('select', { onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(value) === String(v) }, l)));
    const optsEditor = (withScore) => h('div', { class: 'field', style: 'margin-top:14px' }, h('span', {}, withScore ? 'Options · score is the % of points earned' : 'Items to tick'),
      q.options.map((o, oi) => h('div', { class: 'opt' },
        h('input', { value: o.label, placeholder: 'Option label', oninput: (e) => { o.label = e.target.value; touch(); } }),
        withScore ? h('input', { class: 'n', type: 'number', min: 0, max: 100, value: o.score ?? 100, title: 'Score %', oninput: (e) => { o.score = Number(e.target.value); touch(); } }) : null,
        iconBtn('x', 'Remove', () => { q.options.splice(oi, 1); touch(); draw(); }, ''))),
      btn(withScore ? 'Add option' : 'Add item', 'plus', () => { q.options.push(withScore ? { label: '', score: 100 } : { label: '' }); touch(); draw(); }, 'sm'));
    const prior = c.questions.slice(0, i).filter((x) => x.type !== 'section');
    const sIf = q.showIf;
    const out = [h('div', { class: 'fields', style: 'margin-top:12px' },
      field(q.type === 'section' ? 'Section heading' : 'Question', h('input', { value: q.label, placeholder: q.type === 'section' ? 'e.g. Equipment' : 'e.g. Walk-in cooler temperature', oninput: (e) => set('label', e.target.value) })),
      field('Help text', h('input', { value: q.help, placeholder: 'Optional instructions shown under the question', oninput: (e) => set('help', e.target.value) })))];
    if (q.type === 'yesno') out.push(h('div', { style: 'margin-top:14px' }, field('Passing answer', sel(q.passOn || 'yes', [['yes', 'Yes passes'], ['no', 'No passes']], (v) => set('passOn', v)))));
    if (['choice', 'dropdown', 'multi'].includes(q.type)) out.push(optsEditor(true));
    if (q.type === 'tick') out.push(optsEditor(false));
    if (['number', 'temperature', 'slider'].includes(q.type)) out.push(h('div', { class: 'g3', style: 'margin-top:14px' },
      field(q.type === 'temperature' ? 'Min safe' : 'Min', h('input', { type: 'number', value: q.min ?? '', oninput: (e) => set('min', num(e.target.value)) })),
      field(q.type === 'temperature' ? 'Max safe' : 'Max', h('input', { type: 'number', value: q.max ?? '', oninput: (e) => set('max', num(e.target.value)) })),
      field('Unit', q.type === 'temperature' ? sel(q.unit, [['°F', '°F'], ['°C', '°C']], (v) => set('unit', v)) : h('input', { value: q.unit || '', oninput: (e) => set('unit', e.target.value) }))));
    if (q.type === 'slider') out.push(h('div', { class: 'g2', style: 'margin-top:14px' },
      field('Step', h('input', { type: 'number', value: q.step, oninput: (e) => set('step', Number(e.target.value) || 1) })),
      field('Minimum to pass', h('input', { type: 'number', value: q.passMin ?? '', oninput: (e) => set('passMin', num(e.target.value)) }))));
    if (q.type === 'rating') out.push(h('div', { class: 'g2', style: 'margin-top:14px' },
      field('Number of stars', h('input', { type: 'number', min: 3, max: 10, value: q.max, oninput: (e) => set('max', Number(e.target.value) || 5) })),
      field('Minimum to pass', h('input', { type: 'number', value: q.passMin ?? '', oninput: (e) => set('passMin', num(e.target.value)) }))));
    if (q.type !== 'section') {
      const rule = [['never', 'Optional'], ['fail', 'Required if failed'], ['always', 'Always required']];
      out.push(h('div', { class: 'g3', style: 'margin-top:14px' },
        field('Points', h('input', { type: 'number', min: 0, value: q.points, oninput: (e) => set('points', Number(e.target.value) || 0) })),
        field('Photo', sel(q.photoOn, rule, (v) => set('photoOn', v))),
        field('Note', sel(q.noteOn, rule, (v) => set('noteOn', v)))));
      out.push(h('div', { class: 'toggles' },
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: q.required, onchange: (e) => set('required', e.target.checked, true) }), 'Required'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: q.critical, onchange: (e) => set('critical', e.target.checked, true) }), 'Critical', h('span', { class: 'hint' }, ' · a fail fails the whole audit')),
        ['yesno', 'passfail'].includes(q.type) ? null : h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: q.allowNA, onchange: (e) => set('allowNA', e.target.checked) }), 'Allow N/A')));
    }
    out.push(h('div', { class: 'field', style: 'margin-top:16px' }, h('span', {}, 'Logic'),
      h('div', { class: 'row' },
        h('select', { style: 'flex:2;min-width:180px', onchange: (e) => { q.showIf = e.target.value ? { qid: e.target.value, op: 'fail', value: '' } : null; touch(); draw(); } },
          h('option', { value: '' }, 'Always show this question'), prior.map((p) => h('option', { value: p.id, selected: sIf && sIf.qid === p.id }, 'Only show when: ' + (p.label || TYPES[p.type].label)))),
        sIf ? h('select', { style: 'flex:1;min-width:120px', onchange: (e) => { sIf.op = e.target.value; touch(); draw(); } }, [['fail', 'fails'], ['pass', 'passes'], ['eq', 'equals'], ['neq', 'does not equal'], ['answered', 'is answered']].map(([v, l]) => h('option', { value: v, selected: sIf.op === v }, l))) : null,
        sIf && ['eq', 'neq'].includes(sIf.op) ? h('input', { style: 'flex:1;min-width:120px', placeholder: 'Value, e.g. yes', value: sIf.value, oninput: (e) => { sIf.value = e.target.value; touch(); } }) : null)));
    return out;
  }
  async function save() {
    if (!c.name.trim()) return toast('Give the checklist a name', true);
    try {
      const saved = id === 'new' ? await api('POST', '/checklists', c) : await api('PUT', '/checklists/' + id, c);
      dirty = false; stateEl.replaceChildren(icon('check', 'sm'), 'All changes saved'); toast('Checklist saved');
      if (id === 'new') { leaveGuard = null; go('#/builder/' + saved.id); }
    } catch (e) { fail(e); }
  }
  const daysPicker = h('div', {});
  const drawDays = () => daysPicker.replaceChildren(c.frequency === 'days' ? h('div', { class: 'pills', style: 'margin-top:10px' }, DAYS.map((d, i) => h('button', { class: (c.days || []).includes(i) ? 'on' : '', onclick: () => { const s = new Set(c.days || []); s.has(i) ? s.delete(i) : s.add(i); c.days = [...s].sort(); touch(); drawDays(); } }, d))) : '');
  drawDays();
  mount(
    h('a', { class: 'crumb', href: '#/checklists' }, icon('arrow-left', 'sm'), 'Checklists'),
    head(id === 'new' ? 'New checklist' : c.name || 'Edit checklist', null, stateEl, btn('Save checklist', 'save', save, 'primary')),
    h('div', { class: 'builder' },
      h('div', {},
        panel('Details', {}, h('div', { class: 'panel-b fields' },
          field('Checklist name', h('input', { value: c.name, placeholder: 'e.g. Opening Kitchen Audit', oninput: (e) => { c.name = e.target.value; touch(); } })),
          field('Description', h('input', { value: c.description, placeholder: 'Optional. Shown at the top of the audit.', oninput: (e) => { c.description = e.target.value; touch(); } })),
          h('div', { class: 'g3' },
            field('Category', h('input', { value: c.category, oninput: (e) => { c.category = e.target.value; touch(); } })),
            field('Due time', h('input', { type: 'time', value: c.dueTime, oninput: (e) => { c.dueTime = e.target.value; touch(); } })),
            field('Pass mark (%)', h('input', { type: 'number', min: 0, max: 100, value: c.passScore, oninput: (e) => { c.passScore = Number(e.target.value); touch(); } }))),
          h('div', { class: 'field' }, h('span', {}, 'Schedule'),
            h('select', { style: 'max-width:280px', onchange: (e) => { c.frequency = e.target.value; c.days = c.days || []; touch(); drawDays(); } },
              [['daily', 'Every day'], ['days', 'Specific days'], ['none', 'On demand (not scheduled)']].map(([v, l]) => h('option', { value: v, selected: (c.frequency || 'daily') === v }, l))),
            daysPicker))),
        h('div', { class: 'row', style: 'margin:24px 0 10px' }, h('h2', {}, 'Questions'), h('span', { class: 'hint' }, `${itemCount(c)} items`)),
        list),
      h('aside', { class: 'panel palette' }, h('h2', { style: 'padding:4px 6px 0' }, 'Add question'),
        Object.entries(groups).map(([g, arr]) => [h('h4', {}, g), arr.map(([k, t]) => h('button', { onclick: () => { const q = newQuestion(k); c.questions.push(q); open.clear(); open.add(q.id); touch(); draw(); setTimeout(() => { const els = list.querySelectorAll('.q'); const last = els[els.length - 1]; if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const inp = last.querySelector('input'); inp && inp.focus({ preventScroll: true }); } }, 50); } }, typeTint(k), t.label))]))));
  stateEl.replaceChildren(icon('check', 'sm'), id === 'new' ? 'Not saved yet' : 'All changes saved');
  draw();
}

// ---------- runner
async function runner(id) {
  const run = await api('GET', '/runs/' + id);
  if (run.status === 'submitted') return go('#/report/' + id);
  const c = run.checklist, ans = run.answers;
  const A = (qid) => (ans[qid] = ans[qid] || {});
  let errs = new Map(); // qid -> reason, from a blocked submit
  const saveEl = h('span', { class: 'save-state' }, icon('check', 'sm'), 'Saved');
  const persist = debounce(async () => {
    saveEl.replaceChildren(icon('refresh-cw', 'sm'), 'Saving…');
    try { await api('PUT', '/runs/' + id, { answers: ans, location: run.location }); saveEl.replaceChildren(icon('check', 'sm'), 'Saved'); }
    catch (e) { saveEl.replaceChildren(icon('circle-alert', 'sm'), 'Not saved'); fail(e); }
  }, 700);
  const change = (redraw = true) => {
    const k = document.activeElement && document.activeElement.closest && document.activeElement.closest('.rq');
    if (k) errs.delete(k.id.slice(2)); saveEl.replaceChildren(icon('circle-dashed', 'sm'), 'Unsaved'); persist(); updateProg(); if (redraw) drawQs(); };
  const progBar = bar(0), progTxt = h('span', { class: 'hint num' }), bottomTxt = h('div', { class: 'grow' });
  const qWrap = h('div', {});
  function updateProg() {
    const s = score(c, ans);
    progBar.firstChild.style.width = s.progress + '%';
    progTxt.textContent = `${s.answered} of ${s.total} answered`;
    bottomTxt.replaceChildren(h('div', { style: 'font-weight:600' }, `${s.answered}/${s.total} answered`), h('div', { class: 'hint' }, s.answered ? `Score so far ${Math.round(s.percent)}%${s.fails ? ` · ${s.fails} failed` : ''}` : 'Answer each item to finish'));
  }
  function drawQs() {
    const focus = document.activeElement, fid = focus && focus.dataset && focus.dataset.k, pos = focus && focus.selectionStart;
    let n = 0;
    qWrap.replaceChildren(...c.questions.filter((q) => isVisible(q, c, ans)).map((q) => qView(q, q.type === 'section' ? 0 : ++n)));
    if (fid) { const el = qWrap.querySelector(`[data-k="${fid}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch {} } }
  }
  function qView(q, n) {
    if (q.type === 'section') return h('div', { class: 'sec-h' }, h('h2', {}, q.label || 'Section'), q.help ? h('span', { class: 'hint' }, q.help) : null);
    const a = A(q.id), res = evaluate(q, a);
    const answered = !Shared.isBlank(a.value) || a.na;
    const wantN = needs(q, res, 'note'), wantP = needs(q, res, 'photo');
    const st = a.na ? 'done' : { fail: 'fail', pass: 'done', info: 'done', partial: 'partial' }[res.status] || '';
    const num = h('span', { class: 'rq-n ' + st }, st === 'fail' ? icon('x', 'sm') : st === 'done' ? icon('check', 'sm') : n);
    const card = h('div', { class: 'panel rq' + (errs.has(q.id) ? ' err' : ''), id: 'q-' + q.id },
      h('div', { class: 'rq-h' }, num, h('div', { class: 'grow' },
        h('div', { class: 'rq-l' }, q.label || TYPES[q.type].label, q.required ? h('span', { class: 'req' }, ' *') : null),
        q.help ? h('div', { class: 'rq-help' }, q.help) : null),
        q.critical ? chip('Critical', 'bad') : null),
      errs.has(q.id) ? h('div', { class: 'row', style: 'color:var(--bad);font-weight:600;margin:-4px 0 12px' }, icon('circle-alert', 'sm'), errs.get(q.id)) : null,
      a.na ? chip('Not applicable', '', true) : input(q, a));
    if (q.allowNA && !['yesno', 'passfail'].includes(q.type)) card.append(h('label', { class: 'switch', style: 'margin-top:12px' }, h('input', { type: 'checkbox', checked: !!a.na, onchange: (e) => { a.na = e.target.checked; change(); } }), 'Not applicable'));
    const showExtra = (answered && !a.na && q.type !== 'photo') || wantN || wantP;
    if (showExtra) {
      const extra = h('div', { class: 'rq-extra' });
      if (res.status === 'fail') extra.append(h('div', { class: 'row', style: 'margin-bottom:12px;color:var(--bad);font-weight:600' }, icon('triangle-alert', 'sm'), q.critical ? 'Critical item failed. Explain what you did about it.' : 'Failed. Add a note on what you did about it.'));
      extra.append(field('Note' + (wantN ? ' (required)' : ''), h('textarea', { 'data-k': 'n' + q.id, placeholder: wantN ? 'What happened, and what did you do about it?' : 'Optional note', value: a.note || '', oninput: (e) => { a.note = e.target.value; change(false); } })));
      extra.append(h('div', { style: 'margin-top:12px' }, photoBox(q, a, wantP)));
      card.append(extra);
    }
    return card;
  }
  function photoBox(q, a, req) {
    return h('div', { class: 'photos' },
      (a.photos || []).map((p, i) => h('div', { class: 'ph' }, h('img', { src: p, alt: 'Photo ' + (i + 1) }), iconBtn('x', 'Remove photo', () => { a.photos.splice(i, 1); change(); }, ''))),
      h('label', { class: 'upload' + (req && !(a.photos || []).length ? ' need' : '') }, icon('camera'), req && !(a.photos || []).length ? 'Photo required' : 'Add photo',
        h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; (a.photos = a.photos || []).push(await shrink(f)); change(); } })));
  }
  function input(q, a) {
    const set = (v) => { a.value = v; change(); };
    switch (q.type) {
      case 'yesno': { const pass = q.passOn || 'yes';
        return h('div', { class: 'seg' }, ['yes', 'no'].map((v) => h('button', { class: (a.value === v ? 'on ' : '') + (pass === v ? 'ok' : 'bad'), onclick: () => set(v) }, icon(v === 'yes' ? 'check' : 'x', 'sm'), v === 'yes' ? 'Yes' : 'No'))); }
      case 'passfail': return h('div', { class: 'seg' }, [['pass', 'Pass', 'ok', 'check'], ['fail', 'Fail', 'bad', 'x'], ['na', 'N/A', 'neutral', 'ban']].map(([v, l, k, ic]) => h('button', { class: (a.value === v ? 'on ' : '') + k, onclick: () => set(v) }, icon(ic, 'sm'), l)));
      case 'choice': return h('div', {}, q.options.map((o) => h('label', { class: 'opt-row' + (a.value === o.label ? ' on' : '') }, h('input', { type: 'radio', name: q.id, checked: a.value === o.label, onchange: () => set(o.label) }), o.label)));
      case 'dropdown': return h('select', { style: 'height:48px', onchange: (e) => set(e.target.value) }, h('option', { value: '' }, 'Select an option'), q.options.map((o) => h('option', { selected: a.value === o.label }, o.label)));
      case 'multi': case 'tick': return h('div', {}, q.options.map((o) => { const on = (a.value || []).includes(o.label);
        return h('label', { class: 'opt-row' + (on ? ' on' : '') }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { const s = new Set(a.value || []); e.target.checked ? s.add(o.label) : s.delete(o.label); set(q.options.map((x) => x.label).filter((l) => s.has(l))); } }), o.label); }));
      case 'number': case 'temperature': { const hasRange = q.min != null || q.max != null;
        return h('div', {}, h('div', { class: 'temp-in' }, h('input', { type: 'number', step: 'any', inputmode: 'decimal', placeholder: '0', 'data-k': 'v' + q.id, value: a.value ?? '', oninput: (e) => { a.value = e.target.value === '' ? undefined : Number(e.target.value); change(true); } }), h('b', { style: 'font-size:18px;color:var(--mute)' }, q.unit || '')),
          hasRange ? h('div', { class: 'range-hint' }, icon(q.type === 'temperature' ? 'thermometer' : 'info', 'sm'), `Acceptable: ${q.min ?? '—'} to ${q.max ?? '—'} ${q.unit || ''}`) : null); }
      case 'slider': return h('div', { class: 'row', style: 'gap:16px' }, h('input', { type: 'range', class: 'grow', min: q.min, max: q.max, step: q.step || 1, value: a.value ?? q.min, oninput: (e) => { a.value = Number(e.target.value); e.target.nextSibling.textContent = a.value + (q.unit || ''); persist(); updateProg(); }, onchange: () => change() }), h('b', { class: 'num', style: 'min-width:60px;font-size:18px' }, a.value != null ? a.value + (q.unit || '') : '—'));
      case 'rating': return h('div', { class: 'stars' }, Array.from({ length: q.max || 5 }, (_, i) => h('button', { class: a.value > i ? 'on' : '', 'aria-label': `${i + 1} star${i ? 's' : ''}`, onclick: () => set(a.value === i + 1 ? undefined : i + 1) }, icon('star'))));
      case 'text': return h('input', { 'data-k': 'v' + q.id, placeholder: 'Type your answer', value: a.value || '', oninput: (e) => { a.value = e.target.value; change(false); } });
      case 'longtext': return h('textarea', { 'data-k': 'v' + q.id, placeholder: 'Type your answer', value: a.value || '', oninput: (e) => { a.value = e.target.value; change(false); } });
      case 'date': return h('input', { type: 'date', style: 'max-width:240px', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'time': return h('input', { type: 'time', style: 'max-width:240px', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'datetime': return h('input', { type: 'datetime-local', style: 'max-width:280px', value: a.value || '', onchange: (e) => set(e.target.value) });
      case 'photo': return photoBox(q, a, q.required);
      case 'signature': return sigPad(a, () => change(false));
    }
  }
  const submitBtn = btn('Submit audit', 'check', submit, 'primary');
  async function submit() {
    submitBtn.disabled = true;
    try { await api('POST', `/runs/${id}/submit`, { answers: ans, location: run.location }); toast('Audit submitted'); go('#/report/' + id); }
    catch (e) {
      submitBtn.disabled = false;
      if (e.problems) { errs = new Map(e.problems.map((p) => [p.qid, { Required: 'This question needs an answer', 'Tick every item': 'Tick every item before submitting', 'Note required': 'Add a note before submitting', 'Photo required': 'Add a photo before submitting' }[p.reason] || p.reason])); drawQs(); toast(`${e.problems.length} item${e.problems.length > 1 ? 's need' : ' needs'} attention`, true); const el = document.getElementById('q-' + e.problems[0].qid); el && el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else fail(e);
    }
  }
  drawQs();
  mount(
    h('a', { class: 'crumb', href: '#/' }, icon('arrow-left', 'sm'), 'Exit · progress is saved'),
    h('div', { class: 'head', style: 'margin-bottom:16px' }, h('div', {}, h('h1', {}, c.name), c.description ? h('p', {}, c.description) : null), h('div', { class: 'acts' }, saveEl)),
    h('div', { class: 'run-head' }, h('section', { class: 'panel' }, h('div', { class: 'panel-b', style: 'padding:16px 20px' },
      h('div', { class: 'g2' },
        h('div', { class: 'field' }, h('span', {}, 'Auditor'), h('div', { class: 'row', style: 'height:40px' }, avatar(run.auditor || me.name), h('b', {}, run.auditor || me.name), run.updatedBy && run.updatedBy !== run.auditor ? h('span', { class: 'hint' }, `· last edit by ${run.updatedBy}`) : null)),
        field('Location / station', h('input', { value: run.location, placeholder: 'e.g. Main kitchen', oninput: (e) => { run.location = e.target.value; localStorage.setItem('location', run.location); persist(); } }))),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('div', { class: 'grow' }, progBar), progTxt)))),
    qWrap,
    h('div', { class: 'bottom-bar' }, h('div', { class: 'panel' }, bottomTxt,
      iconBtn('trash-2', 'Discard audit', async () => { if (!confirm('Discard this audit? Answers will be lost.')) return; try { await api('DELETE', '/runs/' + id); toast('Audit discarded'); go('#/'); } catch (e) { fail(e); } }),
      submitBtn)));
  updateProg();
}

function shrink(file, max = 900) {
  return new Promise((ok) => { const img = new Image(); img.onload = () => {
    const s = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
    cv.width = img.width * s; cv.height = img.height * s; cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); ok(cv.toDataURL('image/jpeg', 0.75)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file); });
}
function sigPad(a, onChange) {
  const cv = h('canvas', { class: 'sig', width: 700, height: 220 }), g = cv.getContext('2d');
  g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0E1525';
  if (a.value) { const im = new Image(); im.onload = () => g.drawImage(im, 0, 0, cv.width, cv.height); im.src = a.value; }
  let down = false;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = (e) => { down = true; cv.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); };
  cv.onpointermove = (e) => { if (!down) return; g.lineTo(...pt(e)); g.stroke(); };
  cv.onpointerup = () => { if (!down) return; down = false; a.value = cv.toDataURL('image/png'); onChange(); };
  return h('div', {}, cv, h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'hint grow' }, 'Sign with your finger or mouse'), btn('Clear', 'x', () => { g.clearRect(0, 0, cv.width, cv.height); a.value = undefined; onChange(); }, 'sm')));
}

// ---------- audits + report
function auditTable(runs) {
  if (!runs.length) return empty('file-check-2', 'No audits yet', 'Completed audits will show up here.');
  return h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
    h('tr', {}, h('th', {}, 'Checklist'), h('th', { class: 'hide-sm' }, 'Completed by'), h('th', {}, 'Score'), h('th', {}, 'Result'), h('th', { class: 'hide-sm' }, 'Date')),
    runs.map((r) => h('tr', { class: 'link', onclick: () => go('#/report/' + r.id) },
      h('td', {}, h('div', { class: 'cell' }, h('div', {}, h('b', {}, r.checklistName), r.location ? h('small', {}, r.location) : null))),
      h('td', { class: 'hide-sm' }, h('div', { class: 'cell' }, avatar(r.submittedBy || r.auditor), r.submittedBy || r.auditor || '—')),
      h('td', {}, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('b', { class: 'num', style: 'width:40px' }, Math.round(r.percent) + '%'), h('div', { style: 'width:80px' }, bar(r.percent, scoreKind(r.percent))))),
      h('td', {}, resultChip(r)),
      h('td', { class: 'hide-sm hint' }, fmtDate(r.submittedAt))))));
}
async function audits() {
  const [runs, drafts] = await Promise.all([api('GET', '/runs?status=submitted'), api('GET', '/runs?status=draft')]);
  mount(head('Audits', 'Every completed audit, newest first.'),
    drafts.length ? panel('In progress', { icon: 'timer', tint: 'info', sub: `${drafts.length} unfinished` }, h('div', { class: 'list' }, drafts.map((d) => h('div', { class: 'item' },
      avatar(d.auditor), h('div', { class: 'main' }, h('div', { class: 't' }, d.checklistName), h('div', { class: 'm' }, `${d.auditor || 'Unknown'} · started ${fmtDate(d.startedAt)}`)),
      h('div', { class: 'side-r' }, h('div', { style: 'width:90px' }, bar(d.progress)), h('span', { class: 'hint num' }, d.progress + '%'), btn('Resume', 'play', () => go('#/run/' + d.id), 'sm')))))) : null,
    panel('Completed', { sub: `${runs.length} audit${runs.length === 1 ? '' : 's'}` }, auditTable(runs)));
}
async function report(id) {
  const run = await api('GET', '/runs/' + id), c = run.checklist, s = score(c, run.answers);
  const who = run.submittedBy || run.auditor || 'Unknown';
  let n = 0;
  const sections = []; let cur = { title: null, items: [] }; sections.push(cur);
  for (const q of c.questions) {
    if (q.type === 'section') { cur = { title: q.label, items: [] }; sections.push(cur); continue; }
    if (!isVisible(q, c, run.answers)) continue;
    cur.items.push(q);
  }
  const STATUS = { pass: ['Pass', 'ok'], fail: ['Fail', 'bad'], partial: ['Partial', 'warn'], na: ['N/A', ''], info: ['Recorded', 'info'], blank: ['Skipped', ''] };
  const itemRow = (q) => {
    const a = run.answers[q.id] || {}, r = s.items[q.id] || { status: 'blank' }; n++;
    const [label, kind] = STATUS[r.status];
    return h('div', { class: 'item' + (r.status === 'fail' ? ' fail' : '') },
      h('span', { class: 'rq-n' + (r.status === 'fail' ? ' fail' : r.status === 'pass' ? ' done' : '') }, r.status === 'fail' ? icon('x', 'sm') : r.status === 'pass' ? icon('check', 'sm') : n),
      h('div', { class: 'main' }, h('div', { class: 't', style: 'white-space:normal' }, q.label, q.critical ? h('span', { style: 'margin-left:8px' }, chip('Critical', 'bad')) : null),
        q.type === 'signature' && a.value ? h('img', { src: a.value, alt: 'Signature', style: 'max-height:70px;background:#fff;border-radius:8px;border:1px solid var(--line);margin-top:6px' }) : h('div', { class: 'ans' }, displayVal(q, a)),
        a.note ? h('div', { class: 'note' }, icon('sticky-note', 'sm'), a.note) : null,
        (a.photos || []).length ? h('div', { class: 'photos', style: 'margin-top:10px' }, a.photos.map((p) => h('a', { href: p, target: '_blank' }, h('img', { src: p, alt: 'Photo', style: 'width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)' })))) : null),
      chip(label, kind, !kind));
  };
  mount(
    h('a', { class: 'crumb', href: '#/audits' }, icon('arrow-left', 'sm'), 'Audits'),
    h('section', { class: 'panel hero' },
      ring(run.percent, 128, scoreColor(run.percent), 'score'),
      h('div', { class: 'grow' }, h('div', { class: 'row', style: 'margin-bottom:6px' }, resultChip(run), s.criticalFails.length ? chip(`${s.criticalFails.length} critical failure${s.criticalFails.length > 1 ? 's' : ''}`, 'bad') : null),
        h('h1', {}, run.checklistName),
        h('div', { class: 'row hint' }, avatar(who), h('span', {}, who), h('span', { class: 'dotsep' }, fmtDate(run.submittedAt)), run.location ? h('span', { class: 'dotsep' }, run.location) : null),
        h('div', { class: 'stats' }, h('div', {}, h('b', {}, `${Math.round(run.earned * 10) / 10}/${run.max}`), 'Points'), h('div', {}, h('b', {}, s.fails), 'Failed items'), h('div', {}, h('b', {}, c.passScore + '%'), 'Pass mark'))),
      h('div', { style: 'align-self:flex-start' }, btn('Print', 'printer', () => print(), 'sm'))),
    sections.filter((x) => x.items.length).map((sec) => panel(sec.title || 'Items', { cls: '', sub: `${sec.items.length} item${sec.items.length > 1 ? 's' : ''}` }, h('div', { class: 'list' }, sec.items.map(itemRow)))));
}
const PRETTY = { yes: 'Yes', no: 'No', pass: 'Pass', fail: 'Fail', na: 'N/A' };
const displayVal = (q, a) => a.na ? 'Not applicable' : (q.type === 'yesno' || q.type === 'passfail') && PRETTY[a.value] ? PRETTY[a.value] : Array.isArray(a.value) ? (a.value.length ? a.value.join(', ') : '—') : a.value == null || a.value === '' ? '—' : String(a.value) + (['number', 'temperature', 'slider'].includes(q.type) ? ' ' + (q.unit || '') : q.type === 'rating' ? ` / ${q.max || 5}` : '');

// ---------- actions
async function actions(tab = 'open') {
  const list = await api('GET', '/actions');
  const open = list.filter((a) => a.status === 'open'), done = list.filter((a) => a.status !== 'open');
  const shown = tab === 'open' ? open : done;
  const row = (a) => h('div', { class: 'item' + (a.critical && a.status === 'open' ? ' fail' : '') },
    tint(a.status === 'open' ? (a.critical ? 'siren' : 'wrench') : 'circle-check', a.status === 'open' ? (a.critical ? 'bad' : 'warn') : 'ok'),
    h('div', { class: 'main' },
      h('div', { class: 'row' }, h('span', { class: 't' }, a.title), a.critical ? chip('Critical', 'bad') : null),
      h('div', { class: 'm' }, h('span', {}, a.checklistName), a.location ? h('span', { class: 'dotsep' }, a.location) : null, h('span', { class: 'dotsep' }, fmtDate(a.createdAt)),
        h('a', { class: 'dotsep', href: '#/report/' + a.runId, style: 'color:var(--brand);text-decoration:none;font-weight:500' }, 'View audit')),
      a.note ? h('div', { class: 'note' }, icon('sticky-note', 'sm'), a.note) : null,
      a.status === 'open' ? h('input', { placeholder: 'How was it fixed? (optional)', value: a.resolution || '', style: 'margin-top:10px;max-width:520px', onchange: (e) => api('PUT', '/actions/' + a.id, { resolution: e.target.value }).then(() => toast('Note saved')).catch(fail) })
        : h('div', { class: 'note', style: 'color:var(--ok)' }, icon('check', 'sm'), `Fixed by ${a.resolvedBy || 'someone'} · ${fmtDate(a.resolvedAt)}${a.resolution ? ' — ' + a.resolution : ''}`)),
    h('div', { class: 'side-r' }, a.status === 'open'
      ? btn('Mark fixed', 'check', async () => { try { await api('PUT', '/actions/' + a.id, { status: 'done' }); toast('Marked as fixed'); refreshBadge(); actions(tab); } catch (e) { fail(e); } }, 'sm primary')
      : btn('Reopen', 'refresh-cw', async () => { try { await api('PUT', '/actions/' + a.id, { status: 'open' }); refreshBadge(); actions(tab); } catch (e) { fail(e); } }, 'sm')));
  mount(head('Actions', 'Every failed item from a submitted audit lands here until someone fixes it.'),
    h('div', { class: 'tabs' }, h('button', { class: tab === 'open' ? 'on' : '', onclick: () => actions('open') }, `Open (${open.length})`), h('button', { class: tab === 'done' ? 'on' : '', onclick: () => actions('done') }, `Resolved (${done.length})`)),
    h('section', { class: 'panel' }, shown.length ? h('div', { class: 'list' }, shown.slice(0, 100).map(row))
      : tab === 'open' ? empty('shield-check', 'All clear', 'No open actions. The kitchen is in good shape.') : empty('circle-check', 'Nothing resolved yet')));
}

// ---------- TV display settings
async function display() {
  const [b, cl] = await Promise.all([api('GET', '/board'), api('GET', '/checklists')]);
  b.announcements = b.announcements || []; b.liveChecklistIds = b.liveChecklistIds || [];
  const SL = { today: ['list-checks', "Today's checklists", 'Done, in progress, due and overdue at a glance'], scores: ['trending-up', 'Scores', 'Recent audit scores and the 7-day trend'], actions: ['wrench', 'Open actions', 'Unresolved corrective actions, critical first'], live: ['activity', 'Live checklist', 'Item-by-item progress of pinned checklists'], announce: ['megaphone', 'Announcements', 'Full-screen messages for the team'] };
  const save = async () => { try { Object.assign(b, await api('PUT', '/board', b)); toast('TV board saved'); } catch (e) { fail(e); } };
  const tvUrl = () => `${location.origin}/tv?key=${b.tvKey}`;
  const draw = () => mount(
    head('TV Display', 'Turn any TV or tablet into a live kitchen board. It refreshes itself every 15 seconds.',
      h('a', { class: 'btn', href: tvUrl(), target: '_blank' }, icon('external-link', 'sm'), 'Open board'), btn('Save changes', 'save', save, 'primary')),
    h('div', { class: 'grid-main' },
      h('div', { class: 'stack' },
        panel('Slides', { sub: 'Shown in this order. Untick to hide.' }, h('div', { class: 'list' }, b.slides.map((s, i) => h('div', { class: 'item' },
          h('input', { type: 'checkbox', checked: s.on, onchange: (e) => (s.on = e.target.checked), 'aria-label': 'Show ' + SL[s.type][1] }), tint(SL[s.type][0], s.on ? 'brand' : 'gray'),
          h('div', { class: 'main' }, h('div', { class: 't' }, SL[s.type][1]), h('div', { class: 'm' }, SL[s.type][2])),
          iconBtn('chevron-up', 'Move up', () => { if (i) { [b.slides[i - 1], b.slides[i]] = [b.slides[i], b.slides[i - 1]]; draw(); } }),
          iconBtn('chevron-down', 'Move down', () => { if (i < b.slides.length - 1) { [b.slides[i + 1], b.slides[i]] = [b.slides[i], b.slides[i + 1]]; draw(); } }))))),
        panel('Announcements', { sub: 'Warnings and alerts also scroll along the bottom of every slide.' }, h('div', { class: 'panel-b' },
          b.announcements.length ? b.announcements.map((a, i) => h('div', { class: 'opt' },
            h('select', { style: 'width:120px;flex:none', onchange: (e) => (a.level = e.target.value) }, [['info', 'Info'], ['warn', 'Warning'], ['alert', 'Alert']].map(([v, l]) => h('option', { value: v, selected: a.level === v }, l))),
            h('input', { value: a.text, placeholder: 'e.g. Health inspection Thursday', oninput: (e) => (a.text = e.target.value) }), iconBtn('x', 'Remove', () => { b.announcements.splice(i, 1); draw(); }, ''))) : h('p', { class: 'hint', style: 'margin-top:0' }, 'No announcements.'),
          btn('Add announcement', 'plus', () => { b.announcements.push({ id: uid('a'), text: '', level: 'info' }); draw(); }, 'sm')))),
      h('div', { class: 'stack' },
        panel('TV link', { icon: 'link', sub: 'Open once on the TV. No login needed.' }, h('div', { class: 'panel-b fields' },
          h('input', { readonly: true, value: tvUrl(), style: 'font-family:ui-monospace,monospace;font-size:12px', onclick: (e) => e.target.select() }),
          h('div', { class: 'row' }, btn('Copy link', 'copy', async () => { try { await navigator.clipboard.writeText(tvUrl()); toast('Link copied'); } catch { toast('Select the link and copy it', true); } }, 'sm grow'),
            btn('New link', 'refresh-cw', async () => { if (!confirm('Make a new link? TVs using the old one will stop until you open the new link on them.')) return; try { Object.assign(b, await api('POST', '/board/tvkey')); toast('New TV link created'); draw(); } catch (e) { fail(e); } }, 'sm danger')),
          h('div', { class: 'hint row', style: 'flex-wrap:nowrap;align-items:flex-start' }, icon('lock', 'sm'), 'Anyone with this link can see the board. Keep it private.'))),
        panel('Board settings', {}, h('div', { class: 'panel-b fields' },
          field('Board title', h('input', { value: b.title || '', oninput: (e) => (b.title = e.target.value) })),
          field('Seconds per slide', h('input', { type: 'number', min: 4, value: b.rotateSeconds || 12, oninput: (e) => (b.rotateSeconds = Number(e.target.value) || 12) })))),
        panel('Live checklist', { sub: 'Which checklists the live slide shows' }, h('div', { class: 'panel-b' },
          cl.map((c) => h('label', { class: 'opt-row' + (b.liveChecklistIds.includes(c.id) ? ' on' : '') }, h('input', { type: 'checkbox', checked: b.liveChecklistIds.includes(c.id), onchange: (e) => { const s = new Set(b.liveChecklistIds); e.target.checked ? s.add(c.id) : s.delete(c.id); b.liveChecklistIds = [...s]; draw(); } }), c.name)),
          h('p', { class: 'hint', style: 'margin-bottom:0' }, 'Tip: add &slides=today,actions to the link to show only those slides on one screen.'))))));
  draw();
}

// ---------- team
async function team() {
  const users = await api('GET', '/users');
  const roleOpts = me.role === 'admin' ? ['staff', 'manager', 'admin'] : ['staff'];
  const form = { name: '', role: 'staff', pin: '' };
  const add = async () => { try { await api('POST', '/users', form); toast(`${form.name} added`); team(); } catch (e) { fail(e); } };
  const pinPrompt = async (u) => {
    const pin = prompt(`New PIN for ${u.name} (4 to 8 digits)`);
    if (pin == null) return;
    try { await api('PUT', '/users/' + u.id, { pin }); toast('PIN updated'); } catch (e) { fail(e); }
  };
  const can = (u) => u.id === me.id || me.role === 'admin' || (me.role === 'manager' && u.role === 'staff');
  const ROLE = { admin: ['Admin', 'brand'], manager: ['Manager', 'info'], staff: ['Staff', ''] };
  mount(head('Team', 'Everyone who can log in. Staff run audits and fix actions. Managers also build checklists, run the TV and add staff. Admins control everything.'),
    h('div', { class: 'grid-main' },
      panel(`${users.length} ${users.length === 1 ? 'person' : 'people'}`, {}, h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
        h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', { class: 'hide-sm' }, 'Status'), h('th', { class: 'r' }, '')),
        users.map((u) => h('tr', {},
          h('td', {}, h('div', { class: 'cell' }, avatar(u.name), h('div', {}, h('b', {}, u.name, u.id === me.id ? h('span', { class: 'hint', style: 'font-weight:400' }, ' (you)') : null)))),
          h('td', {}, me.role === 'admin' && u.id !== me.id
            ? h('select', { style: 'width:auto;height:32px', onchange: async (e) => { try { await api('PUT', '/users/' + u.id, { role: e.target.value }); toast('Role updated'); } catch (er) { fail(er); team(); } } }, ['staff', 'manager', 'admin'].map((r) => h('option', { value: r, selected: u.role === r }, ROLE[r][0])))
            : chip(ROLE[u.role][0], ROLE[u.role][1], true)),
          h('td', { class: 'hide-sm' }, u.active ? chip('Active', 'ok') : chip('Deactivated', '')),
          h('td', { class: 'r', style: 'white-space:nowrap' }, can(u) ? [
            btn('Reset PIN', 'lock', () => pinPrompt(u), 'sm'), ' ',
            u.id !== me.id ? btn(u.active ? 'Deactivate' : 'Reactivate', null, async () => { try { await api('PUT', '/users/' + u.id, { active: !u.active }); toast(u.active ? `${u.name} deactivated` : `${u.name} reactivated`); team(); } catch (e) { fail(e); } }, 'sm ' + (u.active ? 'danger' : '')) : null] : null)))))),
      panel('Add a person', { icon: 'user' }, h('div', { class: 'panel-b fields' },
        field('Name', h('input', { placeholder: 'e.g. Marcus Johnson', oninput: (e) => (form.name = e.target.value) })),
        field('Role', h('select', { onchange: (e) => (form.role = e.target.value) }, roleOpts.map((r) => h('option', { value: r }, ROLE[r][0])))),
        field('PIN', h('input', { type: 'password', inputmode: 'numeric', maxlength: 8, placeholder: '4 to 8 digits', oninput: (e) => (form.pin = e.target.value) }), 'Share it with them privately. They can use it on any device.'),
        btn('Add person', 'plus', add, 'primary block')))));
}

// ---------- auth screens
function authShell(...kids) {
  document.getElementById('nav').classList.add('hide');
  $main.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-art' },
      h('div', { class: 'brand', style: 'padding:0' }, h('span', { class: 'brand-mark' }, icon('chef-hat')), h('div', {}, h('b', {}, 'Kitchen Audit'), h('small', {}, 'Operations'))),
      h('h1', {}, 'Run a tighter kitchen, every shift.'),
      h('p', {}, 'Checklists, temperature logs and audits your team can finish on any device, with a live board for the whole crew.'),
      h('ul', {}, [['list-checks', 'Opening, closing and food-safety checklists'], ['thermometer', 'Temperature logs with safe ranges'], ['wrench', 'Failed items turn into corrective actions'], ['monitor', 'Live TV board for the line']].map(([i, t]) => h('li', {}, icon(i), t)))),
    h('div', { class: 'auth-main' }, h('div', { class: 'auth-card' }, ...kids))));
}
function pinPad(onDone) {
  let pin = '', busy = false;
  const dots = h('div', { class: 'dots' }), msg = h('div', { class: 'msg' });
  const paint = () => dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' })));
  const press = async (k) => {
    if (busy) return;
    msg.textContent = '';
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') {
      if (pin.length < 4) { msg.textContent = 'Enter at least 4 digits'; return; }
      const p = pin; pin = ''; paint(); busy = true;
      const err = await onDone(p); busy = false;
      if (err) { msg.textContent = err; dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
      return;
    } else if (pin.length < 8) pin += k;
    paint();
  };
  const onKey = (e) => { if (!document.body.contains(dots)) return document.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key === 'Enter') press('ok'); };
  document.addEventListener('keydown', onKey);
  paint();
  return h('div', {}, dots, msg,
    h('div', { class: 'pad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) =>
      h('button', { class: k === 'ok' ? 'primary' : '', 'aria-label': k === 'del' ? 'Delete' : k === 'ok' ? 'Enter' : k, onclick: () => press(k) }, k === 'del' ? icon('delete', 'lg') : k === 'ok' ? icon('check', 'lg') : k))));
}
async function loginView() {
  const users = await api('GET', '/auth/users');
  const pick = (u) => authShell(avatar(u.name, 'lg'), h('h2', {}, `Hi, ${u.name.split(' ')[0]}`), h('p', {}, 'Enter your PIN'),
    pinPad(async (pin) => { try { me = (await api('POST', '/auth/login', { userId: u.id, pin })).user; enter(); } catch (e) { return e.message; } }),
    h('button', { class: 'ghost', style: 'margin-top:16px', onclick: loginView }, icon('arrow-left', 'sm'), 'Not you?'));
  authShell(h('h2', {}, 'Who’s checking in?'), h('p', {}, 'Tap your name to sign in'),
    users.length ? h('div', { class: 'people' }, users.map((u) => h('button', { onclick: () => pick(u) }, avatar(u.name, 'lg'), u.name)))
      : h('p', { class: 'hint' }, 'No active accounts. Ask a manager to reactivate you.'));
}
function setupView() {
  let name = '';
  const step2 = () => {
    if (!name.trim()) return toast('Enter your name', true);
    let first = null;
    const ask = () => authShell(avatar(name, 'lg'), h('h2', {}, first ? 'Confirm your PIN' : 'Choose a PIN'), h('p', {}, first ? 'Enter it one more time' : '4 to 8 digits. You’ll use it to sign in.'),
      pinPad(async (pin) => {
        if (!first) { first = pin; ask(); return; }
        if (pin !== first) { first = null; ask(); toast('PINs didn’t match. Try again.', true); return; }
        try { me = (await api('POST', '/auth/setup', { name, pin })).user; toast('Account created. You’re the admin.'); enter(); } catch (e) { return e.message; }
      }));
    ask();
  };
  authShell(h('span', { class: 'tint brand lg', style: 'margin:0 auto' }, icon('sparkles')), h('h2', {}, 'Set up Kitchen Audit'), h('p', {}, 'Create the owner account. You can add your team after.'),
    h('div', { class: 'fields', style: 'text-align:left' },
      field('Your name', h('input', { placeholder: 'e.g. Andre Williams', style: 'height:48px;font-size:16px', oninput: (e) => (name = e.target.value), onkeydown: (e) => e.key === 'Enter' && step2() })),
      btn('Continue', null, step2, 'primary block')));
}
async function logout() { try { await api('POST', '/auth/logout'); } catch {} me = null; leaveGuard = null; location.hash = '#/'; loginView(); }
function enter() { lastHash = location.hash; render(); }

(async function boot() {
  try {
    const st = await api('GET', '/auth/status');
    me = st.user;
    if (st.needsSetup) return setupView();
    if (!me) return loginView();
    render();
  } catch (e) { $main.replaceChildren(empty('circle-alert', 'Can’t reach the server', e.message)); }
})();
