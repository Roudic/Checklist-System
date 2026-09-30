/* Storage adapters. Same async interface for both:
 *   list(col) get(col,id) put(col,id,doc) del(col,id) putFile(path,dataUrl)->url
 * STORAGE=file (default) -> data/db.json      STORAGE=firebase -> Firestore + Firebase Storage
 */
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  const file = path.join(dir, 'db.json');
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = {}; }
  let writing = Promise.resolve();
  const flush = () => {
    writing = writing.then(async () => {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(db));
      await fs.promises.rename(tmp, file);
    }).catch((e) => console.error('write failed', e));
    return writing;
  };
  const col = (c) => (db[c] = db[c] || {});
  return {
    kind: 'file',
    async list(c) { return Object.values(col(c)); },
    async get(c, id) { return col(c)[id] || null; },
    async put(c, id, doc) { col(c)[id] = doc; await flush(); return doc; },
    async del(c, id) { delete col(c)[id]; await flush(); },
    // local mode keeps media inline as data URLs
    async putFile(_p, dataUrl) { return dataUrl; },
  };
}

function firebaseStore() {
  let admin;
  try { admin = require('firebase-admin'); }
  catch { throw new Error('STORAGE=firebase needs firebase-admin. Run: npm install firebase-admin'); }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT; // JSON string OR path to key file
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  let credential;
  if (raw) {
    const json = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
    credential = admin.credential.cert(json);
  } else {
    credential = admin.credential.applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS
  }
  admin.initializeApp({ credential, storageBucket: bucketName });
  const fsdb = admin.firestore();
  const bucket = bucketName ? admin.storage().bucket() : null;
  const prefix = process.env.FIREBASE_COLLECTION_PREFIX || '';

  return {
    kind: 'firebase',
    async list(c) { return (await fsdb.collection(prefix + c).get()).docs.map((d) => d.data()); },
    async get(c, id) { const d = await fsdb.collection(prefix + c).doc(id).get(); return d.exists ? d.data() : null; },
    async put(c, id, doc) { await fsdb.collection(prefix + c).doc(id).set(doc); return doc; },
    async del(c, id) { await fsdb.collection(prefix + c).doc(id).delete(); },
    async putFile(p, dataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
      if (!m) return dataUrl; // already a URL
      if (!bucket) throw new Error('Set FIREBASE_STORAGE_BUCKET so photos can be stored (Firestore docs cap at 1MB).');
      const f = bucket.file(p);
      await f.save(Buffer.from(m[2], 'base64'), { contentType: m[1], resumable: false });
      const [url] = await f.getSignedUrl({ action: 'read', expires: '2500-01-01' });
      return url;
    },
  };
}

module.exports = function createStore(dataDir) {
  return (process.env.STORAGE || 'file') === 'firebase' ? firebaseStore() : fileStore(dataDir);
};
