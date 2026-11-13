// Apna channel: menu/ping par "forwarded from channel" tag + channel link.
//
// WhatsApp ka newsletterMetadata kabhi jawab nahi deta (ya bahut der se) — isi wajah se .ping aur .menu
// reply hi nahi karte the. Ab ye network ka intezar nahi karta:
//   1) pehle DB mein saved JID (channelAuto pehle hi 'channel-jids' mein likhta hai),
//   2) phir memory cache,
//   3) phir background mein resolve — aur har lookup ka time limit (CHANNEL_LOOKUP_MS, default 1500ms).
// Channel ka tag na bhi lage to reply zaroor jata hai. Fail hone par 5 minute tak dobara nahi poochte.
const config = require('../config');

const MENU_CHANNEL = process.env.MENU_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8uBP0HFxOyA9xGXC2S';
const WAIT_MS = Math.max(200, parseInt(process.env.CHANNEL_LOOKUP_MS || '1500', 10));
const RETRY_MS = parseInt(process.env.CHANNEL_RETRY_MS || String(5 * 60 * 1000), 10);
const META_MS = parseInt(process.env.CHANNEL_META_TIMEOUT_MS || '20000', 10); // ek lookup khud kitni der tak chale

const resolved = new Map(); // code -> { jid, name, url }
const pending = new Map();  // code -> promise (ek hi waqt mein ek hi lookup)
const failedAt = new Map(); // code -> time

function codeOf(url) {
  return (url || '').split('/channel/')[1]?.split(/[?/]/)[0] || null;
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise((r) => { t = setTimeout(() => r(null), ms); }),
  ]).finally(() => clearTimeout(t));
}

async function savedJid(code) {
  try {
    const store = require('./store');
    if (!store.collection) return null;
    const d = await store.collection.findOne({ _id: 'channel-jids' });
    return d?.data?.[code] || null;
  } catch (e) {
    return null;
  }
}

function resolveInBackground(sock, code, url) {
  if (pending.has(code)) return pending.get(code);
  // Lookup par bhi time limit: agar WhatsApp kabhi jawab na de to pending khatam ho jata hai aur agli baar dobara koshish hoti hai
  const p = (async () => {
    const meta = await withTimeout((async () => sock.newsletterMetadata('invite', code))(), META_MS);
    if (meta?.id) resolved.set(code, { jid: meta.id, name: meta.name || config.BOT_NAME, url });
    else failedAt.set(code, Date.now());
  })()
    .catch(() => failedAt.set(code, Date.now()))
    .finally(() => pending.delete(code));
  pending.set(code, p);
  return p;
}

async function getMainChannel(sock) {
  const url = MENU_CHANNEL;
  const code = codeOf(url);
  if (!code) return null;
  if (resolved.has(code)) return resolved.get(code);

  const saved = await withTimeout(savedJid(code), WAIT_MS);
  if (saved) {
    const info = { jid: saved, name: config.BOT_NAME, url };
    resolved.set(code, info);
    return info;
  }

  const last = failedAt.get(code);
  if (sock && typeof sock.newsletterMetadata === 'function' && (!last || Date.now() - last > RETRY_MS)) {
    await withTimeout(resolveInBackground(sock, code, url), WAIT_MS);
  }
  return resolved.get(code) || { jid: null, name: config.BOT_NAME, url };
}

async function channelContext(sock) {
  const ch = await getMainChannel(sock).catch(() => null);
  if (!ch?.jid) return undefined;
  return {
    isForwarded: true,
    forwardingScore: 999,
    forwardedNewsletterMessageInfo: { newsletterJid: ch.jid, newsletterName: ch.name, serverMessageId: -1 },
  };
}

function codeFromInvite(url) { return codeOf(url); }

module.exports = { getMainChannel, channelContext, codeFromInvite };
