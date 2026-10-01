/* Storage adapters. Same async interface for both:
 *   list(col) get(col,id) put(col,id,doc) del(col,id) putFile(path,dataUrl)->url
 * STORAGE=file (default) -> data/db.json      STORAGE=firebase -> Firestore (+ Firebase Storage if a bucket is set)
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
    async getFile() { return null; },
  };
}

function firebaseStore(adminOverride) {
  let admin = adminOverride;
  if (!admin) {
    try { admin = require('firebase-admin'); }
    catch { throw new Error('STORAGE=firebase needs firebase-admin. Run: npm install firebase-admin'); }
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT; // JSON string OR path to key file
    let credential;
    if (raw) {
      const json = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
      credential = admin.credential.cert(json);
    } else {
      credential = admin.credential.applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS
    }
    admin.initializeApp({ credential, storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined });
  }
  const fsdb = admin.firestore();
  const bucket = process.env.FIREBASE_STORAGE_BUCKET ? admin.storage().bucket() : null;
  const prefix = process.env.FIREBASE_COLLECTION_PREFIX || '';
  const ref = (c) => fsdb.collection(prefix + c);

  // Write-through cache: each collection is read from Firestore once, then served from memory and
  // kept current on every write. Keeps reads far under the free-plan quota (the TV polls every 15s).
  // Only safe when ONE server instance does all the writing (Render, a VM). Serverless hosts run
  // many instances, so it's off on Vercel or with FIREBASE_CACHE=0.
  const cacheOn = !process.env.VERCEL && process.env.FIREBASE_CACHE !== '0';
  const cache = new Map(); // collection -> Map(id -> doc)
  const loading = new Map();
  const load = (c) => {
    if (cache.has(c)) return Promise.resolve(cache.get(c));
    if (!loading.has(c)) loading.set(c, ref(c).get().then((snap) => {
      const m = new Map(snap.docs.map((d) => [d.id, d.data()]));
      cache.set(c, m); loading.delete(c); return m;
    }, (e) => { loading.delete(c); throw e; }));
    return loading.get(c);
  };
  const clone = (d) => (d == null ? null : JSON.parse(JSON.stringify(d))); // callers mutate docs

  return {
    kind: 'firebase',
    cached: cacheOn,
    async list(c) {
      if (cacheOn) return [...(await load(c)).values()].map(clone);
      return (await ref(c).get()).docs.map((d) => d.data());
    },
    async get(c, id) {
      if (cacheOn) return clone((await load(c)).get(id));
      const d = await ref(c).doc(id).get(); return d.exists ? d.data() : null;
    },
    async put(c, id, doc) {
      await ref(c).doc(id).set(doc);
      if (cacheOn && cache.has(c)) cache.get(c).set(id, clone(doc));
      return doc;
    },
    async del(c, id) {
      await ref(c).doc(id).delete();
      if (cacheOn && cache.has(c)) cache.get(c).delete(id);
    },
    async putFile(p, dataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
      if (!m) return dataUrl; // already a URL
      if (bucket) {
        const f = bucket.file(p);
        await f.save(Buffer.from(m[2], 'base64'), { contentType: m[1], resumable: false });
        const [url] = await f.getSignedUrl({ action: 'read', expires: '2500-01-01' });
        return url;
      }
      // No Storage bucket (it needs the paid Blaze plan): keep the image as its own Firestore doc.
      // Photos are shrunk in the browser (~100-300KB), well under Firestore's 1MB doc cap.
      if (m[2].length > 1000000) throw new Error('Photo too large. Try a smaller picture.');
      const id = p.replace(/[^\w-]/g, '_');
      await ref('media').doc(id).set({ id, type: m[1], data: m[2] }); // not cached: big and rarely read
      return '/api/media/' + id;
    },
    async getFile(id) {
      const d = await ref('media').doc(id).get();
      return d.exists ? { type: d.data().type, data: Buffer.from(d.data().data, 'base64') } : null;
    },
  };
}

module.exports = function createStore(dataDir) {
  return (process.env.STORAGE || 'file') === 'firebase' ? firebaseStore() : fileStore(dataDir);
};
module.exports.firebaseStore = firebaseStore; // exported for tests
