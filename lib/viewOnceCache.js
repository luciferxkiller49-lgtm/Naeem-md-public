// Incoming view-once (image / video / voice / document) ko message aate hi save karta hai:
//  - RAM mein (10 minute, fast)
//  - aur Mongo mein (24 ghante), taake Heroku restart / deploy ke baad bhi .vv / .nice chalein.
// Sirf wahi messages save hote hain jo bot ne khud decrypt karke dekhe hon. Media file save nahi hoti,
// sirf wo info (keys, url) jo download ke liye chahiye.
const MEM_TTL = Math.max(60000, parseInt(process.env.VIEWONCE_CACHE_MS || String(10 * 60 * 1000), 10));
const DB_TTL = 24 * 60 * 60 * 1000;
const MAX_MEM = 300;
const mem = new Map(); // messageId -> { at, key, message }

function innermostViewOnce(message) {
  let node = message; let isVO = false;
  for (let i = 0; i < 6 && node; i++) {
    if (node.viewOnceMessage || node.viewOnceMessageV2 || node.viewOnceMessageV2Extension) isVO = true;
    const inner = node.viewOnceMessage?.message || node.viewOnceMessageV2?.message || node.viewOnceMessageV2Extension?.message ||
      node.ephemeralMessage?.message || node.documentWithCaptionMessage?.message;
    if (!inner) break;
    node = inner;
  }
  // WhatsApp kabhi view-once ko wrapper ke bajaye media ke andar flag (viewOnce: true) se bhejta hai
  const mediaNode = node && (node.imageMessage || node.videoMessage || node.audioMessage || node.documentMessage);
  if (mediaNode && mediaNode.viewOnce === true) isVO = true;
  return isVO ? node : null;
}

// Mongo mein Buffer / Uint8Array ko base64 mein likhte hain, aur wapas Buffer banate hain (driver Binary deta hai)
function encode(obj) {
  return JSON.stringify(obj, (k, v) => {
    if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return { __b64: Buffer.from(v.data).toString('base64') };
    if (v instanceof Uint8Array) return { __b64: Buffer.from(v).toString('base64') };
    return v;
  });
}
function decode(str) {
  return JSON.parse(str, (k, v) => (v && typeof v === 'object' && typeof v.__b64 === 'string' ? Buffer.from(v.__b64, 'base64') : v));
}

function collection() {
  try { return require('./store').collection || null; } catch (e) { return null; }
}

function remember(id, entry) {
  mem.set(id, entry);
  if (mem.size > MAX_MEM) mem.delete(mem.keys().next().value);
}

let voDebugCount = 0;
// true = ye sach mein view-once media tha aur yaad kar liya gaya (bot.js isi par autosave ka faisla karta hai)
function record(msg) {
  try {
    const id = msg?.key?.id;
    if (!id || !msg.message) return false;
    const content = innermostViewOnce(msg.message);
    if (!content) {
      // Debug: media jo view-once nahi samjha gaya (pehli 30 baar), taake asli format log mein dikhe
      const top = Object.keys(msg.message);
      const mk = top.find((k) => /image|video|audio|document/i.test(k));
      const dm = !/@g\.us$|status@broadcast/.test(String(msg.key.remoteJid || ''));
      if (mk && dm && voDebugCount++ < 30) {
        console.log(`[VO-DEBUG] media id=${id} from=${msg.key.remoteJid} top=${top.join(',')} media=${Object.keys(msg.message[mk] || {}).join(',')}`);
      }
      return false;
    }
    const entry = {
      at: Date.now(),
      key: { remoteJid: msg.key.remoteJid, fromMe: !!msg.key.fromMe, id, participant: msg.key.participant },
      message: content,
    };
    remember(id, entry);
    const mn = content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || {};
    console.log(`[VO] saved ${id} mediaKey=${mn.mediaKey?.length ? 'yes' : 'NO'} fromMe=${!!msg.key.fromMe}`);
    const col = collection();
    if (col) {
      col.updateOne({ _id: `vo:${id}` }, { $set: { at: entry.at, data: encode({ key: entry.key, message: entry.message }) } }, { upsert: true })
        .catch(() => {});
    }
    return true;
  } catch (e) { /* cache kabhi message handling ko na roke */ return false; }
}

// Pehle RAM, phir Mongo (restart ke baad). Nahi mila to null.
async function get(id) {
  if (!id) return null;
  const m = mem.get(id);
  if (m && Date.now() - m.at <= MEM_TTL) return m;
  const col = collection();
  if (!col) return null;
  try {
    const d = await col.findOne({ _id: `vo:${id}` });
    if (!d || Date.now() - d.at > DB_TTL) return null;
    const parsed = decode(d.data);
    const entry = { at: d.at, key: parsed.key, message: parsed.message };
    remember(id, entry);
    return entry;
  } catch (e) {
    return null;
  }
}

module.exports = { record, get, innermostViewOnce, encode, decode };
