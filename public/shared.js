/* Shared between server and browser: question type catalog + scoring engine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // group: how the builder organises the palette
  const TYPES = {
    yesno:       { label: 'Yes / No',            icon: '✔️', group: 'Quick answers', scored: true },
    passfail:    { label: 'Pass / Fail / N/A',   icon: '✅', group: 'Quick answers', scored: true },
    tick:        { label: 'Tick list',           icon: '☑️', group: 'Quick answers', scored: true },
    choice:      { label: 'Multiple choice',     icon: '🔘', group: 'Choices',       scored: true },
    dropdown:    { label: 'Dropdown',            icon: '🔽', group: 'Choices',       scored: true },
    multi:       { label: 'Multi-select',        icon: '🗂️', group: 'Choices',       scored: true },
    number:      { label: 'Number',              icon: '🔢', group: 'Measurements',  scored: true },
    temperature: { label: 'Temperature',         icon: '🌡️', group: 'Measurements',  scored: true },
    slider:      { label: 'Slider',              icon: '🎚️', group: 'Measurements',  scored: true },
    rating:      { label: 'Star rating',         icon: '⭐', group: 'Measurements',  scored: true },
    text:        { label: 'Short text',          icon: '✏️', group: 'Text & media',  scored: false },
    longtext:    { label: 'Long text / notes',   icon: '📝', group: 'Text & media',  scored: false },
    photo:       { label: 'Photo',               icon: '📷', group: 'Text & media',  scored: false },
    signature:   { label: 'Signature',           icon: '🖊️', group: 'Text & media',  scored: false },
    date:        { label: 'Date',                icon: '📅', group: 'Date & time',   scored: false },
    time:        { label: 'Time',                icon: '⏰', group: 'Date & time',   scored: false },
    datetime:    { label: 'Date & time',         icon: '🗓️', group: 'Date & time',   scored: false },
    section:     { label: 'Section / instruction', icon: '📌', group: 'Layout',      scored: false, noAnswer: true },
  };

  const uid = (p = 'q') => p + Math.random().toString(36).slice(2, 9);

  function newQuestion(type) {
    const t = TYPES[type];
    const q = {
      id: uid(), type, label: '', help: '', required: true,
      points: t.scored ? 1 : 0, critical: false, allowNA: false,
      photoOn: 'never', noteOn: 'never', showIf: null,
    };
    if (type === 'yesno') q.passOn = 'yes';
    if (type === 'choice' || type === 'dropdown' || type === 'multi')
      q.options = [{ label: 'Good', score: 100 }, { label: 'Needs attention', score: 50 }, { label: 'Unacceptable', score: 0 }];
    if (type === 'tick') q.options = [{ label: 'Item 1' }, { label: 'Item 2' }];
    if (type === 'temperature') { q.unit = '°F'; q.min = 33; q.max = 41; }
    if (type === 'number') { q.unit = ''; q.min = null; q.max = null; }
    if (type === 'slider') { q.min = 0; q.max = 100; q.step = 5; q.passMin = 70; q.unit = '%'; }
    if (type === 'rating') { q.max = 5; q.passMin = 3; }
    if (type === 'section') { q.required = false; }
    return q;
  }

  const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  /** Should this question be shown given current answers? */
  function isVisible(q, checklist, answers) {
    const s = q.showIf;
    if (!s || !s.qid) return true;
    const src = checklist.questions.find((x) => x.id === s.qid);
    if (!src) return true;
    if (!isVisible(src, checklist, answers)) return false; // hidden parents hide children
    const a = answers[s.qid] || {};
    const res = evaluate(src, a);
    switch (s.op) {
      case 'fail': return res.status === 'fail';
      case 'pass': return res.status === 'pass';
      case 'answered': return !isBlank(a.value) || a.na === true;
      case 'neq': return String(a.value) !== String(s.value);
      case 'eq':
      default:
        return Array.isArray(a.value) ? a.value.includes(s.value) : String(a.value) === String(s.value);
    }
  }

  /**
   * Evaluate one answer.
   * status: pass | fail | partial | na | info | blank
   * earned/max: points (max is 0 when the question is excluded from scoring)
   */
  function evaluate(q, ans) {
    ans = ans || {};
    const pts = Number(q.points) || 0;
    const out = { status: 'blank', earned: 0, max: 0 };
    if (q.type === 'section') return { status: 'info', earned: 0, max: 0 };
    if (ans.na) return { status: 'na', earned: 0, max: 0 };
    const v = ans.value;
    if (isBlank(v)) return out; // unanswered: excluded from score until answered
    const full = (status, frac = 1) => ({ status, earned: pts * frac, max: pts });
    const info = () => (pts > 0 ? full('pass') : { status: 'info', earned: 0, max: 0 });

    switch (q.type) {
      case 'yesno': {
        const want = q.passOn === 'no' ? 'no' : 'yes';
        return v === want ? full('pass') : full('fail', 0);
      }
      case 'passfail':
        if (v === 'na') return { status: 'na', earned: 0, max: 0 };
        return v === 'pass' ? full('pass') : full('fail', 0);
      case 'choice':
      case 'dropdown': {
        const o = (q.options || []).find((x) => x.label === v);
        const sc = o ? Number(o.score ?? 100) : 100;
        return sc >= 100 ? full('pass') : sc <= 0 ? full('fail', 0) : full('partial', sc / 100);
      }
      case 'multi': {
        const picked = (q.options || []).filter((x) => v.includes(x.label));
        const worst = picked.length ? Math.min(...picked.map((x) => Number(x.score ?? 100))) : 100;
        return worst >= 100 ? full('pass') : worst <= 0 ? full('fail', 0) : full('partial', worst / 100);
      }
      case 'tick': {
        const total = (q.options || []).length || 1;
        const n = v.length;
        return n >= total ? full('pass') : n === 0 ? full('fail', 0) : full('partial', n / total);
      }
      case 'number':
      case 'temperature': {
        const n = Number(v);
        if (Number.isNaN(n)) return out;
        const hasMin = q.min !== null && q.min !== undefined && q.min !== '';
        const hasMax = q.max !== null && q.max !== undefined && q.max !== '';
        if (!hasMin && !hasMax) return info();
        const ok = (!hasMin || n >= Number(q.min)) && (!hasMax || n <= Number(q.max));
        return ok ? full('pass') : full('fail', 0);
      }
      case 'slider': {
        const n = Number(v);
        if (Number.isNaN(n)) return out;
        if (q.passMin === null || q.passMin === undefined || q.passMin === '') return info();
        return n >= Number(q.passMin) ? full('pass') : full('fail', 0);
      }
      case 'rating': {
        const n = Number(v), max = Number(q.max) || 5;
        const frac = Math.max(0, Math.min(1, n / max));
        const passMin = q.passMin === undefined || q.passMin === null || q.passMin === '' ? 0 : Number(q.passMin);
        return n >= passMin ? full('pass', frac) : full('fail', frac);
      }
      default:
        return info();
    }
  }

  /** Does this answer need a photo / note attached? */
  function needs(q, res, kind /* 'photo' | 'note' */) {
    const rule = kind === 'photo' ? q.photoOn : q.noteOn;
    if (rule === 'always') return true;
    if (rule === 'fail') return res.status === 'fail';
    return false;
  }

  /** Score a whole run. */
  function score(checklist, answers) {
    let earned = 0, max = 0, answered = 0, total = 0, fails = 0;
    const criticalFails = [];
    const items = {};
    for (const q of checklist.questions) {
      if (q.type === 'section') continue;
      if (!isVisible(q, checklist, answers)) continue;
      total++;
      const ans = answers[q.id] || {};
      const r = evaluate(q, ans);
      items[q.id] = r;
      if (r.status !== 'blank') answered++;
      earned += r.earned; max += r.max;
      if (r.status === 'fail') {
        fails++;
        if (q.critical) criticalFails.push(q.id);
      }
    }
    const percent = max > 0 ? Math.round((earned / max) * 1000) / 10 : (answered ? 100 : 0);
    const passMark = Number(checklist.passScore ?? 80);
    return {
      earned, max, percent, answered, total, fails, criticalFails, items,
      progress: total ? Math.round((answered / total) * 100) : 0,
      passed: percent >= passMark && criticalFails.length === 0,
    };
  }

  /** Problems that block submission. Returns [{qid, label, reason}] */
  function validate(checklist, answers) {
    const problems = [];
    for (const q of checklist.questions) {
      if (q.type === 'section') continue;
      if (!isVisible(q, checklist, answers)) continue;
      const ans = answers[q.id] || {};
      const res = evaluate(q, ans);
      const label = q.label || TYPES[q.type].label;
      if (ans.na) continue;
      if (q.required && res.status === 'blank') { problems.push({ qid: q.id, label, reason: 'Required' }); continue; }
      if (q.required && q.type === 'tick' && res.status !== 'pass' && (ans.value || []).length < (q.options || []).length && !isBlank(ans.value))
        problems.push({ qid: q.id, label, reason: 'Tick every item' });
      if (res.status === 'blank') continue;
      if (needs(q, res, 'note') && !String(ans.note || '').trim()) problems.push({ qid: q.id, label, reason: 'Note required' });
      if (needs(q, res, 'photo') && !(ans.photos && ans.photos.length)) problems.push({ qid: q.id, label, reason: 'Photo required' });
    }
    return problems;
  }

  return { TYPES, uid, newQuestion, isBlank, isVisible, evaluate, needs, score, validate };
});
