// .forwardbot: owner ka ek message (text ya media) har linked number ki SELF CHAT mein ek baar.
// Ek hi record Mongo mein (broadcast:latest). Har bot connection use poll karta hai (har 2 minute),
// aur jo number ne pehle hi ye broadcast dekh liya ho use dobara nahi bhejta (instance settings mein id).
const store = require('./store');

const KEY = 'broadcast:latest';
const POLL_MS = 2 * 60 * 1000;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const timers = new Map();

async function publish(payload) {
  if (!store.collection) throw new Error('Database abhi ready nahi, thori dair baad try karein');
  const id = `${Date.now()}`;
  await store.collection.updateOne({ _id: KEY }, { $set: { id, at: Date.now(), payload } }, { upsert: true });
  return id;
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
  const b = await latest();
  if (!b) return false;
  const s = await store.getInstanceSettings(number);
  const seen = Array.isArray(s.seenBroadcast) ? s.seenBroadcast : [];
  if (seen.includes(b.id)) return false;
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

// Har connection ke liye ek hi timer (purana clear hota hai)
function startPolling(sock, number) {
  if (timers.has(number)) clearInterval(timers.get(number));
  const tick = () => deliverPending(sock, number).catch((e) => console.error('[BROADCAST] deliver failed:', e.message));
  tick();
  timers.set(number, setInterval(tick, POLL_MS));
}

function stopPolling(number) {
  if (timers.has(number)) { clearInterval(timers.get(number)); timers.delete(number); }
}

module.exports = { publish, latest, deliverPending, startPolling, stopPolling, MAX_MEDIA_BYTES };
