// .pair ke liye server chunna: pehle PAIR_SERVERS (default 9) servers mein se online wala jis par sabse kam users hain.
// Agar wo server ye node nahi hai to request Mongo mein likhi jati hai, aur us server ka worker pairing karke code wapas likhta hai.
const config = require('../config');
const store = require('./store');

const PAIR_SERVERS = Math.max(1, parseInt(process.env.PAIR_SERVERS || '9', 10));
const POLL_MS = 3000;
const WAIT_MS = 90 * 1000;
const PREFIX = 'pairreq:';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let timer = null;

function fleet() { return require('./fleet'); }

async function pickServer() {
  const rows = await fleet().servers();
  const cand = rows
    .filter((r) => r.online && Number(r.id) >= 1 && Number(r.id) <= PAIR_SERVERS)
    .sort((a, b) => (a.users - b.users) || (Number(a.id) - Number(b.id)));
  return cand[0] || null;
}

async function requestPair(number, toId) {
  const col = store.collection;
  if (!col) throw new Error('Database abhi ready nahi, thori dair baad try karein');
  const id = `${PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await col.updateOne({ _id: id }, { $set: { to: String(toId), number, status: 'pending', at: Date.now(), code: null, error: null } }, { upsert: true });
  const started = Date.now();
  try {
    while (Date.now() - started < WAIT_MS) {
      await sleep(1000);
      const d = await col.findOne({ _id: id });
      if (d && d.status === 'done') return { code: d.code };
      if (d && d.status === 'error') throw new Error(d.error || 'Server par pairing fail hui');
    }
    throw new Error(`Server #${toId} ne jawab nahi diya, thori dair baad try karein`);
  } finally {
    col.deleteOne({ _id: id }).catch(() => {});
  }
}

// Worker: har node apne lie gayi (to = mera APP_ID) pending requests uthata hai
async function work(manager) {
  const col = store.collection;
  if (!col) return;
  const docs = await col.find({ _id: { $regex: /^pairreq:/ }, to: String(config.APP_ID), status: 'pending' }).toArray();
  for (const d of docs) {
    const claim = await col.updateOne({ _id: d._id, status: 'pending' }, { $set: { status: 'working' } });
    if (claim && claim.modifiedCount === 0) continue; // kisi aur ne le liya
    try {
      const r = await manager.addInstance(d.number);
      await col.updateOne({ _id: d._id }, { $set: { status: 'done', code: String(r.code) } });
    } catch (e) {
      await col.updateOne({ _id: d._id }, { $set: { status: 'error', error: String(e.message || e).slice(0, 160) } });
    }
  }
}

function startWorker(manager) {
  if (timer) return;
  timer = setInterval(() => work(manager).catch(() => {}), POLL_MS);
  if (timer.unref) timer.unref();
}

module.exports = { pickServer, requestPair, startWorker, work, PAIR_SERVERS };
