/* TV / digital board mode. Polls /api/tv, rotates slides, computes live status client-side. */
const { evaluate } = Shared;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = new URLSearchParams(location.search);
let data = null, idx = 0, visit = 0, paused = false, timer = null, slideStart = 0, current = null;

const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const dueDate = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const fmtT = (t) => { const d = dueDate(t); return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''; };

function status(c) {
  const runs = data.runs.filter((r) => r.checklistId === c.id);
  const done = runs.filter((r) => r.status === 'submitted' && sameDay(r.submittedAt)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
  if (done) return { k: done.passed ? 'done' : 'failed', label: done.passed ? '✔ ' + Math.round(done.percent) + '%' : '✖ ' + Math.round(done.percent) + '%', sub: `${done.auditor || 'Completed'} · ${new Date(done.submittedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` };
  const draft = runs.filter((r) => r.status === 'draft' && sameDay(r.startedAt))[0];
  if (draft) return { k: 'prog', label: draft.progress + '%', sub: `In progress${draft.auditor ? ' · ' + draft.auditor : ''}`, progress: draft.progress };
  const due = dueDate(c.dueTime);
  if (due && Date.now() > due) return { k: 'over', label: 'OVERDUE', sub: 'Was due ' + fmtT(c.dueTime), sort: 0 };
  return { k: 'due', label: c.dueTime ? 'Due ' + fmtT(c.dueTime) : 'Pending', sub: 'Not started' };
}

const slides = {
  today() {
    const s = el('div', 'slide'); s.append(el('h2', '', "Today's checklists"));
    const list = data.checklists.filter((c) => c.frequency !== 'none');
    const sts = list.map((c) => [c, status(c)]);
    const count = (k) => sts.filter(([, x]) => x.k === k).length;
    s.append(el('div', 'summary', `<div><b style="color:var(--ok)">${count('done')}</b>done</div><div><b style="color:var(--info)">${count('prog')}</b>in progress</div><div><b style="color:var(--warn)">${count('due')}</b>upcoming</div><div><b style="color:var(--bad)">${count('over') + count('failed')}</b>need attention</div>`));
    const order = { over: 0, failed: 1, prog: 2, due: 3, done: 4 };
    sts.sort((a, b) => order[a[1].k] - order[b[1].k]);
    const g = el('div', 'tiles');
    sts.forEach(([c, x]) => g.append(el('div', 'tile ' + x.k, `<div><h3>${esc(c.name)}</h3><small>${esc(c.category || '')}</small></div><div><div class="st">${x.label}</div><small>${esc(x.sub)}</small>${x.progress != null ? `<div class="bar"><i style="width:${x.progress}%"></i></div>` : ''}</div>`)));
    if (!sts.length) g.append(el('div', 'empty', 'No checklists scheduled'));
    s.append(g); return s;
  },
  scores() {
    const s = el('div', 'slide'); s.append(el('h2', '', 'Audit scores'));
    const done = data.runs.filter((r) => r.status === 'submitted').sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    if (!done.length) { s.append(el('div', 'empty', 'No audits yet — be the first!')); return s; }
    const rings = el('div', 'rings');
    done.slice(0, 8).forEach((r) => rings.append(el('div', 'ring' + (r.passed ? '' : ' bad'), `<div class="o" style="--p:${r.percent}"><i>${Math.round(r.percent)}</i></div><b>${esc(r.checklistName)}</b><small>${esc(r.auditor || '')} · ${new Date(r.submittedAt).toLocaleDateString([], { weekday: 'short' })}</small>`)));
    const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    const wk = days.map((d) => { const rs = done.filter((r) => new Date(r.submittedAt).toDateString() === d.toDateString()); return { d, avg: rs.length ? rs.reduce((a, r) => a + r.percent, 0) / rs.length : null, n: rs.length }; });
    const all = wk.filter((x) => x.avg != null), avg = all.length ? Math.round(all.reduce((a, x) => a + x.avg, 0) / all.length) : '–';
    const split = el('div', 'split'); const left = el('div', 'card'); left.append(rings);
    const right = el('div', 'card', `<div style="color:var(--mute)">7-DAY AVERAGE</div><div style="font-size:3.4em;font-weight:800">${avg}${avg === '–' ? '' : '%'}</div><div class="week">${wk.map((x) => `<div>${x.avg != null ? `<b>${Math.round(x.avg)}</b>` : ''}<i class="${x.avg != null && x.avg < 80 ? 'bad' : ''}" style="height:${x.avg != null ? x.avg * 0.85 : 0}%"></i>${x.d.toLocaleDateString([], { weekday: 'short' })}</div>`).join('')}</div>`);
    split.append(left, right); s.append(split); return s;
  },
  actions() {
    const s = el('div', 'slide'); s.append(el('h2', '', 'Open actions'));
    const a = data.actions.sort((x, y) => Number(y.critical) - Number(x.critical));
    if (!a.length) { s.append(el('div', 'empty', '🎉 No open actions')); return s; }
    a.slice(0, 7).forEach((x) => s.append(el('div', 'act' + (x.critical ? ' crit' : ''), `<span style="font-size:1.6em">${x.critical ? '🚨' : '🛠️'}</span><div><b>${esc(x.title)}</b><small>${esc(x.checklistName)}${x.location ? ' · ' + esc(x.location) : ''}${x.note ? ' — ' + esc(x.note) : ''}</small></div>`)));
    if (a.length > 7) s.append(el('small', '', `+ ${a.length - 7} more`));
    return s;
  },
  live() {
    const ids = data.board.liveChecklistIds || [];
    const cls = data.checklists.filter((c) => ids.includes(c.id));
    if (!cls.length) return null;
    const c = cls[visit % cls.length];
    const s = el('div', 'slide'); const x = status(c);
    const run = data.runs.filter((r) => r.checklistId === c.id && sameDay(r.submittedAt || r.startedAt)).sort((a, b) => (b.submittedAt || b.startedAt).localeCompare(a.submittedAt || a.startedAt))[0];
    s.append(el('h2', '', 'Live checklist'), el('h3', '', ''));
    s.lastChild.style.cssText = 'margin:0 0 .6em;font-size:2.2em'; s.lastChild.textContent = c.name + ' — ' + x.label;
    const items = el('div', 'items');
    (run ? run.checklist : c).questions.filter((q) => q.type !== 'section').forEach((q) => {
      const st = run && run.states ? run.states[q.id] : null;
      const k = st === 'pass' || st === 'fail' || st === 'partial' ? st : st === 'na' || st === 'info' ? 'pass' : '';
      items.append(el('div', 'item', `<span class="dot ${k}">${k === 'pass' ? '✓' : k === 'fail' ? '✕' : k === 'partial' ? '~' : ''}</span>${esc(q.label)}`));
    });
    s.append(items); return s;
  },
  announce() {
    const list = (data.board.announcements || []).filter((a) => a.text);
    if (!list.length) return null;
    const a = list[visit % list.length];
    const s = el('div', 'slide'); s.append(el('div', 'big ' + a.level, `<div class="lv">${a.level === 'alert' ? '🚨 Alert' : a.level === 'warn' ? '⚠️ Heads up' : '📣 Announcement'}</div><p>${esc(a.text)}</p>`));
    return s;
  },
};

function activeSlides() {
  const want = qs.get('slides') ? qs.get('slides').split(',') : null;
  const base = (data.board.slides && data.board.slides.length ? data.board.slides : Object.keys(slides).map((type) => ({ type, on: true })));
  return (want ? want.map((type) => ({ type, on: true })) : base).filter((s) => s.on && slides[s.type]);
}

function show(i, keepTimer) {
  const list = activeSlides(); if (!list.length) return;
  idx = ((i % list.length) + list.length) % list.length;
  let node = null, tries = 0;
  while (!node && tries++ < list.length) { node = slides[list[idx].type](); if (!node) idx = (idx + 1) % list.length; }
  current = list[idx].type;
  $('stage').replaceChildren(node || el('div', 'empty', 'Nothing to show'));
  if (!keepTimer) { slideStart = Date.now(); }
}

function tick() {
  const secs = Math.max(4, Number(data && data.board.rotateSeconds) || 12), pct = ((Date.now() - slideStart) / (secs * 1000)) * 100;
  $('progress').firstChild.style.width = (paused ? 0 : Math.min(100, pct)) + '%';
  const now = new Date();
  $('clock').innerHTML = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + `<small>${now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</small>`;
  if (!paused && data && pct >= 100) { visit++; show(idx + 1); }
}

function ticker() {
  const list = ((data.board.announcements || []).filter((a) => a.text && a.level !== 'info'));
  const t = $('ticker'); const a = list[0];
  t.className = a ? 'on ' + a.level : ''; t.textContent = a ? (a.level === 'alert' ? '🚨 ' : '⚠️ ') + a.text : '';
}

async function load() {
  try {
    data = await (await fetch('/api/tv', { cache: 'no-store' })).json();
    $('title').textContent = data.board.title || 'Kitchen Board';
    ticker();
    // refresh visible slide in place so live progress updates without rotating
    if (current) show(idx, true); else show(0);
  } catch (e) { /* offline: keep showing last data */ }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { visit++; show(idx + 1); } else if (e.key === 'ArrowLeft') { visit++; show(idx - 1); }
  else if (e.key === ' ') { paused = !paused; if (!paused) slideStart = Date.now(); }
  else if (e.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
document.addEventListener('click', () => document.documentElement.requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen().catch(() => {}));
$('progress').append(document.createElement('i'));
load().then(() => { slideStart = Date.now(); });
setInterval(load, 15000);
setInterval(tick, 250);
