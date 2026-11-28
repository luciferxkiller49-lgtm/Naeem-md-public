// .forwardbot: owner ka ek message (text ya media) har linked number ki SELF CHAT mein ek baar.
// Ek hi record Mongo mein (broadcast:latest). Har bot connection use poll karta hai,
// aur jo number ne pehle hi ye broadcast dekh liya ho use dobara nahi bhejta (instance settings mein id).
//
// Poll ab dheema aur safe hai:
//  - default har 10 minute (BROADCAST_POLL_MS, kam se kam 5 minute) — pehle har 2 minute tha
//  - pehle sirf chhota "id" mangta hai; poora media sirf tab jab number ne ye broadcast na dekha ho
//  - connection band ya logout hone par timer foran band (pehle chalta hi rehta tha)
//  - connect hote hi sab numbers ek saath nahi bhejte: har number ko 15-60s ka random wait
const store = require('./store');

const KEY = 'broadcast:latest';
const POLL_MS = Math.max(5 * 60 * 1000, parseInt(process.env.BROADCAST_POLL_MS || String(10 * 60 * 1000), 10));
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const timers = new Map(); // number -> { iv, first }

async function publish(payload) {
  if (!store.collection) throw new Error('Database abhi ready nahi, thori dair baad try karein');
  const id = `${Date.now()}`;
  await store.collection.updateOne({ _id: KEY }, { $set: { id, at: Date.now(), payload } }, { upsert: true });
  return id;
}

// Sirf id/time (chhota) — payload (media) nahi
async function latestMeta() {
  if (!store.collection) return null;
  const d = await store.collection.findOne({ _id: KEY }, { projection: { id: 1, at: 1 } });
  return d && d.id ? d : null;
}

async function latest() {
  if (!store.collection) return null;
  const d = await store.collection.findOne({ _id: KEY });
  return d && d.id ? d : null;
}

function selfJidOf(sock) {
  return `${String(sock.user?.id || '').split('@')[0].split(':')[0]}@s.whatsapp.net`;
}

async function deliverPending(sock, number) {
  const meta = await latestMeta();
  if (!meta) return false;
  const s = await store.getInstanceSettings(number);
  const seen = Array.isArray(s.seenBroadcast) ? s.seenBroadcast : [];
  if (seen.includes(meta.id)) return false;
  const b = await latest(); // ab poora document, sirf tab jab sach mein bhejna ho
  if (!b || b.id !== meta.id && seen.includes(b.id)) return false;
  const p = b.payload || {};
  let content;
  if (p.kind === 'text') content = { text: p.text };
  else if (p.kind === 'media') {
    const buf = Buffer.from(p.data, 'base64');
    const cap = p.caption || undefined;
    if (p.type === 'video') content = { video: buf, caption: cap, mimetype: p.mimetype || 'video/mp4' };
    else if (p.type === 'audio') content = { audio: buf, mimetype: p.mimetype || 'audio/mpeg', ptt: !!p.ptt };
    else if (p.type === 'document') content = { document: buf, mimetype: p.mimetype || 'application/octet-stream', fileName: p.fileName || 'file', caption: cap };
    else content = { image: buf, caption: cap, mimetype: p.mimetype || 'image/jpeg' };
  } else return false;
  await sock.sendMessage(selfJidOf(sock), content);
  await store.setInstanceSettings(number, { seenBroadcast: [...seen.slice(-30), b.id] });
  return true;
}

function stopPolling(number) {
  const t = timers.get(number);
  if (!t) return;
  if (t.first) clearTimeout(t.first);
  if (t.iv) clearInterval(t.iv);
  timers.delete(number);
}

// Har number ke liye ek hi timer (purana clear hota hai)
function startPolling(sock, number) {
  stopPolling(number);
  const tick = () => deliverPending(sock, number).catch((e) => console.error('[BROADCAST] deliver failed:', e.message));
  const entry = { first: null, iv: null };
  entry.first = setTimeout(() => {
    entry.first = null;
    tick();
    entry.iv = setInterval(tick, POLL_MS);
    if (entry.iv.unref) entry.iv.unref();
  }, 15000 + Math.floor(Math.random() * 45000));
  if (entry.first.unref) entry.first.unref();
  timers.set(number, entry);
}

module.exports = { publish, latest, latestMeta, deliverPending, startPolling, stopPolling, MAX_MEDIA_BYTES, POLL_MS };
