// End-to-end API tests: boots a real server on a temp data dir and checks auth + roles.
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
const base = `http://localhost:${PORT}/api`;
// TEST_STORAGE=firebase runs the same tests against the fake Firestore
const fb = process.env.TEST_STORAGE === 'firebase';
const srv = spawn(process.execPath, [...(fb ? ['-r', path.join(__dirname, 'fake-firebase-admin.js')] : []), path.join(__dirname, '..', 'server.js')],
  { env: { ...process.env, PORT, DATA_DIR: dir, STORAGE: fb ? 'firebase' : 'file', FIREBASE_SERVICE_ACCOUNT: fb ? '{}' : '' }, stdio: 'pipe' });
srv.stderr.on('data', (d) => process.stderr.write(d));

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const anon = client(), admin = client(), mgr = client(), staff = client();
  let ids = {};

  await t('locked down before login', async () => {
    assert.equal((await anon('GET', '/checklists')).status, 401);
    assert.equal((await anon('GET', '/tv')).status, 401);
    assert.equal((await anon('GET', '/auth/status')).body.needsSetup, true);
  });
  await t('first-run setup creates admin, only once', async () => {
    assert.equal((await admin('POST', '/auth/setup', { name: 'Owner', pin: '12' })).status, 400);
    const r = await admin('POST', '/auth/setup', { name: 'Owner', pin: '1234' });
    assert.equal(r.status, 200); assert.equal(r.body.user.role, 'admin');
    assert.equal((await anon('POST', '/auth/setup', { name: 'Hacker', pin: '9999' })).status, 403);
    assert.equal((await admin('GET', '/checklists')).status, 200);
  });
  await t('admin adds manager; manager adds staff only', async () => {
    ids.mgr = (await admin('POST', '/users', { name: 'Maya', role: 'manager', pin: '2222' })).body.id;
    assert.equal((await mgr('POST', '/auth/login', { userId: ids.mgr, pin: '2222' })).status, 200);
    assert.equal((await mgr('POST', '/users', { name: 'Boss', role: 'admin', pin: '3333' })).status, 403);
    ids.staff = (await mgr('POST', '/users', { name: 'Sam', role: 'staff', pin: '4444' })).body.id;
    assert.ok(ids.staff);
  });
  await t('PINs never leak', async () => {
    const list = JSON.stringify((await anon('GET', '/auth/users')).body) + JSON.stringify((await admin('GET', '/users')).body);
    assert.ok(!/hash|salt/.test(list));
  });
  await t('wrong PIN rejected, lockout after 5 tries', async () => {
    const x = client();
    for (let i = 0; i < 4; i++) assert.equal((await x('POST', '/auth/login', { userId: ids.staff, pin: '0000' })).status, 401);
    assert.equal((await x('POST', '/auth/login', { userId: ids.staff, pin: '0000' })).status, 401);
    assert.equal((await x('POST', '/auth/login', { userId: ids.staff, pin: '4444' })).status, 429); // locked even with right PIN
  });
  await t('staff can audit but not build or delete', async () => {
    // Sam is locked out from the previous test, so log in a second staff member
    const id2 = (await admin('POST', '/users', { name: 'Tia', role: 'staff', pin: '6666' })).body.id;
    assert.equal((await staff('POST', '/auth/login', { userId: id2, pin: '6666' })).status, 200);
    assert.equal((await staff('POST', '/checklists', { name: 'x' })).status, 403);
    assert.equal((await staff('GET', '/board')).status, 403);
    assert.equal((await staff('GET', '/users')).status, 403);
    const c = (await admin('POST', '/checklists', { name: 'Test', questions: [] })).body;
    const run = (await staff('POST', '/runs', { checklistId: c.id })).body;
    assert.equal(run.auditor, 'Tia');
    const sub = (await staff('POST', `/runs/${run.id}/submit`, {})).body;
    assert.equal(sub.submittedBy, 'Tia');
    assert.equal((await staff('DELETE', '/runs/' + run.id)).status, 403); // submitted: manager only
    const draft = (await staff('POST', '/runs', { checklistId: c.id })).body;
    assert.equal((await staff('DELETE', '/runs/' + draft.id)).status, 200); // own draft OK
  });
  await t('TV works with key only', async () => {
    const b = (await admin('GET', '/board')).body;
    assert.equal((await anon('GET', '/tv?key=nope')).status, 401);
    const tv = await anon('GET', '/tv?key=' + b.tvKey);
    assert.equal(tv.status, 200); assert.ok(!('tvKey' in tv.body.board));
    const nb = (await admin('POST', '/board/tvkey')).body;
    assert.equal((await anon('GET', '/tv?key=' + b.tvKey)).status, 401); // old key revoked
    assert.equal((await anon('GET', '/tv?key=' + nb.tvKey)).status, 200);
    assert.equal((await admin('PUT', '/board', { ...b, tvKey: 'evil' })).body.tvKey, nb.tvKey); // can't set key directly
  });
  await t('cannot remove last admin; deactivation kills sessions', async () => {
    const me = (await admin('GET', '/auth/status')).body.user;
    assert.equal((await admin('PUT', '/users/' + me.id, { active: false })).status, 400);
    assert.equal((await admin('PUT', '/users/' + me.id, { role: 'staff' })).status, 400);
    assert.equal((await mgr('GET', '/checklists')).status, 200);
    await admin('PUT', '/users/' + ids.mgr, { active: false });
    assert.equal((await mgr('GET', '/checklists')).status, 401);
  });
  await t('admin can reset a PIN', async () => {
    assert.equal((await admin('PUT', '/users/' + ids.staff, { pin: '12' })).status, 400);
    assert.equal((await admin('PUT', '/users/' + ids.staff, { pin: '5555' })).status, 200);
  });
  await t('logout ends session', async () => {
    await staff('POST', '/auth/logout');
    assert.equal((await staff('GET', '/checklists')).status, 401);
  });
  console.log(`\n${n} API tests passed (${fb ? 'firebase' : 'file'} storage)`);
})().catch((e) => { console.error('FAIL', e); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
