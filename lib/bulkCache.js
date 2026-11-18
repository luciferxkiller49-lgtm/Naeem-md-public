/**
 * Chat ke andar bheje gaye "link wale" aur "group-status (story)" messages ke keys yaad rakhta hai —
 * taake .dellink / .delstory unhe ek sath delete kar sakein, chahe antilink/antigcstatus us waqt ON ho ya na ho.
 *
 * Ek message ke 2 flag hote hain:
 *   status = group status (story) post hai
 *   link   = text/caption mein link hai (status post ke andar ka link bhi gina jata hai)
 * Is liye ".dellink" status post bhi hata deta hai agar us mein link ho, aur ".delstory" saare status posts
 * (link ho ya na ho). Ek baar delete hone ke baad wo dono list se nikal jata hai.
 *
 * Sirf RAM mein — restart par khali. Har chat ki ek hadd (MAX_PER_CHAT) aur chats ki bhi (MAX_CHATS) hai.
 */
const WHATSAPP_LINK_REGEX = /chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i;
const ALL_LINK_REGEX = /(https?:\/\/[^\s]+)/i;
const GCSTATUS_KEYS = ['groupStatusMessageV2', 'groupStatusMessage'];

const MAX_PER_CHAT = 300;
const MAX_CHATS = 100;

const chats = new Map(); // chatId -> Map(messageId -> { key, link, status })
const DB_TTL = 24 * 60 * 60 * 1000; // Mongo mein 24 ghante tak (restart ke baad bhi)

function store() { try { return require('./store'); } catch (e) { return null; } }

function persist(chatId) {
  const col = store()?.collection;
  if (!col) return;
  const map = chats.get(chatId);
  const arr = map ? [...map.entries()].map(([id, e]) => ({ id, key: e.key, link: e.link, status: e.status })) : [];
  const op = arr.length
    ? col.updateOne({ _id: `bulk:${chatId}` }, { $set: { at: Date.now(), data: JSON.stringify(arr) } }, { upsert: true })
    : col.deleteOne({ _id: `bulk:${chatId}` });
  op.catch(() => {});
}

// RAM khali ho (restart ke baad) to Mongo se chat ka record wapas lao
async function ensure(chatId) {
  if (chats.has(chatId)) return chats.get(chatId);
  const col = store()?.collection;
  if (!col) return null;
  try {
    const d = await col.findOne({ _id: `bulk:${chatId}` });
    if (!d || Date.now() - d.at > DB_TTL) return null;
    const map = new Map();
    for (const e of JSON.parse(d.data || '[]')) map.set(e.id, { key: e.key, link: e.link, status: e.status });
    if (map.size) chats.set(chatId, map);
    return map.size ? map : null;
  } catch (e) { return null; }
}

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.viewOnceMessageV2?.message ||
      m.viewOnceMessageV2Extension?.message || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m || {};
}

function textOf(m) {
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}

/** Chat ke har aane wale message par call karein */
function record(chatId, msg) {
  if (!msg?.message || !msg.key?.id) return;
  const m = unwrap(msg.message);

  const statusHolder = GCSTATUS_KEYS.map((k) => m[k]).find(Boolean);
  const status = !!statusHolder;
  const text = status ? textOf(unwrap(statusHolder.message || {})) : textOf(m);
  const link = !!text && (WHATSAPP_LINK_REGEX.test(text) || ALL_LINK_REGEX.test(text));
  if (!status && !link) return;

  let map = chats.get(chatId);
  if (!map) {
    map = new Map();
    chats.set(chatId, map);
    if (chats.size > MAX_CHATS) chats.delete(chats.keys().next().value); // sab se purani chat nikal do
  }
  map.set(msg.key.id, { key: msg.key, link, status });
  if (map.size > MAX_PER_CHAT) map.delete(map.keys().next().value);
  persist(chatId);
}

async function takeWhere(chatId, pick) {
  const map = await ensure(chatId);
  if (!map) return [];
  const keys = [];
  for (const [id, e] of map) {
    if (pick(e)) { keys.push(e.key); map.delete(id); }
  }
  if (!map.size) chats.delete(chatId);
  persist(chatId);
  return keys;
}

const takeLinkKeys = (chatId) => takeWhere(chatId, (e) => e.link);
const takeStatusKeys = (chatId) => takeWhere(chatId, (e) => e.status);

/** Is chat mein abhi kitne (link wale, status wale) record hain — delete kiye baghair */
function counts(chatId) {
  let links = 0; let statuses = 0;
  for (const e of chats.get(chatId)?.values() || []) { if (e.link) links++; if (e.status) statuses++; }
  return { links, statuses };
}

const chatIds = () => [...chats.keys()];

// Sab chats (RAM + Mongo) — "all" ke liye
async function allChatIds() {
  const ids = new Set(chats.keys());
  const col = store()?.collection;
  if (col) {
    try {
      const docs = await col.find({ _id: { $regex: /^bulk:/ } }).toArray();
      for (const d of docs) if (d.at && Date.now() - d.at <= DB_TTL) ids.add(String(d._id).slice(5));
    } catch (e) { /* DB na ho to RAM hi kaafi */ }
  }
  return [...ids];
}

module.exports = { record, takeLinkKeys, takeStatusKeys, counts, chatIds, allChatIds };
