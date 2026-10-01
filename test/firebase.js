// Firebase adapter tests against the fake Firestore: cache correctness, quota use, photo storage.
const assert = require('assert');
const fake = require('./fake-firebase-admin');
const { firebaseStore } = require('../storage');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

(async () => {
  delete process.env.FIREBASE_STORAGE_BUCKET; delete process.env.VERCEL; delete process.env.FIREBASE_CACHE;
  const s = firebaseStore(fake);

  await t('put/get/list/del round-trip', async () => {
    await s.put('runs', 'a', { id: 'a', v: 1 }); await s.put('runs', 'b', { id: 'b', v: 2 });
    assert.deepEqual((await s.get('runs', 'a')), { id: 'a', v: 1 });
    assert.equal((await s.list('runs')).length, 2);
    await s.del('runs', 'b');
    assert.equal((await s.list('runs')).length, 1);
    assert.equal(await s.get('runs', 'b'), null);
  });
  await t('repeat reads hit memory, not Firestore', async () => {
    await s.list('checklists');
    const before = fake.stats.reads;
    for (let i = 0; i < 1000; i++) { await s.list('runs'); await s.get('runs', 'a'); await s.list('checklists'); }
    assert.equal(fake.stats.reads, before); // 3000 reads served for free
  });
  await t('writes stay in sync with cache', async () => {
    await s.put('runs', 'a', { id: 'a', v: 99 });
    assert.equal((await s.get('runs', 'a')).v, 99);
    assert.equal(fake.data.get('runs').get('a').v, 99); // and actually saved
  });
  await t('callers mutating results cannot corrupt the cache', async () => {
    const d = await s.get('runs', 'a'); d.v = -1;
    (await s.list('runs'))[0].v = -2;
    assert.equal((await s.get('runs', 'a')).v, 99);
  });
  await t('photos go to Firestore when no Storage bucket', async () => {
    const png = 'data:image/png;base64,' + Buffer.from('hello-image').toString('base64');
    const url = await s.putFile('runs/r1/q1-1.png', png);
    assert.match(url, /^\/api\/media\/[\w-]+$/);
    const f = await s.getFile(url.split('/').pop());
    assert.equal(f.type, 'image/png'); assert.equal(f.data.toString(), 'hello-image');
    assert.equal(await s.putFile('x', url), url); // already a URL: untouched
  });
  await t('cache is off on Vercel (many instances)', async () => {
    process.env.VERCEL = '1';
    const v = firebaseStore(fake); await v.list('runs');
    const before = fake.stats.reads; await v.list('runs');
    assert.ok(fake.stats.reads > before);
    delete process.env.VERCEL;
  });
  console.log(`\n${n} Firebase adapter tests passed`);
})().catch((e) => { console.error('FAIL', e); process.exitCode = 1; });
