// Incoming view-once (image / video / voice / document) ko message aate hi RAM mein rakhta hai (short time).
// .vv / .nice WhatsApp ki quote par nirbhar nahi rehte: asli message (mediaKey samet) yahin se uthate hain.
// Sirf wahi messages save hote hain jo bot ne khud decrypt karke dekhe hon.
const TTL = Math.max(60000, parseInt(process.env.VIEWONCE_CACHE_MS || String(10 * 60 * 1000), 10));
const MAX = 300;
const store = new Map(); // messageId -> { at, key, message }

function innermostViewOnce(message) {
  let node = message; let isVO = false;
  for (let i = 0; i < 6 && node; i++) {
    if (node.viewOnceMessage || node.viewOnceMessageV2 || node.viewOnceMessageV2Extension) isVO = true;
    const inner = node.viewOnceMessage?.message || node.viewOnceMessageV2?.message || node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message || node.documentWithCaptionMessage?.message;
    if (!inner) break;
    node = inner;
  }
  return isVO ? node : null;
}

function record(msg) {
  try {
    const id = msg?.key?.id;
    if (!id || !msg.message) return;
    const content = innermostViewOnce(msg.message);
    if (!content) return;
    store.set(id, {
      at: Date.now(),
      key: { remoteJid: msg.key.remoteJid, fromMe: !!msg.key.fromMe, id, participant: msg.key.participant },
      message: content,
    });
    if (store.size > MAX) store.delete(store.keys().next().value);
  } catch (e) { /* cache kabhi message handling ko na roke */ }
}

function get(id) {
  const e = store.get(id);
  if (!e) return null;
  if (Date.now() - e.at > TTL) { store.delete(id); return null; }
  return e;
}

module.exports = { record, get, innermostViewOnce };
