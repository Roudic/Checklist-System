const assert = require('assert');
const S = require('../public/shared.js');
const q = (type, extra = {}) => Object.assign(S.newQuestion(type), extra);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('yes/no honours passOn', () => {
  assert.equal(S.evaluate(q('yesno', { passOn: 'no' }), { value: 'no' }).status, 'pass');
  assert.equal(S.evaluate(q('yesno', { passOn: 'no' }), { value: 'yes' }).status, 'fail');
});
t('temperature range', () => {
  const tq = q('temperature', { min: 33, max: 41 });
  assert.equal(S.evaluate(tq, { value: 38 }).status, 'pass');
  assert.equal(S.evaluate(tq, { value: 45 }).status, 'fail');
  assert.equal(S.evaluate(tq, { value: 30 }).status, 'fail');
});
t('tick list partial credit', () => {
  const r = S.evaluate(q('tick', { points: 4, options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }] }), { value: ['a', 'b'] });
  assert.equal(r.status, 'partial'); assert.equal(r.earned, 2);
});
t('choice score %', () => {
  const cq = q('choice', { points: 2, options: [{ label: 'x', score: 50 }] });
  assert.equal(S.evaluate(cq, { value: 'x' }).earned, 1);
});
t('N/A excluded from score', () => {
  assert.equal(S.evaluate(q('passfail'), { na: true }).max, 0);
});
t('critical failure fails audit even at high %', () => {
  const c = { passScore: 50, questions: [q('passfail', { critical: true }), q('passfail'), q('passfail'), q('passfail')] };
  const a = { [c.questions[0].id]: { value: 'fail' }, [c.questions[1].id]: { value: 'pass' }, [c.questions[2].id]: { value: 'pass' }, [c.questions[3].id]: { value: 'pass' } };
  const r = S.score(c, a); assert.equal(r.percent, 75); assert.equal(r.passed, false);
});
t('conditional questions hidden and excluded', () => {
  const a = q('yesno'), b = q('text', { points: 1, showIf: { qid: a.id, op: 'eq', value: 'yes' } });
  const c = { passScore: 80, questions: [a, b] };
  assert.equal(S.isVisible(b, c, { [a.id]: { value: 'no' } }), false);
  assert.equal(S.isVisible(b, c, { [a.id]: { value: 'yes' } }), true);
  assert.deepEqual(S.validate(c, { [a.id]: { value: 'no' } }), []);
  assert.equal(S.validate(c, { [a.id]: { value: 'yes' } }).length, 1);
});
t('note/photo required on fail', () => {
  const c = { questions: [q('passfail', { noteOn: 'fail', photoOn: 'fail' })] };
  const id = c.questions[0].id;
  assert.equal(S.validate(c, { [id]: { value: 'fail' } }).length, 2);
  assert.equal(S.validate(c, { [id]: { value: 'fail', note: 'x', photos: ['p'] } }).length, 0);
  assert.equal(S.validate(c, { [id]: { value: 'pass' } }).length, 0);
});
console.log(`\n${n} passed`);
