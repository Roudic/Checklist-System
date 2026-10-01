/* TV / digital board mode. Polls /api/tv, rotates slides, computes live status client-side. */
const { scheduledOn } = Shared;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n) => `<svg class="ic"><use href="/icons.svg#${n}"/></svg>`;
const qs = new URLSearchParams(location.search);
let data = null, idx = 0, visit = 0, paused = false, slideStart = 0, current = null;

const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const dueDate = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const fmtT = (t) => { const d = dueDate(t); return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };
const at = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const kindOf = (p) => (p >= 90 ? '' : p >= 75 ? 'warn' : 'bad');
const head = (title, sub, right = '') => el('div', 's-head', `<div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="r">${right}</div>`);

function status(c) {
  const runs = data.runs.filter((r) => r.checklistId === c.id);
  const done = runs.filter((r) => r.status === 'submitted' && sameDay(r.submittedAt)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (done) return { k: done.passed ? 'done' : 'failed', icon: done.passed ? 'circle-check' : 'circle-x', label: Math.round(done.percent) + '%', tag: done.passed ? 'Passed' : 'Failed', sub: `${esc(done.submittedBy || done.auditor || 'Completed')} · ${at(done.submittedAt)}` };
  const draft = runs.filter((r) => r.status === 'draft' && sameDay(r.startedAt))[0];
  if (draft) return { k: 'prog', icon: 'timer', label: draft.progress + '%', tag: 'In progress', sub: esc(draft.auditor || 'Started'), progress: draft.progress };
  const due = dueDate(c.dueTime);
  if (due && Date.now() > due) return { k: 'over', icon: 'triangle-alert', label: 'Overdue', tag: 'Overdue', sub: 'Was due ' + fmtT(c.dueTime) };
  return { k: 'due', icon: 'clock', label: c.dueTime ? fmtT(c.dueTime) : 'To do', tag: 'Upcoming', sub: c.dueTime ? 'Not started' : 'Any time today' };
}

const slides = {
  today() {
    const s = el('div', 'slide');
    const sts = data.checklists.filter((c) => scheduledOn(c, new Date())).map((c) => [c, status(c)]);
    const n = (...k) => sts.filter(([, x]) => k.includes(x.k)).length;
    const stat = (v, l, c) => `<div class="stat"><i style="background:${c}"></i><b>${v}</b>${l}</div>`;
    s.append(head("Today's checklists", `${n('done', 'failed')} of ${sts.length} complete`,
      stat(n('done'), 'done', 'var(--ok)') + stat(n('prog'), 'in progress', 'var(--info)') + stat(n('due'), 'upcoming', 'var(--warn)') + stat(n('over', 'failed'), 'need attention', 'var(--bad)')));
    const order = { over: 0, failed: 1, prog: 2, due: 3, done: 4 };
    sts.sort((a, b) => order[a[1].k] - order[b[1].k] || (a[0].dueTime || '').localeCompare(b[0].dueTime || ''));
    const g = el('div', 'tiles');
    sts.forEach(([c, x]) => g.append(el('div', 'tile ' + x.k, `<div class="top"><span class="dot">${ic(x.icon)}</span>${esc(x.tag)}${c.category ? ` · ${esc(c.category)}` : ''}</div><h3>${esc(c.name)}</h3><div class="st">${x.label}</div><div class="sub">${x.sub}</div>${x.progress != null ? `<div class="bar"><i style="width:${x.progress}%"></i></div>` : ''}`)));
    if (!sts.length) g.append(el('div', 'empty', `${ic('calendar')}Nothing scheduled today`));
    s.append(g); return s;
  },
  scores() {
    const s = el('div', 'slide');
    const done = data.runs.filter((r) => r.status === 'submitted').sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    s.append(head('Audit scores', 'Most recent audits and the last 7 days'));
    if (!done.length) { s.append(el('div', 'empty', `${ic('file-check-2')}No audits yet. Be the first!`)); return s; }
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    const wk = days.map((d) => { const rs = done.filter((r) => new Date(r.submittedAt).toDateString() === d.toDateString()); return { d, avg: rs.length ? rs.reduce((a, r) => a + r.percent, 0) / rs.length : null }; });
    const have = wk.filter((x) => x.avg != null), avg = have.length ? Math.round(have.reduce((a, x) => a + x.avg, 0) / have.length) : null;
    const split = el('div', 'split');
    split.append(
      el('div', 'card', `<h4>Recent audits</h4><div class="rings">${done.slice(0, 8).map((r) => `<div class="ring ${kindOf(r.percent)}"><div class="o" style="--p:${r.percent}"><i>${Math.round(r.percent)}</i></div><b>${esc(r.checklistName)}</b><small>${esc(r.submittedBy || r.auditor || '')} · ${new Date(r.submittedAt).toLocaleDateString([], { weekday: 'short' })}</small></div>`).join('')}</div>`),
      el('div', 'card', `<h4>7-day average</h4><div class="big-n" style="color:${avg == null ? 'var(--mute)' : `var(--${kindOf(avg) || 'ok'})`}">${avg == null ? '—' : avg + '%'}</div><div class="week">${wk.map((x) => `<div>${x.avg != null ? `<b>${Math.round(x.avg)}</b><i class="${kindOf(x.avg)}" style="height:${x.avg * 0.78}%"></i>` : '<i class="none"></i>'}${x.d.toLocaleDateString([], { weekday: 'short' })}</div>`).join('')}</div>`));
    s.append(split); return s;
  },
  actions() {
    const s = el('div', 'slide');
    const a = data.actions.slice().sort((x, y) => Number(y.critical) - Number(x.critical));
    const crit = a.filter((x) => x.critical).length;
    s.append(head('Open actions', a.length ? `${a.length} to fix${crit ? ` · ${crit} critical` : ''}` : 'Everything is handled'));
    if (!a.length) { s.append(el('div', 'empty', `${ic('shield-check')}No open actions. Nice work.`)); return s; }
    const list = el('div', 'acts');
    a.slice(0, 7).forEach((x) => list.append(el('div', 'act' + (x.critical ? ' crit' : ''), `<span class="dot">${ic(x.critical ? 'siren' : 'wrench')}</span><div><b>${esc(x.title)}</b><small>${esc(x.checklistName)}${x.location ? ' · ' + esc(x.location) : ''}${x.note ? ' — ' + esc(x.note) : ''}</small></div>${x.critical ? '<span class="tag">CRITICAL</span>' : ''}`)));
    s.append(list);
    if (a.length > 7) s.append(el('div', '', `<p style="color:var(--mute);margin:.8em 0 0">+ ${a.length - 7} more in the app</p>`));
    return s;
  },
  live() {
    const ids = data.board.liveChecklistIds || [];
    const cls = data.checklists.filter((c) => ids.includes(c.id));
    if (!cls.length) return null;
    const c = cls[visit % cls.length];
    const s = el('div', 'slide'); const x = status(c);
    const run = data.runs.filter((r) => r.checklistId === c.id && sameDay(r.submittedAt || r.startedAt)).sort((a, b) => (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt))[0];
    // with a run, show exactly the questions that apply (states covers visible ones); without, skip conditional ones
    const qsList = (run ? run.checklist : c).questions.filter((q) => q.type !== 'section' && (run && run.states ? q.id in run.states : !q.showIf));
    s.append(head(esc(c.name), `Live checklist · ${esc(x.tag)}`, `<div class="stat" style="color:var(--${{ done: 'ok', failed: 'bad', over: 'bad', prog: 'info', due: 'warn' }[x.k]})"><b style="color:inherit">${x.label}</b></div>`));
    const items = el('div', 'items');
    qsList.forEach((q) => {
      const st = run && run.states ? run.states[q.id] : null;
      const k = st === 'pass' || st === 'fail' || st === 'partial' ? st : st === 'na' || st === 'info' ? 'pass' : '';
      items.append(el('div', 'item', `<span class="dot2 ${k}">${k === 'pass' ? ic('check') : k === 'fail' ? ic('x') : k === 'partial' ? '~' : ''}</span>${esc(q.label)}`));
    });
    s.append(items); return s;
  },
  announce() {
    const list = (data.board.announcements || []).filter((a) => a.text);
    if (!list.length) return null;
    const a = list[visit % list.length];
    const s = el('div', 'slide');
    s.append(el('div', 'big ' + a.level, `<div class="lv">${ic(a.level === 'alert' ? 'siren' : a.level === 'warn' ? 'triangle-alert' : 'megaphone')}${a.level === 'alert' ? 'Alert' : a.level === 'warn' ? 'Heads up' : 'Announcement'}</div><p>${esc(a.text)}</p>`));
    return s;
  },
};

function activeSlides() {
  const want = qs.get('slides') ? qs.get('slides').split(',') : null;
  const base = data.board.slides && data.board.slides.length ? data.board.slides : Object.keys(slides).map((type) => ({ type, on: true }));
  return (want ? want.map((type) => ({ type, on: true })) : base).filter((s) => s.on && slides[s.type]);
}

function show(i, keepTimer) {
  if (!data) return;
  const list = activeSlides(); if (!list.length) return;
  idx = ((i % list.length) + list.length) % list.length;
  let node = null, tries = 0;
  while (!node && tries++ < list.length) { node = slides[list[idx].type](); if (!node) idx = (idx + 1) % list.length; }
  current = list[idx].type;
  if (keepTimer && node) node.style.animation = 'none'; // live refresh: no re-entry animation
  $('stage').replaceChildren(node || el('div', 'empty', 'Nothing to show'));
  $('pager').innerHTML = list.length > 1 ? list.map((_, j) => `<span class="${j === idx ? 'on' : ''}"></span>`).join('') : '';
  if (!keepTimer) slideStart = Date.now();
}

function tick() {
  const secs = Math.max(4, Number(data && data.board.rotateSeconds) || 12), pct = ((Date.now() - slideStart) / (secs * 1000)) * 100;
  $('progress').firstChild.style.width = (paused || !data ? 0 : Math.min(100, pct)) + '%';
  const now = new Date();
  $('clock').innerHTML = `<b>${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><small>${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</small>`;
  if (!paused && data && pct >= 100) { visit++; show(idx + 1); }
}

function ticker() {
  const a = (data.board.announcements || []).filter((x) => x.text && x.level !== 'info').sort((x, y) => (x.level === 'alert' ? -1 : 1) - (y.level === 'alert' ? -1 : 1))[0];
  const t = $('ticker');
  t.className = a ? 'on ' + a.level : '';
  t.innerHTML = a ? ic(a.level === 'alert' ? 'siren' : 'triangle-alert') + esc(a.text) : '';
}

async function load() {
  try {
    const r = await fetch('/api/tv' + (qs.get('key') ? '?key=' + encodeURIComponent(qs.get('key')) : ''), { cache: 'no-store' });
    if (r.status === 401) return unpaired();
    data = await r.json();
    $('title').textContent = data.board.title || 'Kitchen Board';
    ticker();
    if (current) show(idx, true); else show(0);
  } catch (e) { /* offline: keep showing last data */ }
}

function unpaired() {
  data = null; $('pager').innerHTML = '';
  $('stage').replaceChildren(el('div', 'slide', `<div class="big"><div class="lv">${ic('monitor')}Screen not paired</div><p>Open the TV link on this screen</p><div style="color:var(--mute);font-size:1.3em;margin-top:1em">A manager can copy it from <b style="color:var(--ink-2)">TV Display → TV link</b> in the app.</div></div>`));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { visit++; show(idx + 1); } else if (e.key === 'ArrowLeft') { visit++; show(idx - 1); }
  else if (e.key === ' ') { paused = !paused; if (!paused) slideStart = Date.now(); }
  else if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
document.addEventListener('click', () => document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen().catch(() => {}));
load().then(() => { slideStart = Date.now(); });
setInterval(load, 15000);
setInterval(tick, 250);
tick();
