// In-memory stand-in for firebase-admin's Firestore. Counts reads so tests can check quota use.
// Preload with `node -r ./test/fake-firebase-admin.js` to make require('firebase-admin') return it.
const data = new Map();
const stats = { reads: 0, writes: 0 };
const col = (name) => { if (!data.has(name)) data.set(name, new Map()); return data.get(name); };
const copy = (x) => JSON.parse(JSON.stringify(x));
const fake = {
  stats, data,
  initializeApp() {},
  credential: { cert: () => ({}), applicationDefault: () => ({}) },
  storage: () => ({ bucket: () => { throw new Error('no bucket in fake'); } }),
  firestore: () => ({
    collection: (name) => ({
      async get() { const docs = [...col(name).entries()]; stats.reads += Math.max(1, docs.length); return { docs: docs.map(([id, d]) => ({ id, data: () => copy(d) })) }; },
      doc: (id) => ({
        async get() { stats.reads++; const d = col(name).get(id); return { exists: !!d, data: () => copy(d) }; },
        async set(d) { stats.writes++; col(name).set(id, copy(d)); },
        async delete() { stats.writes++; col(name).delete(id); },
      }),
    }),
  }),
};
module.exports = fake;
try { const p = require.resolve('firebase-admin'); require.cache[p] = { id: p, filename: p, loaded: true, exports: fake }; } catch {}
